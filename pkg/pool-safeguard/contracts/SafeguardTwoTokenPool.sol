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
import "./SignatureTwoTokenSafeguard.sol";
import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IMinimalSwapInfoPool.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/EOASignaturesValidator.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/BasePoolMath.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-safeguard/SafeguardPoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-safeguard/ISafeguardPool.sol";

// import "hardhat/console.sol";

contract SafeguardTwoTokenPool is 
    ISafeguardPool, SignatureTwoTokenSafeguard, BasePool, IMinimalSwapInfoPool, ReentrancyGuard {
    
    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using BasePoolUserData for bytes;
    using SafeguardPoolUserData for bytes32;
    using SafeguardPoolUserData for bytes;

    uint256 private constant _NUM_TOKENS = 2;
    
    uint256 private constant _INITIAL_BPT = 100 ether;

    // Pool parameters constants
    uint256 private constant _MAX_PERFORMANCE_DEVIATION = 15e16; // 15%
    uint256 private constant _MAX_TARGET_DEVIATION = 20e16; // 20%
    uint256 private constant _MAX_PRICE_DEVIATION = 10e16; // 10%
    uint256 private constant _MIN_PERFORMANCE_UPDATE_INTERVAL = 1 hours;

    // NB Max yearly fee should fit in a 32 bits slot
    uint256 private constant _MAX_YEARLY_FEES = 10e16; // corresponds to 10% fees
    uint256 private constant _MIN_CLAIM_FEES_FREQUENCY = 1 hours;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    
    AggregatorV3Interface internal immutable _oracle0;
    AggregatorV3Interface internal immutable _oracle1;

    bool internal immutable _isStable0;
    bool internal immutable _isStable1;

    uint256 internal constant REPEG_PRICE_BOUND = 0.998e18; // repegs at 0.998
    uint256 internal constant UNPEG_PRICE_BOUND = 0.995e18; // unpegs at 0.995

    // tokens scale factor
    uint256 internal immutable _scaleFactor0;
    uint256 internal immutable _scaleFactor1;

    // oracle price scale factor
    uint256 internal immutable _priceScaleFactor0;
    uint256 internal immutable _priceScaleFactor1;

    // quote signer
    address private _signer;

    // Management fees related variables
    uint32 private _previousClaimTime;
    // For a max fee of 10% it is safe to use 32 bits for the yearlyRate. For higher fees more bits should be allocated.
    uint32 private _yearlyRate;

    // Allowlist enabled
    bool private _allowlistEnabled;
    
    // [ isPegged0 | isPegged1 | 1 - max performance dev | 1 - max hodl dev | 1 - max price dev | perf update interval | last perf update ]
    // [   1 bit   |   1 bit   |          62 bits        |      64 bits     |      64 bits      |        32 bits       |      32 bits     ]
    // [ MSB                                                                                                  LSB ]
    bytes32 private _packedPoolParameters;

    // used to determine if stable coin is holding the peg
    uint256 private constant _TOKEN_0_PEGGED_BIT_OFFSET = 255;
    uint256 private constant _TOKEN_1_PEGGED_BIT_OFFSET = 254;

    // used to determine if the pool is underperforming compared to the last performance update
    uint256 private constant _MAX_PERF_DEV_BIT_OFFSET = 192;
    uint256 private constant _MAX_PERF_DEV_BIT_LENGTH = 62;

    // used to determine if the pool balances deviated from the hodl reference
    uint256 private constant _MAX_TARGET_DEV_BIT_OFFSET = 128;
    uint256 private constant _MAX_TARGET_DEV_BIT_LENGTH = 64;

    // used to determine if the quote's price is too low compared to the oracle's price
    uint256 private constant _MAX_PRICE_DEV_BIT_OFFSET = 96;
    uint256 private constant _MAX_PRICE_DEV_BIT_LENGTH = 64;

    // used to determine if a performance update is needed before a swap / one-asset-join / one-asset-exit
    uint256 private constant _PERF_UPDATE_INTERVAL_BIT_OFFSET = 32;
    uint256 private constant _PERF_LAST_UPDATE_BIT_OFFSET = 0;
    uint256 private constant _PERF_TIME_BIT_LENGTH = 32;
    
    // [ min balance 0 per PT | min balance 1 per PT ]
    // [       128 bits       |       128 bits       ]
    // [ MSB                                     LSB ]
    bytes32 private _hodlBalancesPerPT; // benchmark target reserves based on performance

    uint256 private constant _HODL_BALANCE_BIT_OFFSET_0 = 128;
    uint256 private constant _HODL_BALANCE_BIT_OFFSET_1 = 0;
    uint256 private constant _HODL_BALANCE_BIT_LENGTH   = 128;

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
        _setMaxPerfDevComplement(safeguardParameters.maxPerfDev);
        _setMaxTargetDevComplement(safeguardParameters.maxTargetDev);
        _setMaxPriceDevComplement(safeguardParameters.maxPriceDev);
        _setPerfUpdateInterval(safeguardParameters.perfUpdateInterval);
        _setYearlyRate(safeguardParameters.yearlyFees);
        _setAllowlistBoolean(safeguardParameters.isAllowlistEnabled);
        _isStable0 = safeguardParameters.isStable0;
        _isStable1 = safeguardParameters.isStable1;
    }

    function onSwap(
        SwapRequest calldata request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) external override onlyVault(request.poolId) returns (uint256) {

        _beforeSwapJoinExit();

        bool isTokenInToken0 = request.tokenIn == _token0;

        bytes memory swapData = _swapSignatureSafeguard(
            request.kind,
            isTokenInToken0,
            request.from,
            request.to,
            request.userData
        );
        
        uint256 scalingFactorTokenIn = _scalingFactor(isTokenInToken0);
        uint256 scalingFactorTokenOut = _scalingFactor(!isTokenInToken0);

        balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
        balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);

        (
            uint256 quoteAmountInPerOut,
            uint256 maxSwapAmount
        ) = _getQuoteAmountInPerOut(swapData, balanceTokenIn, balanceTokenOut);

        if(request.kind == IVault.SwapKind.GIVEN_IN) {
            return _onSwapGivenIn(
                isTokenInToken0,
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
            isTokenInToken0,
            balanceTokenIn,
            balanceTokenOut,
            request.amount,
            quoteAmountInPerOut,
            maxSwapAmount,
            scalingFactorTokenIn,
            scalingFactorTokenOut
        );

    }

    /// @dev amountInPerOut = baseAmountInPerOut * (1 + slippagePenalty)
    function _getQuoteAmountInPerOut(
        bytes memory swapData,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal view returns (uint256, uint256) {
        
        (
            address expectedOrigin,
            uint256 originBasedSlippage,
            bytes32 priceBasedParams,
            bytes32 quoteBalances,
            bytes32 balanceBasedParams,
            bytes32 timeBasedParams
        ) = swapData.pricingParameters();
        
        uint256 penalty = _getBalanceBasedPenalty(balanceTokenIn, balanceTokenOut, quoteBalances, balanceBasedParams);
        
        penalty = penalty.add(_getTimeBasedPenalty(timeBasedParams));

        penalty = penalty.add(SafeguardMath.calcOriginBasedSlippage(expectedOrigin, originBasedSlippage));

        (uint256 quoteAmountInPerOut, uint256 maxSwapAmount) = priceBasedParams.unpackPairedUints();

        penalty = penalty.add(FixedPoint.ONE);

        return (quoteAmountInPerOut.mulUp(penalty), maxSwapAmount);
    }

    function _getBalanceBasedPenalty(
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        bytes32 quoteBalances,
        bytes32 balanceBasedParams
    ) internal pure returns(uint256) 
    {
        (uint256 quoteBalanceIn, uint256 quoteBalanceOut) = quoteBalances.unpackPairedUints();

        (uint256 balanceChangeTolerance, uint256 balanceBasedSlippage) 
            = balanceBasedParams.unpackPairedUints();

        return SafeguardMath.calcBalanceBasedPenalty(
            balanceTokenIn,
            balanceTokenOut,
            balanceChangeTolerance,
            quoteBalanceIn,
            quoteBalanceOut,
            balanceBasedSlippage
        );
    }

    function _getTimeBasedPenalty(bytes32 timeBasedParams) internal view returns(uint256) {
        (uint256 startTime, uint256 timeBasedSlippage) = timeBasedParams.unpackPairedUints();
        return SafeguardMath.calcTimeSlippagePenalty(block.timestamp, startTime, timeBasedSlippage);
    }

    function _onSwapGivenIn(
        bool    isTokenInToken0,
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
            isTokenInToken0,
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
        bool    isTokenInToken0,
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
            isTokenInToken0,
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
        bool    isTokenInToken0,
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

        bytes32 packedPoolParameters = _packedPoolParameters;
        uint256 onChainAmountInPerOut = _getOnChainAmountInPerOut(packedPoolParameters, isTokenInToken0);

        _fairPricingSafeguard(
            quoteAmountInPerOut,
            onChainAmountInPerOut,
            packedPoolParameters
        );

        uint256 totalSupply = totalSupply();

        _performanceSafeguard(
            isTokenInToken0,
            balanceTokenIn,
            balanceTokenOut,
            onChainAmountInPerOut,
            totalSupply,
            packedPoolParameters
        );

        _balancesSafeguard(
            isTokenInToken0,
            balanceTokenIn.add(amountIn),
            balanceTokenOut.sub(amountOut),
            onChainAmountInPerOut,
            totalSupply,
            packedPoolParameters
        );
    }

    function _fairPricingSafeguard(
        uint256 quoteAmountInPerOut,
        uint256 onChainAmountInPerOut,
        bytes32 packedPoolParameters
    ) internal pure {
        require(quoteAmountInPerOut.divDown(onChainAmountInPerOut) >= _getMaxPriceDevCompl(packedPoolParameters), "error: unfair price");
    }

    function _performanceSafeguard(
        bool    isTokenInToken0,
        uint256 currentBalanceIn,
        uint256 currentBalanceOut,
        uint256 onChainAmountInPerOut,
        uint256 totalSupply,
        bytes32 packedPoolParameters
    ) internal {

        (uint256 lastPerfUpdate, uint256 perfUpdateInterval) = _getPerformanceTimeParams(packedPoolParameters);

        // lastPerfUpdate & perfUpdateInterval are stored in 32 bits so they cannot overflow
        if(block.timestamp > lastPerfUpdate + perfUpdateInterval){
            if(isTokenInToken0){
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
    }

    function _balancesSafeguard(
        bool    isTokenInToken0,
        uint256 newBalanceIn,
        uint256 newBalanceOut,
        uint256 onChainAmountInPerOut,
        uint256 totalSupply,
        bytes32 packedPoolParameters
    ) internal view {

        (uint256 hodlBalancePerPT0, uint256 hodlBalancePerPT1) = getHodlBalancesPerPT();

        (uint256 hodlBalancePerPTIn, uint256 hodlBalancePerPTOut) = isTokenInToken0?
            (hodlBalancePerPT0, hodlBalancePerPT1) :
            (hodlBalancePerPT1, hodlBalancePerPT0); 

        uint256 newBalanceInPerPT = newBalanceIn.divDown(totalSupply);
        uint256 newBalanceOutPerPT = newBalanceOut.divDown(totalSupply);

        require(newBalanceOutPerPT.divDown(hodlBalancePerPTOut) >= _getMaxTargetDevCompl(packedPoolParameters), "error: min balance out is not met");

        uint256 newTVLPerPT = (newBalanceInPerPT.divDown(onChainAmountInPerOut)).add(newBalanceOutPerPT);
        uint256 oldTVLPerPT = (hodlBalancePerPTIn.divDown(onChainAmountInPerOut)).add(hodlBalancePerPTOut);

        require(newTVLPerPT.divDown(oldTVLPerPT) >= _getMaxPerfDevCompl(packedPoolParameters), "error: low performance");
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
        _setHodlBalancesPerPT(amountsIn[0].divDown(_INITIAL_BPT), amountsIn[1].divDown(_INITIAL_BPT));

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
            bool isExcessToken0,
            bytes memory swapData
        ) = _joinExitSwapSignatureSafeguard(sender, recipient, userData);

        (uint256 excessTokenBalance, uint256 limitTokenBalance) = isExcessToken0?
            (balances[0], balances[1]) : (balances[1], balances[0]);

        (
            uint256 quoteAmountInPerOut,
            uint256 maxSwapAmountIn
        ) = _getQuoteAmountInPerOut(swapData, excessTokenBalance, limitTokenBalance);

        (uint256 excessTokenAmountIn, uint256 limitTokenAmountIn) = isExcessToken0?
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
            isExcessToken0,
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
            bool isLimitToken0,
            bytes memory swapData
        ) = _joinExitSwapSignatureSafeguard(sender, recipient, userData);

        (uint256 excessTokenBalance, uint256 limitTokenBalance) = isLimitToken0?
            (balances[1], balances[0]) : (balances[0], balances[1]);

        (
            uint256 quoteAmountInPerOut,
            uint256 maxSwapAmountIn
        ) = _getQuoteAmountInPerOut(swapData, limitTokenBalance, excessTokenBalance);

        (uint256 excessTokenAmountOut, uint256 limitTokenAmountOut) = isLimitToken0?
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
            isLimitToken0,
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

    function setPerfUpdateInterval(uint256 perfUpdateInterval) external authenticate whenNotPaused {
        _setPerfUpdateInterval(perfUpdateInterval);
    }

    function _setPerfUpdateInterval(uint256 perfUpdateInterval) internal {

        require(perfUpdateInterval >= _MIN_PERFORMANCE_UPDATE_INTERVAL, "error: performance update interval too low");

        _packedPoolParameters = _packedPoolParameters.insertUint(
            perfUpdateInterval,
            _PERF_UPDATE_INTERVAL_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );

        emit PerformanceUpdateIntervalChanged(perfUpdateInterval);
    }    
    
    /**
    * @param maxPerfDev the maximum performance deviation tolerance
    */
    function setMaxPerfDevComplement(uint256 maxPerfDev) external authenticate whenNotPaused {
        _setMaxPerfDevComplement(maxPerfDev);
    }

    /// @dev for gas optimization purposes we store (1 - max deviation tolerance)
    function _setMaxPerfDevComplement(uint256 maxPerfDev) internal {
        
        require(maxPerfDev <= _MAX_PERFORMANCE_DEVIATION, "error: tolerance too large");
        
        _packedPoolParameters = _packedPoolParameters.insertUint(
            FixedPoint.ONE.sub(maxPerfDev),
            _MAX_PERF_DEV_BIT_OFFSET,
            _MAX_PERF_DEV_BIT_LENGTH
        );
    }

    /**
    * @param maxTargetDev the maximum deviation tolerance from target reserve (hodl benchmark)
    */
    function setMaxTargetDevComplement(uint256 maxTargetDev) external authenticate whenNotPaused {
        _setMaxTargetDevComplement(maxTargetDev);
    }
    
    /// @dev for gas optimization purposes we store (1 - max deviation tolerance)
    function _setMaxTargetDevComplement(uint256 maxTargetDev) internal {
        
        require(maxTargetDev <= _MAX_TARGET_DEVIATION, "error: tolerance too large");
        
        _packedPoolParameters = _packedPoolParameters.insertUint(
            FixedPoint.ONE - maxTargetDev,
            _MAX_TARGET_DEV_BIT_OFFSET,
            _MAX_TARGET_DEV_BIT_LENGTH
        );
    }

    /**
    * @param maxPriceDev the maximum price deviation tolerance
    */
    function setMaxPriceDevComplement(uint256 maxPriceDev) external authenticate whenNotPaused {
        _setMaxPriceDevComplement(maxPriceDev);
    }

    /// @dev for gas optimization purposes we store the complement of the tolerance (1 - tolerance)
    function _setMaxPriceDevComplement(uint256 maxPriceDev) internal {

        require(maxPriceDev <= _MAX_PRICE_DEVIATION, "error: tolerance too large");

        _packedPoolParameters = _packedPoolParameters.insertUint(
            FixedPoint.ONE - maxPriceDev,
            _MAX_PRICE_DEV_BIT_OFFSET,
            _MAX_PRICE_DEV_BIT_LENGTH
        );
    }

    function updatePerformance() external nonReentrant {

        bytes32 packedPoolParameters = _packedPoolParameters;

        (uint256 lastPerfUpdate, uint256 perfUpdateInterval) = _getPerformanceTimeParams(packedPoolParameters);
        
        require(block.timestamp > lastPerfUpdate + perfUpdateInterval, "error: too soon");

        (
            ,
            uint256[] memory balances,
        ) = getVault().getPoolTokens(getPoolId());

        _upscaleArray(balances, _scalingFactors());

        uint256 amount0Per1 = _getOnChainAmountInPerOut(packedPoolParameters, true);

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
        
        (uint256 hodlBalancesPerPT0, uint256 hodlBalancesPerPT1) = getHodlBalancesPerPT();
        
        uint256 oldTVLPerPT = hodlBalancesPerPT0.add(hodlBalancesPerPT1.mulDown(amount0Per1));
        
        uint256 currentPerformance = currentTVLPerPT.divDown(oldTVLPerPT);

        hodlBalancesPerPT0 = hodlBalancesPerPT0.mulDown(currentPerformance);
        hodlBalancesPerPT1 = hodlBalancesPerPT1.mulDown(currentPerformance);

        _setHodlBalancesPerPT(hodlBalancesPerPT0, hodlBalancesPerPT1);
    }

    function _setHodlBalancesPerPT(uint256 hodlBalancePerPT0, uint256 hodlBalancePerPT1) private {
        
        bytes32 hodlBalancesPerPT = WordCodec.encodeUint(
                hodlBalancePerPT0,
                _HODL_BALANCE_BIT_OFFSET_0,
                _HODL_BALANCE_BIT_LENGTH
        );
        
        hodlBalancesPerPT = hodlBalancesPerPT.insertUint(
                hodlBalancePerPT1,
                _HODL_BALANCE_BIT_OFFSET_1,
                _HODL_BALANCE_BIT_LENGTH
        );

        _hodlBalancesPerPT = hodlBalancesPerPT;

        _packedPoolParameters = _packedPoolParameters.insertUint(
            block.timestamp,
            _PERF_LAST_UPDATE_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );
    }

    function evaluateStablesPegStates() external override {
        bytes32 packedPoolParameters = _packedPoolParameters;
        
        if(_isStable0) {
            bool isPegged = _canBePegged(packedPoolParameters, _TOKEN_0_PEGGED_BIT_OFFSET, _oracle0, _priceScaleFactor0);
            packedPoolParameters.insertBool(isPegged, _TOKEN_0_PEGGED_BIT_OFFSET);
        }
        
        if(_isStable1) {
            bool isPegged = _canBePegged(packedPoolParameters, _TOKEN_1_PEGGED_BIT_OFFSET, _oracle1, _priceScaleFactor1);
            packedPoolParameters.insertBool(isPegged, _TOKEN_1_PEGGED_BIT_OFFSET);
        }

        _packedPoolParameters = packedPoolParameters;
    }

    /**
    * Getters
    */

    function getTokenPegStates() external view returns(bool, bool){
        bytes32 packedPoolParameters = _packedPoolParameters;
        return (
            _isTokenPegged(packedPoolParameters, _TOKEN_0_PEGGED_BIT_OFFSET),
            _isTokenPegged(packedPoolParameters, _TOKEN_1_PEGGED_BIT_OFFSET)
        );
    }

    function _isTokenPegged(bytes32 packedPoolParameters, uint256 tokenPegBitOffset) internal pure returns(bool){
        return packedPoolParameters.decodeBool(tokenPegBitOffset);
    }

    function isAllowlistEnabled() public view returns(bool) {
        return _allowlistEnabled;
    }

    /**
    * @dev returns the hodl balances based on current performance of the pool
    * @return hodlBalancePerPT0 the target hodl balance of token 0
    * @return hodlBalancePerPT1 the target hodl balance of token 1
    */
    function getHodlBalancesPerPT() public view returns(uint256 hodlBalancePerPT0, uint256 hodlBalancePerPT1) {
        
        bytes32 hodlBalancesPerPT = _hodlBalancesPerPT;
    
        hodlBalancePerPT0 = hodlBalancesPerPT.decodeUint(
                _HODL_BALANCE_BIT_OFFSET_0,
                _HODL_BALANCE_BIT_LENGTH
        );
        
        hodlBalancePerPT1 = hodlBalancesPerPT.decodeUint(
                _HODL_BALANCE_BIT_OFFSET_1,
                _HODL_BALANCE_BIT_LENGTH
        );
    
    }

    /**
    * @notice returns the relative price such as: amountIn = relativePrice * amountOut
    */
    function _getOnChainAmountInPerOut(bytes32 packedPoolParameters, bool isTokenInToken0)
    internal view returns(uint256) {
        
        uint256 price0;
        
        if(_isTokenPegged(packedPoolParameters, _TOKEN_0_PEGGED_BIT_OFFSET)) {
            price0 = FixedPoint.ONE;
        } else {
            price0 = _getPriceFromOracle(_oracle0, _priceScaleFactor0);
        }

        uint256 price1;
        
        if(_isTokenPegged(packedPoolParameters, _TOKEN_1_PEGGED_BIT_OFFSET)) {
            price1 = FixedPoint.ONE;
        } else {
            price1 = _getPriceFromOracle(_oracle1, _priceScaleFactor1);
        }
       
        return isTokenInToken0? price1.divDown(price0) : price0.divDown(price1); 
    }

    function _getPriceFromOracle(AggregatorV3Interface oracle, uint256 priceScaleFactor) internal view returns(uint256){
        return  _upscale(ChainlinkUtils.getLatestPrice(oracle), priceScaleFactor);
    }

    /// @notice returns the pool parameters
    function getPoolParameters() public view
    returns (
        uint256 maxPerfDevCompl, // 1 - maxPerfDev
        uint256 maxTargetDevCompl, // 1 - maxTargetDev
        uint256 maxPriceDevCompl, // 1 - maxPriveDev
        uint256 lastPerfUpdate,
        uint256 perfUpdateInterval
    ) {

        bytes32 packedPoolParameters = _packedPoolParameters;
        
        maxPerfDevCompl = _getMaxPerfDevCompl(packedPoolParameters);

        maxTargetDevCompl = _getMaxTargetDevCompl(packedPoolParameters);
        
        maxPriceDevCompl = _getMaxPriceDevCompl(packedPoolParameters);
        
        (lastPerfUpdate, perfUpdateInterval) = _getPerformanceTimeParams(packedPoolParameters);

    }

    function _getMaxPerfDevCompl(bytes32 packedPoolParameters) internal pure returns (uint256 maxPerfDevCompl) {
        maxPerfDevCompl = packedPoolParameters.decodeUint(
            _MAX_PERF_DEV_BIT_OFFSET,
            _MAX_PERF_DEV_BIT_LENGTH
        );
    }

    function _getMaxTargetDevCompl(bytes32 packedPoolParameters) internal pure returns (uint256 maxTargetDevCompl) {
        maxTargetDevCompl = packedPoolParameters.decodeUint(
            _MAX_TARGET_DEV_BIT_OFFSET,
            _MAX_TARGET_DEV_BIT_LENGTH
        );
    }

    function _getMaxPriceDevCompl(bytes32 packedPoolParameters) internal pure returns (uint256 maxPriceDevCompl) {

        maxPriceDevCompl = packedPoolParameters.decodeUint(
            _MAX_PRICE_DEV_BIT_OFFSET,
            _MAX_PRICE_DEV_BIT_LENGTH
        );

    }

    function _getPerformanceTimeParams(bytes32 packedPoolParameters) internal pure
    returns(uint256 lastPerfUpdate, uint256 perfUpdateInterval) {
        
        lastPerfUpdate = packedPoolParameters.decodeUint(
            _PERF_LAST_UPDATE_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );

        perfUpdateInterval = packedPoolParameters.decodeUint(
            _PERF_UPDATE_INTERVAL_BIT_OFFSET,
            _PERF_TIME_BIT_LENGTH
        );
    }

    function _canBePegged(
        bytes32 packedPoolParameters,
        uint256 tokenPegBitOffset,
        AggregatorV3Interface oracle,
        uint256 priceScaleFactor
    ) internal view returns(bool) {

        uint256 currentPrice = _getPriceFromOracle(oracle, priceScaleFactor);
        bool isTokenPegged = _isTokenPegged(packedPoolParameters, tokenPegBitOffset);
        
        if(!isTokenPegged && currentPrice >= REPEG_PRICE_BOUND) {
            return true; // token should gain back peg 
        } else if (isTokenPegged && currentPrice <= UNPEG_PRICE_BOUND) {
            return false; // token should be unpegged
        }

        return isTokenPegged;
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

    function _scalingFactor(bool isToken0) internal view returns (uint256) {
        if (isToken0) {
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
        
        if(elapsedTime >= _MIN_CLAIM_FEES_FREQUENCY) {
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
        // claim previous manag
        claimManagementFees();
        
        _setYearlyRate(yearlyFees);
    }

    function _setYearlyRate(uint256 yearlyFees) private {
        require(yearlyFees <= _MAX_YEARLY_FEES, "error: fees too high");
        _yearlyRate = uint32(SafeguardMath.calcYearlyRate(yearlyFees));
    }

}