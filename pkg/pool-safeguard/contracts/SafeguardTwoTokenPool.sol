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
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) external override onlyVault(request.poolId) returns (uint256) {

        _beforeSwapJoinExit();

        bytes memory swapData = _swapSignatureSafeguard(
            request.kind,
            request.poolId,
            request.tokenIn,
            request.tokenOut,
            request.to,
            request.userData
        );
        {
            // uint256 scalingFactorTokenIn = _scalingFactor(request.tokenIn);
            // uint256 scalingFactorTokenOut = _scalingFactor(request.tokenOut);

            balanceTokenIn = _upscale(balanceTokenIn, _scalingFactor(request.tokenIn));
            balanceTokenOut = _upscale(balanceTokenOut, _scalingFactor(request.tokenOut));
        }
        uint256 quoteRelativePrice = _getQuoteRelativePrice(swapData, balanceTokenIn, balanceTokenOut);

        require(request.amount <= swapData.maxSwapAmount(), "error: max amount exceeded");
        
        if(request.kind == IVault.SwapKind.GIVEN_IN) {
            return _onSwapGivenIn(request.tokenIn, balanceTokenIn, balanceTokenOut, request.amount, quoteRelativePrice);
        }
        
        return _onSwapGivenOut(request.tokenIn, balanceTokenIn, balanceTokenOut, request.amount, quoteRelativePrice);

    }

    function _onSwapGivenIn(
        IERC20 tokenIn,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 amountIn,
        uint256 quoteRelativePrice
    ) internal returns(uint256) {
        uint256 amountOut = amountIn.mulDown(quoteRelativePrice);

        _validateSwap(
            tokenIn,
            balanceTokenIn,
            balanceTokenOut,
            amountIn,
            amountOut,
            quoteRelativePrice
        );

        return amountOut;
    }

    function _onSwapGivenOut(
        IERC20 tokenIn,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 amountOut,
        uint256 quoteRelativePrice
    ) internal returns(uint256) {
        uint256 amountIn = amountOut.divUp(quoteRelativePrice);

        _validateSwap(
            tokenIn,
            balanceTokenIn,
            balanceTokenOut,
            amountIn,
            amountOut,
            quoteRelativePrice
        );

        return amountIn;
    }

    function _validateSwap(
        IERC20  tokenIn,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 quoteRelativePrice
    ) private {
        
        uint256 onChainRelativePrice = _getOnChainRelativePrice(tokenIn);

        _fairPricingSafeguard(
            quoteRelativePrice,
            onChainRelativePrice
        );

        _perfBalancesSafeguard(
            tokenIn,
            balanceTokenIn,
            balanceTokenOut,
            balanceTokenIn.add(amountIn),
            balanceTokenOut.sub(amountOut),
            onChainRelativePrice
        );

    }

    function _fairPricingSafeguard(
        uint256 quoteRelativePrice,
        uint256 onChainRelativePrice
    ) internal view {
        uint256 maxPriceOffset = _getMaxPriceOffset();
        require(onChainRelativePrice.divDown(quoteRelativePrice) >= maxPriceOffset, "error: unfair price");
    }

    function _perfBalancesSafeguard(
        IERC20  tokenIn,
        uint256 currentBalanceIn,
        uint256 currentBalanceOut,
        uint256 newBalanceIn,
        uint256 newBalanceOut,
        uint256 onChainRelativePrice
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
            _updatePerformance(currentBalanceIn, currentBalanceOut, onChainRelativePrice, totalSupply);
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

        uint256 newTVLPerPT = (newBalanceInPerPT.mulDown(onChainRelativePrice)).add(newBalanceOutPerPT);
        uint256 oldTVLPerPT = (perfBalPerPTIn.mulDown(onChainRelativePrice)).add(perfBalPerPTOut);

        require(newTVLPerPT >= oldTVLPerPT.mulUp(maxTVLOffset), "error: low tvl");
    }

    function _getQuoteRelativePrice(
        bytes memory swapData,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal view returns (uint256) {
        (
            ,
            uint256 quoteRelativePrice,
            uint256 maxBalanceChangeTolerance,
            uint256 quoteBalanceIn,
            uint256 quoteBalanceOut,
            uint256 balanceBasedSlippage,
            uint256 timeBasedSlippage,
            uint256 startTime
        ) = swapData.priceParameters();

        uint256 penalty = _getTimeSlippagePenalty(timeBasedSlippage, startTime);
        
        penalty = penalty.add(_getBalanceSlippagePenalty(
            balanceTokenIn,
            balanceTokenOut,
            maxBalanceChangeTolerance,
            quoteBalanceIn,
            quoteBalanceOut,
            balanceBasedSlippage
        ));

        return quoteRelativePrice.divDown(FixedPoint.ONE.add(penalty));
    }

    function _getBalanceSlippagePenalty(
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 maxBalanceChangeTolerance,
        uint256 quoteBalanceIn,
        uint256 quoteBalanceOut,
        uint256 balanceBasedSlippage
    ) internal pure returns (uint256) {
        
        uint256 offsetIn = balanceTokenIn <= quoteBalanceIn ?
            0 : (quoteBalanceIn - balanceTokenIn).divDown(quoteBalanceIn);

        uint256 offsetOut = balanceTokenOut <= quoteBalanceOut ?
            0 : (quoteBalanceOut - balanceTokenOut).divDown(quoteBalanceOut);

        uint256 maxOffset = Math.max(offsetIn, offsetOut);

        require(maxOffset <= maxBalanceChangeTolerance, "error: quote balance no longer valid");
    
        return balanceBasedSlippage.mulUp(maxOffset);
    }


    function _getTimeSlippagePenalty(
        uint256 timeBasedSlippage,
        uint256 startTime
    ) internal view returns(uint256) {
        uint256 currentTimestamp = block.timestamp;

        if(currentTimestamp <= startTime) {
            return 0;
        }

        return Math.mul(timeBasedSlippage, (currentTimestamp - startTime));

    }

    function _onInitializePool(
        bytes32, // poolId,
        address, // sender,
        address, // recipient,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        
        (SafeguardPoolUserData.JoinKind kind, uint256[] memory amountsIn) = userData.initJoin();
        
        _require(kind == SafeguardPoolUserData.JoinKind.INIT, Errors.UNINITIALIZED);
        _require(amountsIn.length == _NUM_TOKENS, Errors.TOKENS_LENGTH_MUST_BE_2);
        
        _upscaleArray(amountsIn, scalingFactors);

        // set perf balances & set last perf update time to current block.timestamp
        _setPerfBalancesPerPT(amountsIn[0].divDown(_INITIAL_BPT), amountsIn[1].divDown(_INITIAL_BPT));

        return (_INITIAL_BPT, amountsIn);
        
    }

    function _onJoinPool(
        bytes32 poolId,
        address, // sender,
        address recipient,
        uint256[] memory balances,
        uint256, // lastChangeBlock,
        uint256, // protocolSwapFeePercentage,
        uint256[] memory, // scalingFactors,
        bytes memory userData
    ) internal override returns (uint256 bptAmountOut, uint256[] memory amountsIn) {
        SafeguardPoolUserData.JoinKind kind = userData.joinKind();

        if(kind == SafeguardPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {

            return _joinAllTokensInForExactBPTOut(balances, totalSupply(), userData);

        } else if (kind == SafeguardPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {

            return _joinExactTokensInForBPTOut(poolId, recipient, balances, userData);

        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
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
        bytes32 poolId,
        address recipient,
        uint256[] memory balances,
        bytes memory signedJoinData
    ) internal returns (uint256, uint256[] memory) {

        bytes memory joinData = _joinPoolSignatureSafeguard(
                poolId,
                recipient,
                signedJoinData
        );

        JoinExitSwapStruct memory decodedJoinSwapData = joinData.joinExitSwapStruct();

        uint256 maxSwapAmountOut = _decreaseAmountOut(balances[0], balances[1], decodedJoinSwapData.swapData);

        (uint256 rOpt, uint256 swappedAmountIn, uint256 swappedAmountOut) = _calcROptGivenExactTokensIn(
            balances,
            decodedJoinSwapData.joinExitAmounts,
            decodedJoinSwapData.expectedTokenIn,
            decodedJoinSwapData.maxSwapAmountIn,
            maxSwapAmountOut
        );
        
        uint256 totalSupply = totalSupply();
        
        uint256 bptAmountOut = totalSupply.mulDown(rOpt);
        totalSupply += bptAmountOut; // will be checked for overflow when minting
        
        require(bptAmountOut >= decodedJoinSwapData.limitBptAmount, "error: not enough bpt out");
        
        rOpt = rOpt.add(FixedPoint.ONE);
        uint256 rOptBalanceIn = balances[0].mulDown(rOpt);
        uint256 rOptBalanceOut = balances[1].mulDown(rOpt);

        _validateSwap(
            decodedJoinSwapData.expectedTokenIn,
            rOptBalanceIn,
            rOptBalanceOut,
            swappedAmountIn,
            swappedAmountOut,
            swappedAmountOut.divDown(swappedAmountIn)
        );

        return (bptAmountOut, decodedJoinSwapData.joinExitAmounts);

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
        bytes32 poolId,
        address, // sender,
        address recipient,
        uint256[] memory balances,
        uint256, // lastChangeBlock,
        uint256, // protocolSwapFeePercentage,
        uint256[] memory, // scalingFactors,
        bytes memory userData
    ) internal override returns (uint256 bptAmountIn, uint256[] memory amountsOut) {
        (SafeguardPoolUserData.ExitKind kind) = userData.exitKind();

        if(kind == SafeguardPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {

            return _exitExactBPTInForTokensOut(balances, totalSupply(), userData);

        } else if (kind == SafeguardPoolUserData.ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT) {

            return _exitBPTInForExactTokensOut(poolId, recipient, balances, userData);

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
        bytes32 poolId,
        address recipient,
        uint256[] memory balances,
        bytes memory userData
    ) internal returns (uint256, uint256[] memory) {

        bytes memory exitData = _exitPoolSignatureSafeguard(
                poolId,
                recipient,
                userData
        );

        JoinExitSwapStruct memory decodedExitSwapData = exitData.joinExitSwapStruct();

        uint256 maxSwapAmountOut = _decreaseAmountOut(balances[0], balances[1], decodedExitSwapData.swapData);

        (uint256 rOpt, uint256 swappedAmountIn, uint256 swappedAmountOut) = _calcROptGivenExactTokensOut(
            balances,
            decodedExitSwapData.joinExitAmounts,
            decodedExitSwapData.expectedTokenIn,
            decodedExitSwapData.maxSwapAmountIn,
            maxSwapAmountOut
        );
        
        uint256 totalSupply = totalSupply();
                
        uint256 bptAmountIn = totalSupply.mulDown(rOpt);
        totalSupply -= bptAmountIn; // will be checked for overflow when minting
        
        require(bptAmountIn <= decodedExitSwapData.limitBptAmount, "error: exceeded burned bpt");
        
        rOpt = (FixedPoint.ONE).sub(rOpt);
        uint256 rOptBalanceIn =  balances[0].mulDown(rOpt);
        uint256 rOptBalanceOut = balances[1].mulDown(rOpt);

        _validateSwap(
            decodedExitSwapData.expectedTokenIn,
            rOptBalanceIn,
            rOptBalanceOut,
            swappedAmountIn,
            swappedAmountOut,
            swappedAmountOut.divDown(swappedAmountIn)
        );

        return (bptAmountIn, decodedExitSwapData.joinExitAmounts);

    }

    function _calcROptGivenExactTokensIn(
        uint256[] memory initialBalances,
        uint256[] memory joinAmountsIn,
        IERC20  expectedTokenIn,
        uint256 maxSwapAmountIn,
        uint256 maxSwapAmountOut
    ) internal view returns (
        uint256 rOpt,
        uint256 swappedAmountIn,
        uint256 swappedAmountOut
    ) {
        uint256 j0b1 = joinAmountsIn[0].mulDown(initialBalances[1]);
        uint256 j1b0 = joinAmountsIn[1].mulDown(initialBalances[0]);

        // TODO: simplify and add into one function
        if(j0b1 > j1b0) {
            require(expectedTokenIn == _token0, "error: wrong excess token");
            uint256 relativePrice = maxSwapAmountOut.divUp(maxSwapAmountIn);
            {
                uint256 num = j0b1 - j1b0;
                uint256 denom = initialBalances[1] + relativePrice.mulUp(initialBalances[0]);
                swappedAmountIn = num.divUp(denom);
            }
            require(swappedAmountIn <= maxSwapAmountIn, "error: max swap exceeded when join pool");
            swappedAmountOut = swappedAmountIn.mulDown(relativePrice);
            rOpt = (joinAmountsIn[0].sub(swappedAmountIn)).divUp(initialBalances[0]);
        } else {
            require(expectedTokenIn == _token1, "error: wrong excess token");
            uint256 relativePrice = maxSwapAmountOut.divUp(maxSwapAmountIn);
            {
                uint256 num = j1b0 - j0b1;
                uint256 denom = initialBalances[0] + relativePrice.mulUp(initialBalances[1]);
                swappedAmountIn = num.divUp(denom);
            }
            require(swappedAmountIn <= maxSwapAmountIn, "error: max swap exceeded when join pool");
            swappedAmountOut = swappedAmountIn.mulDown(relativePrice);
            rOpt = (joinAmountsIn[1].sub(swappedAmountIn)).divUp(initialBalances[1]);
        }
    }

    function _calcROptGivenExactTokensOut(
        uint256[] memory initialBalances,
        uint256[] memory exitAmountsOut,
        IERC20  expectedTokenIn,
        uint256 maxSwapAmountIn,
        uint256 maxSwapAmountOut
    ) internal view returns (
        uint256 rOpt,
        uint256 swappedAmountIn,
        uint256 swappedAmountOut
    ) {
        uint256 a0b1 = exitAmountsOut[0].mulDown(initialBalances[1]);
        uint256 a1b0 = exitAmountsOut[1].mulDown(initialBalances[0]);
        uint256 relativePrice = maxSwapAmountIn.divUp(maxSwapAmountOut);

        // TODO: simplify and add into one function
        if(a0b1 > a1b0) {
            require(expectedTokenIn == _token1, "error: wrong excess token");
            {
                uint256 num = a0b1 - a1b0;
                uint256 denom = initialBalances[1] + relativePrice.mulUp(initialBalances[0]);
                swappedAmountOut = num.divUp(denom);
            }
            swappedAmountIn = swappedAmountOut.mulDown(relativePrice);
            require(swappedAmountIn <= maxSwapAmountIn, "error: max swap exceeded when join pool");
            rOpt = (exitAmountsOut[0].sub(swappedAmountOut)).divUp(initialBalances[0]);
        } else {
            require(expectedTokenIn == _token0, "error: wrong excess token");
            {
                uint256 num = a1b0 - a0b1;
                uint256 denom = initialBalances[0] + relativePrice.mulUp(initialBalances[1]);
                swappedAmountOut = num.divUp(denom);
            }
            swappedAmountIn = swappedAmountOut.mulDown(relativePrice);
            require(swappedAmountIn <= maxSwapAmountIn, "error: max swap exceeded when join pool");
            rOpt = (exitAmountsOut[0].sub(swappedAmountOut)).divUp(initialBalances[0]);
        }
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

        uint256 relativePrice = _getOnChainRelativePrice(_token0);

        _updatePerformance(balances[0], balances[1], relativePrice, totalSupply()); 
    }

    // TODO we may add a (off-chain) reference price to prevent the update of the performance with a faulty oracle price
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

        _packedPoolParameters = _packedPoolParameters.insertUint(
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

    /**
    * @notice returns the relative price such as: amountOut = relativePrice * amountIn
    */
    function _getOnChainRelativePrice(IERC20 tokenIn) internal view returns(uint256) {

        uint256 price0 = ChainlinkUtils.getLatestPrice(_oracle0);
        uint256 price1 = ChainlinkUtils.getLatestPrice(_oracle1);

        price0 = _upscale(price0, _priceScaleFactor0);
        price1 = _upscale(price1, _priceScaleFactor1);
        
        return tokenIn == _token0? price0.divDown(price1) : price1.divDown(price0); 
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

    function _decreaseAmountOut(
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        bytes memory swapData
    ) internal view returns(uint256){

        (
            uint256 quoteBalanceIn,
            uint256 quoteBalanceOut,
            uint256 amountOut, // expressed in 18 decimals even if the token has less than 18 decimals
            uint256 timeBasedSlippage,
            uint256 startTime
        ) = swapData.slippageParameters();


        return amountOut;
        // return amountOut.sub(penalty);
    }
    
    function _increaseAmountIn(
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        bytes memory swapData
    ) internal view returns(uint256) {
        
        (
            uint256 quoteBalanceIn,
            uint256 quoteBalanceOut,
            uint256 amountIn, // expressed in 18 decimals even if the token has less than 18 decimals
            uint256 slippageSlope,
            uint256 startTime
        ) = swapData.slippageParameters();

        uint256 currentTimestamp = block.timestamp;

        if(currentTimestamp <= startTime) {
            return(amountIn);
        }

        uint256 penalty = Math.mul(slippageSlope, currentTimestamp.sub(startTime));
        return amountIn.add(penalty);
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

}