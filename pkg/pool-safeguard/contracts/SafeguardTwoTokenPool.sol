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

import "./ChainlinkUtils.sol";
import "./SafeguardMath.sol";
import "./SignatureSafeguard.sol";
import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IMinimalSwapInfoPool.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/EOASignaturesValidator.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/BasePoolMath.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-safeguard/SafeguardPoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-safeguard/ISafeguardPool.sol";

// import "hardhat/console.sol";

contract SafeguardTwoTokenPool is ISafeguardPool, SignatureSafeguard, BasePool, IMinimalSwapInfoPool, ReentrancyGuard {
    
    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using BasePoolUserData for bytes;
    using SafeguardPoolUserData for bytes;

    uint256 private constant _NUM_TOKENS = 2;
    uint256 private constant _INITIAL_BPT = 100 ether;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    
    AggregatorV3Interface internal immutable _oracle0;
    AggregatorV3Interface internal immutable _oracle1;

    // tokens scale factor
    uint256 internal immutable _scaleFactor0;
    uint256 internal immutable _scaleFactor1;

    // oracle price scale factor
    uint256 internal immutable _priceScaleFactor0;
    uint256 internal immutable _priceScaleFactor1;

    address private _signer;

    // Management fees related variables
    uint32 private _previousClaimTime;
    // For a max fee of 10% it is safe to use 32 bits for the yearlyRate. For higher fees more bits should be allocated.
    uint32 private _yearlyRate;

    // Allowlist enabled
    bool private _allowlistEnabled;

    uint256 private constant _CLAIM_FEES_FREQUENCY = 1 hours;
    uint256 private constant _MIN_YEARLY_FEES = 0;
    uint256 private constant _MAX_YEARLY_FEES = 5e16; // corresponds to 5% fees
    
    // [ max TVL offset | max perf balance offset | max price offset | perf update interval | last perf update ]
    // [     64 bits    |         64 bits         |      64 bits     |        32 bits       |      32 bits     ]
    // [ MSB                                                                            LSB ]
    bytes32 private _packedPoolParameters;

    // used to determine if the pool is underperforming
    uint256 private constant _MAX_TVL_OFFSET_BIT_OFFSET = 192;
    uint256 private constant _MAX_TVL_OFFSET_BIT_LENGTH = 64;

    // used to determine if the pool is underperforming
    uint256 private constant _MAX_BAL_OFFSET_BIT_OFFSET = 128;
    uint256 private constant _MAX_BAL_OFFSET_BIT_LENGTH = 64;

    // used to determine if the pool is underperforming
    uint256 private constant _MAX_PRICE_OFFSET_BIT_OFFSET = 96;
    uint256 private constant _MAX_PRICE_OFFSET_BIT_LENGTH = 64;

    // used to determine if a performance update is needed before a swap / one-asset-join / one-asset-exit
    uint256 private constant _PERF_UPDATE_INTERVAL_BIT_OFFSET = 32;
    uint256 private constant _PERF_LAST_UPDATE_BIT_OFFSET = 0;
    uint256 private constant _PERF_TIME_BIT_LENGTH = 32;
    
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
            _getMinSwapFeePercentage(),
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {

        InputHelpers.ensureInputLengthMatch(tokens.length, _NUM_TOKENS);
        InputHelpers.ensureInputLengthMatch(oracles.length, _NUM_TOKENS);
    
        _token0 = IERC20(address(tokens[0]));
        _token1 = IERC20(address(tokens[1]));

        _oracle0 = oracles[0];
        _oracle1 = oracles[1];

        _scaleFactor0 = _computeScalingFactor(tokens[0]);
        _scaleFactor1 = _computeScalingFactor(tokens[1]);

        _priceScaleFactor0 = ChainlinkUtils.computePriceScalingFactor(oracles[0]);
        _priceScaleFactor1 = ChainlinkUtils.computePriceScalingFactor(oracles[1]);

        _setSigner(safeguardParameters.signer);
        _setMaxTVLoffset(safeguardParameters.maxTVLoffset);
        _setMaxBalOffset(safeguardParameters.maxBalOffset);
        _setPerfUpdateInterval(safeguardParameters.perfUpdateInterval);
        _setMaxPriceOffset(safeguardParameters.maxPriceOffet);
  
    }

    function onSwap(
        SwapRequest calldata request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) external override onlyVault(request.poolId) returns (uint256) {

        _beforeSwapJoinExit();

        bytes memory swapData = _swapSignatureSafeguard(
            request.kind,
            request.tokenIn,
            request.from,
            request.to,
            request.userData
        );
        
        uint256 scalingFactorTokenIn = _scalingFactor(request.tokenIn);
        uint256 scalingFactorTokenOut = _scalingFactor(request.tokenOut);

        balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
        balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);

        (
            uint256 quoteAmountInPerOut,
            uint256 maxSwapAmount
        ) = SafeguardMath.getQuoteAmountInPerOut(swapData, balanceTokenIn, balanceTokenOut);

        if(request.kind == IVault.SwapKind.GIVEN_IN) {
            return _onSwapGivenIn(
                request.tokenIn,
                balanceTokenIn,
                balanceTokenOut,
                request.amount,
                quoteAmountInPerOut,
                maxSwapAmount,
                scalingFactorTokenIn,
                scalingFactorTokenOut
            );
        }

        return _onSwapGivenOut(
            request.tokenIn,
            balanceTokenIn,
            balanceTokenOut,
            request.amount,
            quoteAmountInPerOut,
            maxSwapAmount,
            scalingFactorTokenIn,
            scalingFactorTokenOut
        );

    }

    function _onSwapGivenIn(
        IERC20 tokenIn,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 amountIn,
        uint256 quoteAmountInPerOut,
        uint256 maxSwapAmountIn,
        uint256 scalingFactorTokenIn,
        uint256 scalingFactorTokenOut
    ) internal returns(uint256) {
        amountIn = _upscale(amountIn, scalingFactorTokenIn);
        uint256 amountOut = amountIn.divDown(quoteAmountInPerOut);

        _validateSwap(
            IVault.SwapKind.GIVEN_IN,
            tokenIn,
            balanceTokenIn,
            balanceTokenOut,
            amountIn,
            amountOut,
            quoteAmountInPerOut,
            maxSwapAmountIn
        );

        return _downscaleDown(amountOut, scalingFactorTokenOut);
    }

    function _onSwapGivenOut(
        IERC20 tokenIn,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 amountOut,
        uint256 quoteAmountInPerOut,
        uint256 maxSwapAmountOut,
        uint256 scalingFactorTokenIn,
        uint256 scalingFactorTokenOut
    ) internal returns(uint256) {
        amountOut = _upscale(amountOut, scalingFactorTokenOut);
        uint256 amountIn = amountOut.mulUp(quoteAmountInPerOut);

        _validateSwap(
            IVault.SwapKind.GIVEN_OUT,
            tokenIn,
            balanceTokenIn,
            balanceTokenOut,
            amountIn,
            amountOut,
            quoteAmountInPerOut,
            maxSwapAmountOut
        );

        return _downscaleUp(amountIn, scalingFactorTokenIn);
    }

    /**
    * @dev all the inputs should be normalized to 18 decimals regardless of token decimals
    */
    function _validateSwap(
        IVault.SwapKind kind,
        IERC20  tokenIn,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 quoteAmountInPerOut,
        uint256 maxSwapAmount
    ) private {

        if(kind == IVault.SwapKind.GIVEN_IN) {
            require(amountIn <= maxSwapAmount, "error: exceeded swap amount in");
        } else {
            require(amountOut <= maxSwapAmount, "error: exceeded swap amount out");
        }

        uint256 onChainAmountInPerOut = _getOnChainAmountInPerOut(tokenIn);

        _fairPricingSafeguard(
            quoteAmountInPerOut,
            onChainAmountInPerOut
        );

        _perfBalancesSafeguard(
            tokenIn,
            balanceTokenIn,
            balanceTokenOut,
            balanceTokenIn.add(amountIn),
            balanceTokenOut.sub(amountOut),
            onChainAmountInPerOut
        );

    }

    function _fairPricingSafeguard(
        uint256 quoteAmountInPerOut,
        uint256 onChainAmountInPerOut
    ) internal view {
        uint256 maxPriceOffset = _getMaxPriceOffset();
        require(quoteAmountInPerOut.divDown(onChainAmountInPerOut) >= maxPriceOffset, "error: unfair price");
    }

    function _perfBalancesSafeguard(
        IERC20  tokenIn,
        uint256 currentBalanceIn,
        uint256 currentBalanceOut,
        uint256 newBalanceIn,
        uint256 newBalanceOut,
        uint256 onChainAmountInPerOut
    ) internal {

        uint256 totalSupply = totalSupply();

        (
            uint256 maxTVLOffset,
            uint256 maxBalOffset,
            uint256 lastPerfUpdate,
            uint256 perfUpdateInterval
        ) = _getPerfParameters();

        // lastPerfUpdate & perfUpdateInterval are stored in 32 bits so they cannot overflow
        if(block.timestamp > lastPerfUpdate + perfUpdateInterval){
            if(tokenIn == _token0){
                _updatePerformance(currentBalanceIn, currentBalanceOut, onChainAmountInPerOut, totalSupply);
            } else {
                _updatePerformance(
                    currentBalanceOut,
                    currentBalanceIn,
                    FixedPoint.ONE.divDown(onChainAmountInPerOut),
                    totalSupply
                );
            }
        }

        uint256 perfBalPerPTIn;
        uint256 perfBalPerPTOut;

        {        
            (uint256 perfBalPerPT0, uint256 perfBalPerPT1) = getPerfBalancesPerPT();

            (perfBalPerPTIn, perfBalPerPTOut) = tokenIn == _token0?
                (perfBalPerPT0, perfBalPerPT1) :
                (perfBalPerPT1, perfBalPerPT0); 
        }

        uint256 newBalanceInPerPT = newBalanceIn.divDown(totalSupply);
        uint256 newBalanceOutPerPT = newBalanceOut.divDown(totalSupply);

        require(newBalanceOutPerPT >= perfBalPerPTOut.mulUp(maxBalOffset), "error: min balance out is not met");

        uint256 newTVLPerPT = (newBalanceInPerPT.divDown(onChainAmountInPerOut)).add(newBalanceOutPerPT);
        uint256 oldTVLPerPT = (perfBalPerPTIn.divDown(onChainAmountInPerOut)).add(perfBalPerPTOut);

        require(newTVLPerPT >= oldTVLPerPT.mulUp(maxTVLOffset), "error: low tvl");
    }

    function _onInitializePool(
        bytes32, // poolId,
        address sender,
        address, // recipient,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {

        if(isAllowlistEnabled()) {
            userData = _isLPAllowed(sender, userData);
        }

        (SafeguardPoolUserData.JoinKind kind, uint256[] memory amountsIn) = userData.initJoin();
        
        _require(kind == SafeguardPoolUserData.JoinKind.INIT, Errors.UNINITIALIZED);
        _require(amountsIn.length == _NUM_TOKENS, Errors.TOKENS_LENGTH_MUST_BE_2);
        
        _upscaleArray(amountsIn, scalingFactors);

        // set perf balances & set last perf update time to current block.timestamp
        _setPerfBalancesPerPT(amountsIn[0].divDown(_INITIAL_BPT), amountsIn[1].divDown(_INITIAL_BPT));

        return (_INITIAL_BPT, amountsIn);
        
    }

    function _onJoinPool(
        bytes32, // poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256, // lastChangeBlock,
        uint256, // protocolSwapFeePercentage,
        uint256[] memory, // scalingFactors,
        bytes memory userData
    ) internal override returns (uint256 bptAmountOut, uint256[] memory amountsIn) {

        _beforeJoinExit();

        if(isAllowlistEnabled()) {
            userData = _isLPAllowed(sender, userData);
        }

        SafeguardPoolUserData.JoinKind kind = userData.joinKind();

        if(kind == SafeguardPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {

            return _joinAllTokensInForExactBPTOut(balances, totalSupply(), userData);

        } else if (kind == SafeguardPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {

            return _joinExactTokensInForBPTOut(sender, recipient, balances, userData);

        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    function _isLPAllowed(address sender, bytes memory userData) internal returns(bytes memory) {
        // we subtiture userData by the joinData
        return _validateAllowlistSignature(sender, userData);
    }

    function _joinAllTokensInForExactBPTOut(
        uint256[] memory balances,
        uint256 totalSupply,
        bytes memory userData
    ) private pure returns (uint256, uint256[] memory) {
        uint256 bptAmountOut = userData.allTokensInForExactBptOut();
        // Note that there is no maximum amountsIn parameter: this is handled by `IVault.joinPool`.

        uint256[] memory amountsIn = BasePoolMath.computeProportionalAmountsIn(balances, totalSupply, bptAmountOut);

        return (bptAmountOut, amountsIn);
    }

    function _joinExactTokensInForBPTOut(
        address sender,
        address recipient,
        uint256[] memory balances,
        bytes memory userData
    ) internal returns (uint256, uint256[] memory) {

        (
            uint256 minBptAmountOut,
            uint256[] memory joinAmounts,
            IERC20 swapTokenIn,
            bytes memory swapData
        ) = _joinExitSwapSignatureSafeguard(sender, recipient, userData);

        (uint256 excessTokenBalance, uint256 limitTokenBalance) = swapTokenIn == _token0?
            (balances[0], balances[1]) : (balances[1], balances[0]);

        (
            uint256 quoteAmountInPerOut,
            uint256 maxSwapAmountIn
        ) = SafeguardMath.getQuoteAmountInPerOut(swapData, excessTokenBalance, limitTokenBalance);

        (uint256 excessTokenAmountIn, uint256 limitTokenAmountIn) = swapTokenIn == _token0?
            (joinAmounts[0], joinAmounts[1]) : (joinAmounts[1], joinAmounts[0]);
        
        (
            uint256 swapAmountIn,
            uint256 swapAmountOut
        ) = SafeguardMath.calcJoinSwapAmounts(
            excessTokenBalance,
            limitTokenBalance,
            excessTokenAmountIn,
            limitTokenAmountIn,
            quoteAmountInPerOut
        );

        _validateSwap(
            IVault.SwapKind.GIVEN_IN,
            swapTokenIn,
            excessTokenBalance,
            limitTokenBalance,
            swapAmountIn,
            swapAmountOut,
            quoteAmountInPerOut,
            maxSwapAmountIn
        );

        uint256 rOpt = SafeguardMath.calcJoinSwapROpt(excessTokenBalance, excessTokenAmountIn, swapAmountIn);
        
        uint256 bptAmountOut = totalSupply().mulDown(rOpt);        
        require(bptAmountOut >= minBptAmountOut, "error: not enough bpt out");

        return (bptAmountOut, joinAmounts);

    }

    function _doRecoveryModeExit(
        uint256[] memory balances,
        uint256 totalSupply,
        bytes memory userData
    ) internal pure override returns (uint256 bptAmountIn, uint256[] memory amountsOut) {
        bptAmountIn = userData.recoveryModeExit();
        amountsOut = BasePoolMath.computeProportionalAmountsOut(balances, totalSupply, bptAmountIn);
    }

    function _onExitPool(
        bytes32, // poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256, // lastChangeBlock,
        uint256, // protocolSwapFeePercentage,
        uint256[] memory, // scalingFactors,
        bytes memory userData
    ) internal override returns (uint256 bptAmountIn, uint256[] memory amountsOut) {

        _beforeJoinExit();

        (SafeguardPoolUserData.ExitKind kind) = userData.exitKind();

        if(kind == SafeguardPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {

            return _exitExactBPTInForTokensOut(balances, totalSupply(), userData);

        } else if (kind == SafeguardPoolUserData.ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT) {
            
            return _exitBPTInForExactTokensOut(sender, recipient, balances, userData);

        } else {
            _revert(Errors.UNHANDLED_EXIT_KIND);
        }

    }

    function _exitExactBPTInForTokensOut(
        uint256[] memory balances,
        uint256 totalSupply,
        bytes memory userData
    ) private pure returns (uint256, uint256[] memory) {
        uint256 bptAmountIn = userData.exactBptInForTokensOut();
        // Note that there is no minimum amountOut parameter: this is handled by `IVault.exitPool`.

        uint256[] memory amountsOut = BasePoolMath.computeProportionalAmountsOut(balances, totalSupply, bptAmountIn);
        return (bptAmountIn, amountsOut);
    }

    function _exitBPTInForExactTokensOut(
        address sender,
        address recipient,
        uint256[] memory balances,
        bytes memory userData
    ) internal returns (uint256, uint256[] memory) {

        (
            uint256 maxBptAmountIn,
            uint256[] memory exitAmounts,
            IERC20 swapTokenIn,
            bytes memory swapData
        ) = _joinExitSwapSignatureSafeguard(sender, recipient, userData);

        (uint256 excessTokenBalance, uint256 limitTokenBalance) = swapTokenIn == _token0?
            (balances[1], balances[0]) : (balances[0], balances[1]);

        (
            uint256 quoteAmountInPerOut,
            uint256 maxSwapAmountIn
        ) = SafeguardMath.getQuoteAmountInPerOut(swapData, limitTokenBalance, excessTokenBalance);

        (uint256 excessTokenAmountOut, uint256 limitTokenAmountOut) = swapTokenIn == _token0?
            (exitAmounts[1], exitAmounts[0]) : (exitAmounts[0], exitAmounts[1]);

        (
            uint256 swapAmountIn,
            uint256 swapAmountOut
        ) = SafeguardMath.calcExitSwapAmounts(
            excessTokenBalance,
            limitTokenBalance,
            excessTokenAmountOut,
            limitTokenAmountOut,
            quoteAmountInPerOut
        );

        _validateSwap(
            IVault.SwapKind.GIVEN_IN,
            swapTokenIn,
            limitTokenBalance,
            excessTokenBalance,
            swapAmountIn,
            swapAmountOut,
            quoteAmountInPerOut,
            maxSwapAmountIn
        );

        uint256 rOpt = SafeguardMath.calcExitSwapROpt(excessTokenBalance, excessTokenAmountOut, swapAmountOut);
                
        uint256 bptAmountOut = totalSupply().mulDown(rOpt);
        
        require(bptAmountOut <= maxBptAmountIn, "error: exceeded burned bpt");

        return (bptAmountOut, exitAmounts);

    }

    /**
    * Setters
    */
    function setAllowlistBoolean(bool isAllowlistEnabled) external authenticate whenNotPaused {
        _setAllowlistBoolean(isAllowlistEnabled);
    }

    function _setAllowlistBoolean(bool isAllowlistEnabled) internal {
        _allowlistEnabled = isAllowlistEnabled;
    }

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
        _packedPoolParameters = _packedPoolParameters.insertUint(
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
        _packedPoolParameters = _packedPoolParameters.insertUint(
            maxTVLoffset,
            _MAX_TVL_OFFSET_BIT_OFFSET,
            _MAX_TVL_OFFSET_BIT_LENGTH
        );
    }
    
    function setMaxBalOffset(uint256 maxBalOffset) external authenticate whenNotPaused {
        _setMaxBalOffset(maxBalOffset);
    }
    
    function _setMaxBalOffset(uint256 maxBalOffset) internal {
        _packedPoolParameters = _packedPoolParameters.insertUint(
            maxBalOffset,
            _MAX_BAL_OFFSET_BIT_OFFSET,
            _MAX_BAL_OFFSET_BIT_LENGTH
        );
    }
      
    function setMaxPriceOffset(uint256 maxPriceOffset) external authenticate whenNotPaused {
        _setMaxPriceOffset(maxPriceOffset);
    }
    
    function _setMaxPriceOffset(uint256 maxPriceOffet) internal {
        _packedPoolParameters = _packedPoolParameters.insertUint(
            maxPriceOffet,
            _MAX_PRICE_OFFSET_BIT_OFFSET,
            _MAX_PRICE_OFFSET_BIT_LENGTH
        );
    }

    function updatePerformance() external nonReentrant {
        (   
            ,
            ,
            uint256 lastPerfUpdate,
            uint256 perfUpdateInterval
        ) = _getPerfParameters();

        require(block.timestamp > lastPerfUpdate + perfUpdateInterval, "error: too soon");

        (
            ,
            uint256[] memory balances,
        ) = getVault().getPoolTokens(getPoolId());

        _upscaleArray(balances, _scalingFactors());

        uint256 amount0Per1 = _getOnChainAmountInPerOut(_token0);

        _updatePerformance(balances[0], balances[1], amount0Per1, totalSupply()); 
    }

    // TODO we may add a (off-chain) reference price to prevent the update of the performance with a faulty oracle price
    function _updatePerformance(
        uint256 balance0,
        uint256 balance1,
        uint256 amount0Per1,
        uint256 totalSupply
    ) private {
        
        uint256 currentTVLPerPT = (balance0.add(balance1.mulDown(amount0Per1))).divDown(totalSupply);
        
        (uint256 perfBalPerPT0, uint256 perfBalPerPT1) = getPerfBalancesPerPT();
        
        uint256 oldTVLPerPT = perfBalPerPT0.add(perfBalPerPT1.mulDown(amount0Per1));
        
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

        _packedPoolParameters = _packedPoolParameters.insertUint(
            block.timestamp,
            _PERF_LAST_UPDATE_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );
    }

    /**
    * Getters
    */

    function isAllowlistEnabled() public view returns(bool) {
        return _allowlistEnabled;
    }

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

    /**
    * @notice returns the relative price such as: amountIn = relativePrice * amountOut
    */
    function _getOnChainAmountInPerOut(IERC20 tokenIn) internal view returns(uint256) {

        uint256 price0 = ChainlinkUtils.getLatestPrice(_oracle0);
        uint256 price1 = ChainlinkUtils.getLatestPrice(_oracle1);

        price0 = _upscale(price0, _priceScaleFactor0);
        price1 = _upscale(price1, _priceScaleFactor1);
        
        return tokenIn == _token0? price1.divDown(price0) : price0.divDown(price1); 
    }

    function getPoolParameters() public view
    returns (
        uint256 maxTVLOffset,
        uint256 maxBalOffset,
        uint256 maxPriceOffset,
        uint256 lastPerfUpdate,
        uint256 perfUpdateInterval
    ) {

        bytes32 packedPoolParameters = _packedPoolParameters;

        maxTVLOffset = packedPoolParameters.decodeUint(
            _MAX_TVL_OFFSET_BIT_OFFSET,
            _MAX_TVL_OFFSET_BIT_LENGTH
        );

        maxBalOffset = packedPoolParameters.decodeUint(
            _MAX_BAL_OFFSET_BIT_OFFSET,
            _MAX_BAL_OFFSET_BIT_LENGTH
        );

        maxPriceOffset = packedPoolParameters.decodeUint(
            _MAX_PRICE_OFFSET_BIT_OFFSET,
            _MAX_PRICE_OFFSET_BIT_LENGTH
        );

        lastPerfUpdate = packedPoolParameters.decodeUint(
            _PERF_LAST_UPDATE_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );

        perfUpdateInterval = packedPoolParameters.decodeUint(
            _PERF_UPDATE_INTERVAL_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );

    }

    function _getMaxPriceOffset() internal view returns (uint256 maxPriceOffset) {

        maxPriceOffset = _packedPoolParameters.decodeUint(
            _MAX_PRICE_OFFSET_BIT_OFFSET,
            _MAX_PRICE_OFFSET_BIT_LENGTH
        );

    }

    function _getPerfParameters() internal view
    returns (
        uint256 maxTVLOffset,
        uint256 maxBalOffset,
        uint256 lastPerfUpdate,
        uint256 perfUpdateInterval
    ) {

        bytes32 packedPoolParameters = _packedPoolParameters;

        maxTVLOffset = packedPoolParameters.decodeUint(
            _MAX_TVL_OFFSET_BIT_OFFSET,
            _MAX_TVL_OFFSET_BIT_LENGTH
        );

        maxBalOffset = packedPoolParameters.decodeUint(
            _MAX_BAL_OFFSET_BIT_OFFSET,
            _MAX_BAL_OFFSET_BIT_LENGTH
        );

        lastPerfUpdate = packedPoolParameters.decodeUint(
            _PERF_LAST_UPDATE_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );

        perfUpdateInterval = packedPoolParameters.decodeUint(
            _PERF_UPDATE_INTERVAL_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );

    }

    function signer() public view override returns(address signerAddress){
        return _signer;
        // assembly {
        //     signerAddress := shr(sload(_packedData.slot), _SIGNER_ADDRESS_OFFSET)
        // }
    }

    function _getTotalTokens() internal pure override returns (uint256) {
        return _NUM_TOKENS;
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return _NUM_TOKENS;
    }

    function _scalingFactors() internal view override returns (uint256[] memory) {
        uint256[] memory scalingFactors = new uint256[](_NUM_TOKENS);
        scalingFactors[0] = _scaleFactor0;
        scalingFactors[1] = _scaleFactor1;
        return scalingFactors;
    }

    function _scalingFactor(IERC20 token) internal view override returns (uint256) {
        if (token == _token0) {
            return _scaleFactor0;
        }
        return _scaleFactor1;
    }

    /*
    * Management fees
    */

    function _beforeJoinExit() private {
        claimManagementFees();
    }

    /**
    * @dev Claims management fees if necessary
    */
    function claimManagementFees() public {
        uint256 currentTime = block.timestamp;
        uint256 elapsedTime = currentTime.sub(uint256(_previousClaimTime));
        
        if(elapsedTime >= _CLAIM_FEES_FREQUENCY) {
            _previousClaimTime = uint32(currentTime);

            uint256 yearlyRate = uint256(_yearlyRate);
            
            if(yearlyRate > 0) {
                
                uint256 protocolFees = SafeguardMath.calcAccumulatedManagementFees(
                    elapsedTime,
                    yearlyRate,
                    totalSupply()
                );
            
                _payProtocolFees(protocolFees);
            }

        }
    }

    function setManagementFees(uint256 yearlyFees) external authenticate {
        _setManagementFees(yearlyFees);
    }

    // TODO see if we update management fees according to the latest protocolSwapFeePercentage
    function _setManagementFees(uint256 yearlyFees) private {
        require(yearlyFees <= _MAX_YEARLY_FEES, "error: fees too high");
        
        claimManagementFees();
        
        _yearlyRate = uint32(SafeguardMath.calcYearlyRate(yearlyFees));
    }

}