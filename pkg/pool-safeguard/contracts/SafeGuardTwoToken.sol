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

abstract contract SafeGuardBasePool is SignatureSafeguard, BasePool, IMinimalSwapInfoPool, ReentrancyGuard {
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    uint256 private constant _NUM_TOKENS = 2;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    
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
        AggregatorV3Interface[] memory oracles,
        address[] memory assetManagers,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        uint256 performanceUpdateInterval
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
        // add upscaling
        uint256 numTokens = tokens.length;
        // TODO add error msg
        require(numTokens == _NUM_TOKENS, "error");
        InputHelpers.ensureInputLengthMatch(numTokens, oracles.length);

        _token0 = tokens[0];
        _token1 = tokens[1];

        _oracle0 = oracles[0];
        _oracle1 = oracles[1];

        // TODO: verify decimals < 77 ?
        // 10**77 overflows
        uint256 decimals0 = uint256(tokens[0].decimals()).add(oracles[0].decimals());
        uint256 decimals1 = uint256(tokens[1].decimals()).add(oracles[1].decimals());

        (_scaleFactor0, _scaleFactor1) = decimals0 > decimals1? 
            (uint256(1), 10**(decimals0 - decimals1)) : (10**(decimals1 - decimals0), uint256(1));

        // TODO add signer setter
        _setPerfUpdateInterval(performanceUpdateInterval);

    }

    function onSwap(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) external override onlyVault(request.poolId) returns (uint256) {
        
        IVault.SwapKind kind = request.kind;
        IERC20 tokenIn = request.tokenIn;
        uint256 amount = request.amount;

        (uint256 deadline, bytes memory swapData) = _swapSignatureSafeguard(
            kind,
            request.poolId,
            request.tokenIn,
            request.tokenOut,
            amount,
            request.to,
            request.userData
        );

        return _onSwapVerifiedSignature(
            swapData,
            kind,
            tokenIn,
            amount,
            balanceTokenIn,
            balanceTokenOut,
            deadline
        );
    }

    function _onSwapVerifiedSignature(
        bytes memory swapData,
        IVault.SwapKind kind,
        IERC20 tokenIn,
        uint256 amount,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 deadline
    ) private returns(uint256) {
        
        (
            uint256 variableAmount,
            uint256 quoteBalanceIn,
            uint256 quoteBalanceOut,
            uint256 slippageParameter // TODO add slippage
        ) = _decodeSwapUserData(swapData);

        (uint256 maxQuoteOffset, uint256 maxPriceOffset) = _getPricingParameters();

        _QuoteBalanceSafeguard(
            balanceTokenIn,
            balanceTokenOut,
            quoteBalanceIn,
            quoteBalanceOut,
            maxQuoteOffset
        );

        (uint256 amountIn, uint256 amountOut) = kind == IVault.SwapKind.GIVEN_IN?
        (amount, _decreaseAmountOut(variableAmount, deadline)) :
        (_increaseAmountIn(variableAmount, deadline), amount);

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
            relativePrice
        );

        if (kind == IVault.SwapKind.GIVEN_IN) {
            return _subtractSwapFeeAmount(amountOut);
        } else {
            return _addSwapFeeAmount(amountIn);
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
        uint256 lastChangeBlock,
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
        // TODO check if userData length bigger or smaller than expected what happens
        JoinKind kind;
        
        (kind, amountsIn) = abi.decode(userData, (JoinKind, uint256[]));
        
        _require(kind == JoinKind.INIT, Errors.UNINITIALIZED);
        _require(amountsIn.length == _NUM_TOKENS, Errors.TOKENS_LENGTH_MUST_BE_2);

        // TODO define it better 
        bptAmountOut = 100 ether;

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

        JoinKind kind;

        (kind, userData) = abi.decode(userData, (JoinKind, bytes));

        if(kind == JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT) {

            return _joinTokenInForExactBPTOut(balances, userData);

        } else if (kind == JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {

            return _joinAllTokenInForBPTOut(poolId, receiver, balances, userData);

        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }

    }

    function _joinTokenInForExactBPTOut(
        uint256[] memory balances,
        bytes memory userData
    ) internal returns (uint256, uint256[] memory) {
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

    function _joinAllTokenInForBPTOut(
        bytes32 poolId,
        address receiver,
        uint256[] memory balances,
        bytes memory userData
    ) internal returns (uint256, uint256[] memory) {
        
        (
            uint256 deadline,
            bytes memory joinPoolData
        ) = _joinPoolSignatureSafeguard(
                JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT,
                poolId,
                receiver,
                userData
        );

        (
            uint256 minBptAmountOut,
            IERC20 sellToken, // add enum SELL TOKEN0 OR BUY TOKEN0
            uint256 maxSwapAmountIn, // TODO This should be signed
            uint256 amountIn0,
            uint256 amountIn1,
            bytes memory swapData
        ) = _decodeJoinPoolUserData(joinPoolData);

        uint256 r0 = amountIn0.divDown(balances[0]);
        uint256 r1 = amountIn1.divDown(balances[1]);
        (uint256 rMin, uint256 rMax, IERC20 tokenInExcess) = r0 > r1? (r1, r0, _token0) : (r0, r1, _token1);

        require(tokenInExcess == sellToken, "error: wrong defaulted token");

        (
            uint256 balanceTokenIn,
            uint256 balanceTokenOut,
            uint256 swappableAmountIn
        ) = tokenInExcess == _token0? 
            (balances[0], balances[1], amountIn0.mulDown(r0-r1)) :
            (balances[1], balances[0], amountIn1.mulDown(r1-r0));

        require(maxSwapAmountIn <= swappableAmountIn, "error: exceeds swappable amount in when joining pool");

        uint256 maxSwappedTokenOut = _onSwapVerifiedSignature(
            swapData,
            IVault.SwapKind.GIVEN_IN,
            sellToken,
            maxSwapAmountIn,
            balanceTokenIn,
            balanceTokenOut,
            deadline
        );

        // amountIn = relativePrice * amountOut 
        uint256 relativePrice = maxSwapAmountIn.divDown(maxSwappedTokenOut);

        uint256 swappedTokenOut = FixedPoint.divDown(
            (rMax - rMin),
            (balanceTokenIn.divUp(balanceTokenOut)).add(relativePrice.divDown(balanceTokenIn))
        );

        uint256 optimalRatio = rMin.add(swappedTokenOut.mulDown(balanceTokenOut));        
        
        uint256 bptAmountOut = optimalRatio.mulDown(totalSupply());

        require(bptAmountOut >= minBptAmountOut, "error: min bpt amount out not respected");

        uint256[] memory amountsIn = new uint256[](_NUM_TOKENS);
        amountsIn[0] = amountIn0;
        amountsIn[1] = amountIn1;

        return (bptAmountOut, amountsIn);
    }

    /**
        def get_sas(
        r_1, r_2,
        a_1, a_2,
        b_1, b_2,
        midmarket_12,
        dynfees_12_real,
        dynfees_12_estimate_error_per
    ):
        if r_1 > r_2:
            p = midmarket_12 * (1 + dynfees_12_real * (1 + dynfees_12_estimate_error_per / 100))
            sa_2 = (b_2 * a_1 / b_1 - a_2) / (1 + b_2 * p / b_1)
            sa_1 = sa_2 * p
        else:
            p = (1 / midmarket_12) * (1 + dynfees_12_real * (1 + dynfees_12_estimate_error_per / 100))
            # p = (1 / midmarket_12) * (1 + dynfees_12_real)
            sa_1 = (a_1 - b_1 * a_2 / b_2) / (1 + b_1 * p / b_2)
            sa_2 = sa_1 * p

        return sa_1, sa_2
    */

    /**
        r_opt = min((a_1 - sa_1_opt) / b_1, (a_2 + sa_2_opt) / b_2)
    */

    function _decodeJoinPoolUserData(bytes memory joinPoolData)
    internal pure
    returns(
        uint256 minBptAmountOut,
        IERC20 sellToken, // add enum SELL TOKEN0 OR BUY TOKEN0
        uint256 maxSwapAmountIn, // TODO This should be signed
        uint256 amountIn0,
        uint256 amountIn1,
        bytes memory swapUserData
    ){
        
        (
            minBptAmountOut,
            sellToken, // add enum SELL TOKEN0 OR BUY TOKEN0
            maxSwapAmountIn, // TODO This should be signed
            amountIn0,
            amountIn1,
            swapUserData
        ) = abi.decode(joinPoolData, (uint256, IERC20, uint256, uint256, uint256, bytes));

    }

    function _decodeSwapUserData(bytes memory swapData) internal pure 
    returns(uint256 limit, uint256 quoteBalance0, uint256 quoteBalance1, uint256 slippageParameter){
        // TODO check if uint128 uses less gas than uint256 
        (
            limit,
            quoteBalance0,
            quoteBalance1,
            slippageParameter
        ) = abi.decode(swapData, (uint256, uint256, uint256, uint256));
    }

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
        require(quoteBalanceIn.divDown(oldBalanceIn) > maxQuoteOffset, "error: quote balance no longer valid");
        require(quoteBalanceOut.divDown(oldBalanceOut) > maxQuoteOffset, "error: quote balance no longer valid");
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
        IERC20 tokenIn,
        uint256 currentBalanceIn,
        uint256 currentBalanceOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 relativePrice
    ) internal {

        (   uint256 maxTVLOffset,
            uint256 maxBalOffset,
            uint256 lastPerfUpdate,
            uint256 perfUpdateInterval
        ) = _getPerfParameters();

        // lastPerfUpdate & perfUpdateInterval are stored in 64 bits so they cannot overflow
        if(block.timestamp > lastPerfUpdate + perfUpdateInterval){
            _updatePerformance(currentBalanceIn, currentBalanceOut, relativePrice);
        }

        (uint256 perfBalPerPT0, uint256 perfBalPerPT1) = getPerfBalancesPerPT();

        (uint256 perfBalPerPTIn, uint256 perfBalPerPTOut) = tokenIn == _token0?
            (perfBalPerPT0, perfBalPerPT1) :
            (perfBalPerPT1, perfBalPerPT0); 

        uint256 totalSupply = totalSupply();

        uint256 newBalanceInPerPT = (currentBalanceIn + amountIn).divDown(totalSupply);
        uint256 newBalanceOutPerPT = (currentBalanceOut + amountOut).divDown(totalSupply);

        require(newBalanceOutPerPT >= perfBalPerPTOut.mulUp(maxBalOffset), "error: min balance out is not met");

        uint256 newTVLPerPT = newBalanceInPerPT.add(newBalanceOutPerPT.mulDown(relativePrice));
        uint256 oldTVLPerPT = perfBalPerPTIn.add(perfBalPerPTOut.mulDown(relativePrice));

        require(newTVLPerPT >= oldTVLPerPT.mulUp(maxTVLOffset), "error: low tvl");
    }

    /**
    * Setters
    */
    /**
     * @notice Set the performance update interval.
     * @dev This is a permissioned function, and disabled if the pool is paused.
     * Emits the PerformanceUpdateIntervalChanged event.
     */
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

        _updatePerformance(balances[0], balances[1], relativePrice); 
    }

    function _updatePerformance(uint256 balance0, uint256 balance1, uint256 relativePrice) private {
        
        uint256 totalSupply = totalSupply();
        
        balance0 = balance0.divDown(totalSupply);
        balance1 = balance1.divDown(totalSupply);
        
        uint256 currentTVL = balance0.add(balance1.mulDown(relativePrice));
        
        (uint256 perfBalPerPT0, uint256 perfBalPerPT1) = getPerfBalancesPerPT();
        
        uint256 oldTVL = perfBalPerPT0.add(perfBalPerPT1.mulDown(relativePrice));
        
        uint256 ratio = currentTVL.divDown(oldTVL);

        balance0 = balance0.mulDown(ratio);
        balance1 = balance1.mulDown(ratio);

        _setPerfBalancesPerPT(balance0, balance0);
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


    function _addQuoteSlippage(
        uint256 amountIn,
        uint256 amountOut,
        uint256 deadline
    ) internal virtual view returns(uint256, uint256);
    function _decreaseAmountOut(uint256 amountIn, uint256 deadline) internal view virtual returns(uint256);
    function _increaseAmountIn(uint256 amountIn, uint256 deadline) internal view virtual returns(uint256);
}