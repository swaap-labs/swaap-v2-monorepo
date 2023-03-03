// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";
import "./ChainlinkUtils.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IMinimalSwapInfoPool.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/EOASignaturesValidator.sol";
import "./SignatureSafeguard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20Metadata.sol";

contract SafeguardTwoTokenPool is SignatureSafeguard, BasePool, IMinimalSwapInfoPool, ReentrancyGuard {
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    struct InitialSafeguardParams {
        address signer;
        uint256 maxTVLoffset;
        uint256 maxBalOffset;
        uint256 perfUpdateInterval;
        uint256 maxQuoteOffset;
        uint256 maxPriceOffet;
    }

    struct JoinSwapStruct {
        uint256 minBptAmountOut;
        IERC20 expectedExcessTokenIn;
        uint256 maxSwapAmountIn;
        uint256[] joinAmountsIn;
        bytes swapData;
    }

    uint256 private constant _NUM_TOKENS = 2;
    uint256 private constant _INITIAL_BPT = 100 ether;

    IERC20Metadata internal immutable _token0;
    IERC20Metadata internal immutable _token1;
    
    AggregatorV3Interface internal immutable _oracle0;
    AggregatorV3Interface internal immutable _oracle1;

    uint256 internal immutable _scaleFactor0;
    uint256 internal immutable _scaleFactor1;

    address private _signer;
    
    // [ max quote offset | max price offet | free slot ]
    // [     64 bits      |      64 bits    |  128 bits ]
    // [ MSB                                        LSB ]
    bytes32 private _packedPricingParameters;

    // used to determine if the on-chain balance is close from the quoted one
    uint256 private constant _MAX_QUOTE_OFFSET_BIT_OFFSET = 192;
    uint256 private constant _MAX_QUOTE_OFFSET_BIT_LENGTH = 64;

    // used to determine if the trade is fairly compared to an oracle
    uint256 private constant _MAX_PRICE_OFFSET_BIT_OFFSET = 128;
    uint256 private constant _MAX_PRICE_OFFSET_BIT_LENGTH = 64;

    // [ max TVL offset | max perf balance offset | perf update interval | last perf update ]
    // [     64 bits    |         64 bits         |        64 bits       |      64 bits     ]
    // [ MSB                                                                            LSB ]
    bytes32 private _packedPerfParameters;

    // used to determine if the pool is underperforming
    uint256 private constant _MAX_TVL_OFFSET_BIT_OFFSET = 192;
    uint256 private constant _MAX_TVL_OFFSET_BIT_LENGTH = 64;

    // used to determine if the pool is underperforming
    uint256 private constant _MAX_BAL_OFFSET_BIT_OFFSET = 128;
    uint256 private constant _MAX_BAL_OFFSET_BIT_LENGTH = 64;

    // used to determine if a performance update is needed before a swap / one-asset-join / one-asset-exit
    uint256 private constant _PERF_UPDATE_INTERVAL_BIT_OFFSET = 64;
    uint256 private constant _PERF_LAST_UPDATE_BIT_OFFSET = 0;
    uint256 private constant _PERF_TIME_BIT_LENGTH = 64;
    
    // min balance = performance balance * (1-_maxPerformanceOffset)
    // [ min balance 0 per PT | min balance 1 per PT ]
    // [       128 bits       |       128 bits       ]
    // [ MSB                                     LSB ]
    bytes32 private _perfBalancesPerPT;

    uint256 private constant _PERF_BAL_BIT_OFFSET_0 = 128;
    uint256 private constant _PERF_BAL_BIT_OFFSET_1 = 0;
    uint256 private constant _PERF_BAL_BIT_LENGTH   = 128;

    event PerformanceUpdateIntervalChanged(uint256 performanceUpdateInterval);

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        address[] memory assetManagers,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        AggregatorV3Interface[] memory oracles,
        InitialSafeguardParams memory safeguardParameters
    )
        BasePool(
            vault,
            IVault.PoolSpecialization.TWO_TOKEN,
            name,
            symbol,
            tokens,
            assetManagers,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {

        InputHelpers.ensureInputLengthMatch(tokens.length, _NUM_TOKENS);
        InputHelpers.ensureInputLengthMatch(oracles.length, _NUM_TOKENS);
    
        _token0 = IERC20Metadata(address(tokens[0]));
        _token1 = IERC20Metadata(address(tokens[1]));

        _oracle0 = oracles[0];
        _oracle1 = oracles[1];

        // TODO: verify decimals < 77 ?
        // 10**77 overflows
        {
            uint256 decimals0 = uint256(IERC20Metadata(address(tokens[0])).decimals()).add(oracles[0].decimals());
            uint256 decimals1 = uint256(IERC20Metadata(address(tokens[1])).decimals()).add(oracles[1].decimals());

            (_scaleFactor0, _scaleFactor1) = decimals0 > decimals1? 
            (uint256(1), 10**(decimals0 - decimals1)) : (10**(decimals1 - decimals0), uint256(1));
        }    

        _setSigner(safeguardParameters.signer);
        _setMaxTVLoffset(safeguardParameters.maxTVLoffset);
        _setMaxBalOffset(safeguardParameters.maxBalOffset);
        _setPerfUpdateInterval(safeguardParameters.perfUpdateInterval);
        _setMaxQuoteOffset(safeguardParameters.maxQuoteOffset);
        _setMaxPriceOffet(safeguardParameters.maxPriceOffet);
  
    }

    function onSwap(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) external override onlyVault(request.poolId) returns (uint256) {

        (uint256 deadline, bytes memory swapData) = _swapSignatureSafeguard(
            request.kind,
            request.poolId,
            request.tokenIn,
            request.tokenOut,
            request.amount,
            request.to,
            request.userData
        );

        (
            uint256 amountIn,
            uint256 amountOut
        ) = _getAmountsInOutAfterSlippage(request.kind, request.amount, deadline, swapData);

        (
            uint256 quoteBalanceIn,
            uint256 quoteBalanceOut
        ) = _decodeQuoteBalanceData(swapData);

        _simulateSwap(
            request.tokenIn,
            balanceTokenIn,
            balanceTokenOut,
            quoteBalanceIn,
            quoteBalanceOut,
            amountIn,
            amountOut,
            totalSupply()
        );

        if(request.kind == IVault.SwapKind.GIVEN_IN) {
            return amountOut;
        }

        return amountIn;

    }

    function _simulateSwap(
        IERC20  tokenIn,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 quoteBalanceIn,
        uint256 quoteBalanceOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 totalSupply
    ) private {
        
        (uint256 maxQuoteOffset, uint256 maxPriceOffset) = _getPricingParameters();

        _QuoteBalanceSafeguard(
            balanceTokenIn,
            balanceTokenOut,
            quoteBalanceIn,
            quoteBalanceOut,
            maxQuoteOffset
        );

        {        
            uint256 relativePrice = _getRelativePrice(tokenIn);

            _fairPricingSafeguard(
                amountIn,
                amountOut,
                relativePrice,
                maxPriceOffset
            );

            _perfBalancesSafeguard(
                tokenIn,
                balanceTokenIn,
                balanceTokenOut,
                amountIn,
                amountOut,
                relativePrice,
                totalSupply
            );
        }

    }

    // Join Pool

    /**
     * @notice Vault hook for adding liquidity to a pool (including the first time, "initializing" the pool).
     * @dev This function can only be called from the Vault, from `joinPool`.
     */
    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256, // lastChangeBlock
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) external override(BasePool, IBasePool) onlyVault(poolId) returns (uint256[] memory, uint256[] memory) {

        if (totalSupply() == 0) {
            (uint256 bptAmountOut, uint256[] memory amountsIn) = _onInitializePool(
                poolId,
                sender,
                recipient,
                userData
            );

            // On initialization, we lock _getMinimumBpt() by minting it for the zero address. This BPT acts as a
            // minimum as it will never be burned, which reduces potential issues with rounding, and also prevents the
            // Pool from ever being fully drained.
            _require(bptAmountOut >= _getMinimumBpt(), Errors.MINIMUM_BPT);
            _mintPoolTokens(address(0), _getMinimumBpt());
            _mintPoolTokens(recipient, bptAmountOut - _getMinimumBpt());

            return (amountsIn, new uint256[](balances.length));
        } else {

            (uint256 bptAmountOut, uint256[] memory amountsIn) = _onJoinPool(
                poolId,
                recipient,
                balances,
                inRecoveryMode() ? 0 : protocolSwapFeePercentage, // Protocol fees are disabled while in recovery mode
                userData
            );

            // Note we no longer use `balances` after calling `_onJoinPool`, which may mutate it.

            _mintPoolTokens(recipient, bptAmountOut);

            // This Pool ignores the `dueProtocolFees` return value, so we simply return a zeroed-out array.
            return (amountsIn, new uint256[](balances.length));
        }
    }

    function _onInitializePool(
        bytes32,
        address,
        address,
        bytes memory userData
    ) internal returns (uint256 bptAmountOut, uint256[] memory amountsIn) {
        JoinKind kind;
        
        (kind, amountsIn) = abi.decode(userData, (JoinKind, uint256[]));
        
        _require(kind == JoinKind.INIT, Errors.UNINITIALIZED);
        _require(amountsIn.length == _NUM_TOKENS, Errors.TOKENS_LENGTH_MUST_BE_2);

        bptAmountOut = _INITIAL_BPT;

        // set perf balances & set last perf update time to block.timestamp
        _setPerfBalancesPerPT(amountsIn[0].divDown(bptAmountOut), amountsIn[1].divDown(bptAmountOut));
        
    }

    function _onJoinPool(
        bytes32 poolId,
        address receiver,
        uint256[] memory balances,
        uint256, // protocolFees, // TODO is protocol fees needed / recovery mode needed?
        bytes memory userData
    ) internal returns (uint256, uint256[] memory) {

        (JoinKind kind, bytes memory joinData) = abi.decode(userData, (JoinKind, bytes));

        if(kind == JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {

            return _joinAllTokensInForExactBPTOut(balances, joinData);

        } else if (kind == JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {

            return _joinExactTokensInForBPTOut(poolId, receiver, balances, joinData);

        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }

    }

    function _joinAllTokensInForExactBPTOut(
        uint256[] memory balances,
        bytes memory userData
    ) internal view returns (uint256, uint256[] memory) {
        (
            uint256 exactBptAmountOut,
            uint256[] memory maxAmountsIn
        ) = abi.decode(userData, (uint256, uint256[]));
        
        uint256 ratio = exactBptAmountOut.divUp(totalSupply());
        
        uint256[] memory amountsIn = new uint256[](_NUM_TOKENS);
        
        for(uint256 i; i < _NUM_TOKENS; ++i){
            amountsIn[i] = balances[i].mulUp(ratio);
            require(amountsIn[i] <= maxAmountsIn[i], "error: max amount in exceeded");
        }

        return (exactBptAmountOut, amountsIn);
    }

    function _joinExactTokensInForBPTOut(
        bytes32 poolId,
        address receiver,
        uint256[] memory balances,
        bytes memory signedJoinData
    ) internal returns (uint256, uint256[] memory) {

        (
            uint256 deadline,
            bytes memory joinData
        ) = _joinPoolSignatureSafeguard(
                JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT,
                poolId,
                receiver,
                signedJoinData
        );

        JoinSwapStruct memory decodedJoinSwapData = _decodeJoinPoolUserData(joinData);

        (, uint256 maxSwapAmountOut) = _getAmountsInOutAfterSlippage(
            IVault.SwapKind.GIVEN_IN,
            decodedJoinSwapData.maxSwapAmountIn,
            deadline,
            decodedJoinSwapData.swapData
        );

        uint256 rOpt = _calcROptGivenExactTokenIn(
            balances,
            decodedJoinSwapData.joinAmountsIn,
            decodedJoinSwapData.expectedExcessTokenIn,
            decodedJoinSwapData.maxSwapAmountIn,
            maxSwapAmountOut
        );
        
        uint256 totalSupply = totalSupply();
        
        uint256 bptAmountOut = totalSupply.mulDown(rOpt);
        totalSupply += bptAmountOut; // will be checked for overflow when minting
        
        require(bptAmountOut >= decodedJoinSwapData.minBptAmountOut, "error: not enough bpt out");
        
        rOpt = rOpt.add(FixedPoint.ONE);
        uint256 rOptBalanceIn =  balances[0].mulDown(rOpt);
        uint256 rOptBalanceOut =  balances[1].mulDown(rOpt);

        (
            uint256 quoteBalanceIn,
            uint256 quoteBalanceOut
        ) = _decodeQuoteBalanceData(decodedJoinSwapData.swapData);

        _simulateSwap(
            decodedJoinSwapData.expectedExcessTokenIn,
            rOptBalanceIn,
            rOptBalanceOut,
            quoteBalanceIn,
            quoteBalanceOut,
            decodedJoinSwapData.maxSwapAmountIn, // TODO we may want to use the actual swap amount
            maxSwapAmountOut, // TODO we may want to use the actual swap amount
            totalSupply
        );

        return (bptAmountOut, decodedJoinSwapData.joinAmountsIn);

    }

    function _calcROptGivenExactTokenIn(
        uint256[] memory initialBalances,
        uint256[] memory joinAmountsIn,
        IERC20  expectedExcessTokenIn,
        uint256 maxSwapAmountIn,
        uint256 maxSwapAmountOut
    ) internal view returns (
        uint256 rOpt
        // uint256 swappedAmountIn,
        // uint256 swappedAmountOut
    ) {
        uint256 j0b1 = joinAmountsIn[0].mulDown(initialBalances[1]);
        uint256 j1b0 = joinAmountsIn[1].mulDown(initialBalances[0]);
        uint256 swappedAmountIn;
        uint256 swappedAmountOut;
        // TODO: simplify and add into one function
        if(j0b1 > j1b0) {
            require(expectedExcessTokenIn == _token0, "error: wrong swap side");
            uint256 relativePrice = maxSwapAmountOut.divUp(maxSwapAmountIn);
            {
                uint256 num = j0b1 - j1b0;
                uint256 denom = initialBalances[1] + relativePrice.mulUp(initialBalances[0]);
                swappedAmountIn = num.divUp(denom);
            }
            require(swappedAmountIn <= maxSwapAmountIn, "error: max swap exceeded when join pool");
            swappedAmountOut = swappedAmountIn.mulDown(relativePrice);
            rOpt = (joinAmountsIn[1].add(swappedAmountOut)).divUp(initialBalances[1]);
        } else {
            require(expectedExcessTokenIn == _token1, "error: wrong swap side");
            uint256 relativePrice = maxSwapAmountOut.divUp(maxSwapAmountIn);
            {
                uint256 num = j1b0 - j0b1;
                uint256 denom = initialBalances[0] + relativePrice.mulUp(initialBalances[1]);
                swappedAmountIn = num.divUp(denom);
            }
            require(swappedAmountIn <= maxSwapAmountIn, "error: max swap exceeded when join pool");
            swappedAmountOut = swappedAmountIn.mulDown(relativePrice);
            rOpt = (joinAmountsIn[0].add(swappedAmountOut)).divUp(initialBalances[0]);
        }
    }

    /**
     * @notice Vault hook for removing liquidity from a pool.
     * @dev This function can only be called from the Vault, from `exitPool`.
     */
    /*
    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) external override onlyVault(poolId) returns (uint256[] memory, uint256[] memory) {
        uint256[] memory amountsOut;
        uint256 bptAmountIn;

        // When a user calls `exitPool`, this is the first point of entry from the Vault.
        // We first check whether this is a Recovery Mode exit - if so, we proceed using this special lightweight exit
        // mechanism which avoids computing any complex values, interacting with external contracts, etc., and generally
        // should always work, even if the Pool's mathematics or a dependency break down.
        if (userData.isRecoveryModeExitKind()) {
            // This exit kind is only available in Recovery Mode.
            _ensureInRecoveryMode();

            // Note that we don't upscale balances nor downscale amountsOut - we don't care about scaling factors during
            // a recovery mode exit.
            (bptAmountIn, amountsOut) = _doRecoveryModeExit(balances, totalSupply(), userData);
        } else {
            // Note that we only call this if we're not in a recovery mode exit.
            _beforeSwapJoinExit();

            uint256[] memory scalingFactors = _scalingFactors();
            _upscaleArray(balances, scalingFactors);

            (bptAmountIn, amountsOut) = _onExitPool(
                poolId,
                sender,
                recipient,
                balances,
                lastChangeBlock,
                inRecoveryMode() ? 0 : protocolSwapFeePercentage, // Protocol fees are disabled while in recovery mode
                scalingFactors,
                userData
            );

            // amountsOut are amounts exiting the Pool, so we round down.
            _downscaleDownArray(amountsOut, scalingFactors);
        }

        // Note we no longer use `balances` after calling `_onExitPool`, which may mutate it.

        _burnPoolTokens(sender, bptAmountIn);

        // This Pool ignores the `dueProtocolFees` return value, so we simply return a zeroed-out array.
        return (amountsOut, new uint256[](balances.length));
    }
    */

    /**
    * Decoders
    */
    function _decodeJoinPoolUserData(bytes memory joinPoolData)
    internal pure
    returns(
        JoinSwapStruct memory decodedJoinSwapData
    ){
        
        decodedJoinSwapData = abi.decode(joinPoolData, (JoinSwapStruct));
    }

    // function _decodeJoinPoolUserData(bytes memory joinPoolData)
    // internal pure
    // returns(
    //     uint256 minBptAmountOut,
    //     IERC20  expectedExcessTokenIn, // add enum SELL TOKEN0 OR BUY TOKEN0
    //     uint256 maxSwapAmountIn, // TODO This should be signed
    //     uint256[] memory joinAmountsIn,
    //     bytes memory swapUserData
    // ){
        
    //     (
    //         minBptAmountOut,
    //         expectedExcessTokenIn, // add enum SELL TOKEN0 OR BUY TOKEN0
    //         maxSwapAmountIn, // TODO This should be signed
    //         joinAmountsIn,
    //         swapUserData
    //     ) = abi.decode(joinPoolData, (uint256, IERC20, uint256, uint256[], bytes));
    // }

    // function _decodeSwapUserData(bytes memory swapData) internal pure 
    // returns(
    //     uint256 variableAmount,
    //     uint256 slippageParameter,
    //     uint256 startTime,
    //     uint256 quoteBalance0,
    //     uint256 quoteBalance1
    // ){
    //     (
    //         variableAmount,
    //         slippageParameter,
    //         startTime,
    //         quoteBalance0,
    //         quoteBalance1
    //     ) = abi.decode(swapData, (uint256, uint256, uint256, uint256, uint256));
    // }

    /**
        Safeguards
    */
    function _QuoteBalanceSafeguard(
        uint256 oldBalanceIn,
        uint256 oldBalanceOut,
        uint256 quoteBalanceIn,
        uint256 quoteBalanceOut,
        uint256 maxQuoteOffset
    ) internal pure {      
        // TODO: add special cases if in the right direction or not
        require(quoteBalanceIn.divDown(oldBalanceIn) >= maxQuoteOffset, "error: quote balance no longer valid");
        require(quoteBalanceOut.divDown(oldBalanceOut) >= maxQuoteOffset, "error: quote balance no longer valid");
    }

    function _fairPricingSafeguard(
        uint256 amountIn,
        uint256 amountOut,
        uint256 relativePrice,
        uint256 maxPriceOffset
    ) internal pure {
        // TODO change logic to use amountIn / amountOut instead of relative price
        uint256 relativeAmountOut = amountOut.mulUp(relativePrice);        
        bool isfairPrice = relativeAmountOut <= amountIn? true : amountIn.mulDown(maxPriceOffset) >= relativeAmountOut;
        require(isfairPrice, "error: unfair price");
    }

    function _perfBalancesSafeguard(
        IERC20  tokenIn,
        uint256 currentBalanceIn,
        uint256 currentBalanceOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 relativePrice,
        uint256 totalSupply
    ) internal {

        (   uint256 maxTVLOffset,
            uint256 maxBalOffset,
            uint256 lastPerfUpdate,
            uint256 perfUpdateInterval
        ) = _getPerfParameters();

        // lastPerfUpdate & perfUpdateInterval are stored in 64 bits so they cannot overflow
        if(block.timestamp > lastPerfUpdate + perfUpdateInterval){
            _updatePerformance(currentBalanceIn, currentBalanceOut, relativePrice, totalSupply);
        }

        uint256 perfBalPerPTIn;
        uint256 perfBalPerPTOut;

        {        
            (uint256 perfBalPerPT0, uint256 perfBalPerPT1) = getPerfBalancesPerPT();

            (perfBalPerPTIn, perfBalPerPTOut) = tokenIn == _token0?
                (perfBalPerPT0, perfBalPerPT1) :
                (perfBalPerPT1, perfBalPerPT0); 
        }

        uint256 newBalanceInPerPT = (currentBalanceIn + amountIn).divDown(totalSupply);
        uint256 newBalanceOutPerPT = (currentBalanceOut - amountOut).divDown(totalSupply);

        require(newBalanceOutPerPT >= perfBalPerPTOut.mulUp(maxBalOffset), "error: min balance out is not met");

        uint256 newTVLPerPT = newBalanceInPerPT.add(newBalanceOutPerPT.mulDown(relativePrice));
        uint256 oldTVLPerPT = perfBalPerPTIn.add(perfBalPerPTOut.mulDown(relativePrice));

        require(newTVLPerPT >= oldTVLPerPT.mulUp(maxTVLOffset), "error: low tvl");
    }

    /**
    * Setters
    */
    function setSigner(address signer) external authenticate whenNotPaused {
        _setSigner(signer);
    }

    function _setSigner(address signer) internal {
        require(signer != address(0), "error: signer cannot be a null address");
        _signer = signer;
    }

    function setPerfUpdateInterval(uint256 performanceUpdateInterval) external authenticate whenNotPaused {
        _setPerfUpdateInterval(performanceUpdateInterval);
    }

    function _setPerfUpdateInterval(uint256 performanceUpdateInterval) internal {

        // insertUint checks if the new value exceeds the given bit slot
        _packedPerfParameters = _packedPerfParameters.insertUint(
            performanceUpdateInterval,
            _PERF_UPDATE_INTERVAL_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );

        emit PerformanceUpdateIntervalChanged(performanceUpdateInterval);
    }    
    
    function setMaxTVLoffset(uint256 maxTVLoffset) external authenticate whenNotPaused {
        _setMaxTVLoffset(maxTVLoffset);
    }
    
    function _setMaxTVLoffset(uint256 maxTVLoffset) internal {
        _packedPerfParameters = _packedPerfParameters.insertUint(
            maxTVLoffset,
            _MAX_TVL_OFFSET_BIT_OFFSET,
            _MAX_TVL_OFFSET_BIT_LENGTH
        );
    }
    
    function setMaxBalOffset(uint256 maxBalOffset) external authenticate whenNotPaused {
        _setMaxBalOffset(maxBalOffset);
    }
    
    function _setMaxBalOffset(uint256 maxBalOffset) internal {
        _packedPerfParameters = _packedPerfParameters.insertUint(
            maxBalOffset,
            _MAX_BAL_OFFSET_BIT_OFFSET,
            _MAX_BAL_OFFSET_BIT_LENGTH
        );
    }
    
    function setMaxQuoteOffset(uint256 maxQuoteOffset) external authenticate whenNotPaused {
        _setMaxQuoteOffset(maxQuoteOffset);
    }
    
    function _setMaxQuoteOffset(uint256 maxQuoteOffset) internal {
        _packedPricingParameters = _packedPricingParameters.insertUint(
            maxQuoteOffset,
            _MAX_QUOTE_OFFSET_BIT_OFFSET,
            _MAX_QUOTE_OFFSET_BIT_LENGTH
        );
    }
    
    function setMaxPriceOffet(uint256 maxPriceOffet) external authenticate whenNotPaused {
        _setMaxPriceOffet(maxPriceOffet);
    }
    
    function _setMaxPriceOffet(uint256 maxPriceOffet) internal {
        _packedPricingParameters = _packedPricingParameters.insertUint(
            maxPriceOffet,
            _MAX_PRICE_OFFSET_BIT_OFFSET,
            _MAX_PRICE_OFFSET_BIT_LENGTH
        );
    }

    function updatePerformance() external nonReentrant {
        (   ,
            ,
            uint256 lastPerfUpdate,
            uint256 perfUpdateInterval
        ) = _getPerfParameters();

        require(block.timestamp > lastPerfUpdate + perfUpdateInterval, "error: too soon");

        uint256 relativePrice = _getRelativePrice(_token0);

        (
            ,
            uint256[] memory balances,
        ) = getVault().getPoolTokens(getPoolId());

        _updatePerformance(balances[0], balances[1], relativePrice, totalSupply()); 
    }

    function _updatePerformance(
        uint256 balance0,
        uint256 balance1,
        uint256 relativePrice,
        uint256 totalSupply
    ) private {
        
        uint256 currentTVLPerPT = (balance0.add(balance1.mulDown(relativePrice))).divDown(totalSupply);
        
        (uint256 perfBalPerPT0, uint256 perfBalPerPT1) = getPerfBalancesPerPT();
        
        uint256 oldTVLPerPT = perfBalPerPT0.add(perfBalPerPT1.mulDown(relativePrice));
        
        uint256 ratio = currentTVLPerPT.divDown(oldTVLPerPT);

        perfBalPerPT0 = perfBalPerPT0.mulDown(ratio);
        perfBalPerPT1 = perfBalPerPT1.mulDown(ratio);

        _setPerfBalancesPerPT(perfBalPerPT0, perfBalPerPT1);
    }

    function _setPerfBalancesPerPT(uint256 perfBalancePerPT0, uint256 perfBalancePerPT1) private {
        
        bytes32 perfBalancesPerPT = WordCodec.encodeUint(
                perfBalancePerPT0,
                _PERF_BAL_BIT_OFFSET_0,
                _PERF_BAL_BIT_LENGTH
        );
        
        perfBalancesPerPT = perfBalancesPerPT.insertUint(
                perfBalancePerPT1,
                _PERF_BAL_BIT_OFFSET_1,
                _PERF_BAL_BIT_LENGTH
        );

        _perfBalancesPerPT = perfBalancesPerPT;

        _packedPerfParameters = _packedPerfParameters.insertUint(
            block.timestamp,
            _PERF_LAST_UPDATE_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );
    }

    /**
    * Getters
    */
    function getPerfBalancesPerPT() public view returns(uint256 perfBalancePerPT0, uint256 perfBalancePerPT1) {
        
        bytes32 perfBalancesPerPT = _perfBalancesPerPT;
    
        perfBalancePerPT0 = perfBalancesPerPT.decodeUint(
                _PERF_BAL_BIT_OFFSET_0,
                _PERF_BAL_BIT_LENGTH
        );
        
        perfBalancePerPT1 = perfBalancesPerPT.decodeUint(
                _PERF_BAL_BIT_OFFSET_1,
                _PERF_BAL_BIT_LENGTH
        );
    
    }

    function _getRelativePrice(IERC20 tokenIn) internal view returns(uint256) {
        
        uint256 price0 = ChainlinkUtils.getLatestPrice(_oracle0);
        uint256 price1 = ChainlinkUtils.getLatestPrice(_oracle1);

        // uint256 scalingFactorTokenIn = _scalingFactor(request.tokenIn);
        // uint256 scalingFactorTokenOut = _scalingFactor(request.tokenOut);

        // balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
        // balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);
        // TODO check for overflow
        price0 *= _scaleFactor0;
        price1 *= _scaleFactor1;
        
        return tokenIn == _token0? price1.divDown(price0) : price0.divDown(price1); 
    }

    function _getPerfParameters() internal view
    returns(
        uint256 maxTVLOffset,
        uint256 maxBalOffset,
        uint256 lastPerfUpdate,
        uint256 perfUpdateInterval
    ) {

        bytes32 packedPerfParameters = _packedPerfParameters;

        maxTVLOffset = packedPerfParameters.decodeUint(
            _MAX_TVL_OFFSET_BIT_OFFSET,
            _MAX_TVL_OFFSET_BIT_LENGTH
        );

        maxBalOffset = packedPerfParameters.decodeUint(
            _MAX_BAL_OFFSET_BIT_OFFSET,
            _MAX_BAL_OFFSET_BIT_LENGTH
        );

        lastPerfUpdate = packedPerfParameters.decodeUint(
            _PERF_LAST_UPDATE_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );

        perfUpdateInterval = packedPerfParameters.decodeUint(
            _PERF_UPDATE_INTERVAL_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );

    }

    function _getPricingParameters() internal view
    returns(
        uint256 maxQuoteOffset,
        uint256 maxPriceOffset
    ) {

        bytes32 packedPricingParameters = _packedPricingParameters;

        maxQuoteOffset = packedPricingParameters.decodeUint(
            _MAX_QUOTE_OFFSET_BIT_OFFSET,
            _MAX_QUOTE_OFFSET_BIT_LENGTH
        );
        
        maxPriceOffset = packedPricingParameters.decodeUint(
            _MAX_QUOTE_OFFSET_BIT_OFFSET,
            _MAX_QUOTE_OFFSET_BIT_LENGTH
        );

    }

    function getPoolParameters() public view
    returns (
        uint256 maxQuoteOffset,
        uint256 maxPriceOffset,
        uint256 maxTVLOffset,
        uint256 maxBalOffset,
        uint256 lastPerfUpdate,
        uint256 perfUpdateInterval
    ) {
        (maxQuoteOffset, maxPriceOffset) = _getPricingParameters();

        (
            maxTVLOffset,
            maxBalOffset,
            lastPerfUpdate,
            perfUpdateInterval
        ) = _getPerfParameters();
    }

    function signer() public view override returns(address signerAddress){
        return _signer;
        // assembly {
        //     signerAddress := shr(sload(_packedData.slot), _SIGNER_ADDRESS_OFFSET)
        // }
    }

    function _getAmountsInOutAfterSlippage(
        IVault.SwapKind kind,
        uint256 fixedAmount,
        uint256 deadline,
        bytes memory swapData
    ) internal pure returns(uint256 amountIn, uint256 amountOut){
        (
            uint256 variableAmount,
            uint256 slippageParameter,
            uint256 startTime
        ) = _decodeSwapSlippageData(swapData);

        (amountIn, amountOut) = _applySlippage(
            kind,
            fixedAmount,
            variableAmount,
            slippageParameter,
            startTime,
            deadline
        );
    }

    function _decodeSwapSlippageData(bytes memory swapData)
    internal pure 
    returns(
        uint256 variableAmount,
        uint256 slippageParameter,
        uint256 startTime
    ) {
        (
            ,
            ,
            variableAmount,
            slippageParameter,
            startTime
        ) = abi.decode(swapData, (uint256, uint256, uint256, uint256, uint256));
    }

    function _decodeQuoteBalanceData(bytes memory swapData)
    internal pure
    returns(
        uint256 quoteBalanceIn,
        uint256 quoteBalanceOut
    ) {
        (
            quoteBalanceIn,
            quoteBalanceOut
        ) = abi.decode(swapData, (uint256, uint256));
    }

    // Missing implementations:
    function _applySlippage(
        IVault.SwapKind kind,
        uint256 fixedAmount,
        uint256 variableAmount,
        uint256 slippageParameter,
        uint256 startTime,
        uint256 deadline
    ) internal pure returns(uint256 amountIn, uint256 amountOut) {

        if (kind == IVault.SwapKind.GIVEN_IN) {
            return (fixedAmount, _decreaseAmountOut(variableAmount, slippageParameter, startTime, deadline));
        }

        return (_increaseAmountIn(variableAmount, slippageParameter, startTime, deadline) , fixedAmount);

    }
    
    function _decreaseAmountOut(
        uint256 amountOut,
        uint256 slippageParameter,
        uint256 startTime,
        uint256 deadline
    ) internal pure returns(uint256){
        return(amountOut);
    }
    
    function _increaseAmountIn(
        uint256 amountIn,
        uint256 slippageParameter,
        uint256 startTime,
        uint256 deadline
    ) internal pure returns(uint256) {
        return (amountIn);
    }

    function _scalingFactors() internal override view returns (uint256[] memory) {
        uint256[] memory a;
        return a;
    }

        // Missing implementations:
    function _scalingFactor(IERC20 token) internal override view returns (uint256) {
        return 0;
    }

    function _onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256 bptAmountOut, uint256[] memory amountsIn){

    }

    function _onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256 bptAmountIn, uint256[] memory amountsOut){
        return (bptAmountIn, amountsOut);
    }

    function _onInitializePool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256 bptAmountOut, uint256[] memory amountsIn) {
        return (bptAmountOut, amountsIn);
    }

    function _doRecoveryModeExit(
        uint256[] memory balances,
        uint256 totalSupply,
        bytes memory userData
    ) internal override returns (uint256 bptAmountIn, uint256[] memory amountsOut) {
        return (bptAmountIn, amountsOut);
    }

    function _getTotalTokens() internal view override returns (uint256) {
        return _NUM_TOKENS;
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return _NUM_TOKENS;
    }

}