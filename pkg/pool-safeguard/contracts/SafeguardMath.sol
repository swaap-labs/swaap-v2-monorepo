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

import "@balancer-labs/v2-interfaces/contracts/pool-safeguard/SafeguardPoolUserData.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/LogExpMath.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeCast.sol";

library SafeguardMath {

    using SafeguardPoolUserData for bytes;
    using FixedPoint for uint256;
    using SafeCast for uint256;

    uint256 private constant _ONE_YEAR = 365 days;

    /**
    * @dev amountInPerOut = baseAmountInPerOut * (1 + slippagePenalty)
    */
    function getQuoteAmountInPerOut(
        bytes memory swapData,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal view returns (uint256, uint256) {
       (address expectedOrigin, ISafeguardPool.PricingParams memory pricingParams) = swapData.pricingParameters();

        uint256 penalty = FixedPoint.ONE;
        
        penalty = penalty.add(getTimeSlippagePenalty(pricingParams.startTime, pricingParams.timeBasedSlippage));
        
        penalty = penalty.add(getBalanceSlippagePenalty(
            balanceTokenIn,
            balanceTokenOut,
            pricingParams.balanceChangeTolerance,
            pricingParams.quoteBalanceIn,
            pricingParams.quoteBalanceOut,
            pricingParams.balanceBasedSlippage
        ));

        penalty = penalty.add(getOriginBasedSlippage(expectedOrigin, pricingParams.originBasedSlippage));

        return (pricingParams.quoteAmountInPerOut.mulUp(penalty), pricingParams.maxSwapAmount);
    }

    /**
    * @notice slippage based on the lag between quotation and execution time
    */
    function getTimeSlippagePenalty(
        uint256 startTime,
        uint256 timeBasedSlippage
    ) internal view returns(uint256) {
        uint256 currentTimestamp = block.timestamp;

        if(currentTimestamp <= startTime) {
            return 0;
        }

        return Math.mul(timeBasedSlippage, (currentTimestamp - startTime));

    }

    /**
    * @notice slippage based on the change of the pool's balance between quotation and execution time
    */
    function getBalanceSlippagePenalty(
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 balanceChangeTolerance,
        uint256 quoteBalanceIn,
        uint256 quoteBalanceOut,
        uint256 balanceBasedSlippage
    ) internal pure returns (uint256) {
        
        uint256 balanceDevIn = balanceTokenIn >= quoteBalanceIn ?
            0 : (quoteBalanceIn - balanceTokenIn).divDown(quoteBalanceIn);

        uint256 balanceDevOut = balanceTokenOut >= quoteBalanceOut ?
            0 : (quoteBalanceOut - balanceTokenOut).divDown(quoteBalanceOut);

        uint256 maxDeviation = Math.max(balanceDevIn, balanceDevOut);

        require(maxDeviation <= balanceChangeTolerance, "error: quote balance no longer valid");
    
        return balanceBasedSlippage.mulUp(maxDeviation);
    }

    /**
    * @notice slippage based on the transaction origin
    */
    function getOriginBasedSlippage(
        address expectedOrigin,
        uint256 originBasedSlippage
    ) internal view returns(uint256) {
 
        if(expectedOrigin != address(0) && expectedOrigin != tx.origin) {
            return originBasedSlippage;
        }

        return 0;
    }


    /**********************************************************************************************
    // aE = amountIn in excess                                                                   //
    // aL = limiting amountIn                                                                    //
    // bE = current balance of excess token                  /       aE * bL - aL * bE       \   //
    // bL = current balance of limiting token         sIn = | ------------------------------- |  //
    // sIn = swap amount in needed before the join           \ bL + aL + (1/p) * ( bE + aE ) /   //
    // sOut = swap amount out needed before the join                                             //
    // p = relative price such that: sIn = p * sOut                                              //
    **********************************************************************************************/
    function calcJoinSwapAmounts(
        uint256 excessTokenBalance,
        uint256 limitTokenBalance,
        uint256 excessTokenAmountIn,
        uint256 limitTokenAmountIn,
        uint256 quoteAmountInPerOut
    ) internal pure returns (uint256, uint256) {

        uint256 foo = excessTokenAmountIn.mulDown(limitTokenBalance);
        uint256 bar = limitTokenAmountIn.mulDown(excessTokenBalance);
        require(foo >= bar, "error: wrong tokenIn in excess");
        uint256 num = foo - bar;

        uint256 denom = limitTokenBalance.add(limitTokenAmountIn);
        denom = denom.add((excessTokenAmountIn.add(limitTokenAmountIn)).divDown(quoteAmountInPerOut));

        uint256 swapAmountIn = num.divDown(denom);
        uint256 swapAmountOut = swapAmountIn.divDown(quoteAmountInPerOut);

        return (swapAmountIn, swapAmountOut);
    }

    /**********************************************************************************************
    // aE = amountIn in excess                                                                   //
    // bE = current balance of excess token                        / aE - sIn  \                 //
    // sIn = swap amount in needed before the join         rOpt = | ----------- |                //
    // rOpt = amountIn TV / current pool TVL                       \ bE + sIn  /                 //
    **********************************************************************************************/
    function calcJoinSwapROpt(
        uint256 excessTokenBalance,
        uint256 excessTokenAmountIn,
        uint256 swapAmountIn
    ) internal pure returns (uint256) {
        uint256 num   = excessTokenAmountIn.sub(swapAmountIn);
        uint256 denom = excessTokenBalance.add(swapAmountIn);
        return num.divDown(denom);
    }

    /**********************************************************************************************
    // aE = amountOut in excess                                                                  //
    // aL = limiting amountOut                                                                   //
    // bE = current balance of excess token                   /     aE * bL - aL * bE     \      //
    // bL = current balance of limiting token         sOut = | --------------------------- |     //
    // sIn = swap amount in needed before the exit            \ bL - aL + p * ( bE - aE ) /      //
    // sOut = swap amount out needed before the exit                                             //
    // p = relative price such that: sIn = p * sOut                                              //
    **********************************************************************************************/
    function calcExitSwapAmounts(
        uint256 excessTokenBalance,
        uint256 limitTokenBalance,
        uint256 excessTokenAmountIn,
        uint256 limitTokenAmountIn,
        uint256 quoteAmountInPerOut
    ) internal pure returns (uint256, uint256) {

        uint256 foo = excessTokenAmountIn.mulDown(limitTokenBalance);
        uint256 bar = limitTokenAmountIn.mulDown(excessTokenBalance);
        require(foo >= bar, "error: wrong tokenOut in excess");
        uint256 num = foo - bar;

        uint256 denom = limitTokenBalance.sub(limitTokenAmountIn);
        denom = denom.add((excessTokenAmountIn.sub(limitTokenAmountIn)).mulDown(quoteAmountInPerOut));

        uint256 swapAmountOut = num.divDown(denom);
        uint256 swapAmountIn = quoteAmountInPerOut.mulDown(swapAmountOut);

        return (swapAmountIn, swapAmountOut);
    }

    /**********************************************************************************************
    // aE = amountOut in excess                                                                  //
    // bE = current balance of excess token                        / aE - sOut  \                //
    // sOut = swap amount out needed before the exit       rOpt = | ----------- |                //
    // rOpt = amountOut TV / current pool TVL                       \ bE - sOut  /                //
    **********************************************************************************************/
    function calcExitSwapROpt(
        uint256 excessTokenBalance,
        uint256 excessTokenAmountOut,
        uint256 swapAmountOut
    ) internal pure returns (uint256) {
        uint256 num   = excessTokenAmountOut.sub(swapAmountOut);
        uint256 denom = excessTokenBalance.sub(swapAmountOut);
        return num.divDown(denom);
    }

    /**********************************************************************************************
    // f = yearly management fees percentage          /  ln(1 - f) \                             //
    // 1y = 1 year                             a = - | ------------ |                            //
    // a = yearly rate constant                       \     1y     /                             //
    **********************************************************************************************/
    function calcYearlyRate(uint256 yearlyFees) internal pure returns(uint256) {
        uint256 logInput = FixedPoint.ONE - yearlyFees; // we assume yearlyFees is < 1e18
        // Since 0 < logInput <= 1 => logResult <= 0
        int256 logResult = LogExpMath.ln(int256(logInput));
        return(uint256(-logResult) / _ONE_YEAR);
    }

    /**********************************************************************************************
    // bptOut = bpt tokens to be minted as fees                                                  //
    // TS = total supply                                   bptOut = TS * (e^(a*dT) -1)           //
    // a = yearly rate constant                                                                  //
    // dT = elapsed time between the previous and current claim                                  //
    **********************************************************************************************/
    function calcAccumulatedManagementFees(
        uint256 elapsedTime,
        uint256 yearlyRate,
        uint256 currentSupply
     ) internal pure returns(uint256) {
        uint256 expInput = yearlyRate * elapsedTime;
        uint256 expResult = uint256(LogExpMath.exp(expInput.toInt256())); // TODO check if necessary toInt256()
        return (currentSupply.mulDown(expResult.sub(FixedPoint.ONE))); // TODO .sub() may be removable
    }

}