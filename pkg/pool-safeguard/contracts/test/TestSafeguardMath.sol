// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../SafeguardMath.sol";

contract TestSafeguardMath {

    function calcTimeSlippagePenalty(
        uint256 currentTimestamp,
        uint256 startTime,
        uint256 timeBasedSlippage
    ) external pure returns(uint256) {
        return SafeguardMath.calcTimeBasedPenalty(currentTimestamp, startTime, timeBasedSlippage);
    }

    function calcBalanceBasedPenalty(
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 balanceChangeTolerance,
        uint256 quoteBalanceIn,
        uint256 quoteBalanceOut,
        uint256 balanceBasedSlippage
    ) external pure returns (uint256) {
        return SafeguardMath.calcBalanceBasedPenalty(
            balanceTokenIn,
            balanceTokenOut,
            balanceChangeTolerance,
            quoteBalanceIn,
            quoteBalanceOut,
            balanceBasedSlippage
        );
    }

    function calcOriginBasedSlippage(
        address expectedOrigin,
        uint256 originBasedSlippage
    ) external view returns(uint256) {
        return SafeguardMath.calcOriginBasedPenalty(expectedOrigin, originBasedSlippage);
    }

    function calcJoinSwapAmounts(
        uint256 excessTokenBalance,
        uint256 limitTokenBalance,
        uint256 excessTokenAmountIn,
        uint256 limitTokenAmountIn,
        uint256 quoteAmountInPerOut
    ) external pure returns (uint256, uint256) {
        return SafeguardMath.calcJoinSwapAmounts(
            excessTokenBalance,
            limitTokenBalance,
            excessTokenAmountIn,
            limitTokenAmountIn,
            quoteAmountInPerOut
        );
    }

    function calcJoinSwapROpt(
        uint256 excessTokenBalance,
        uint256 excessTokenAmountIn,
        uint256 swapAmountIn
    ) external pure returns (uint256) {
        return SafeguardMath.calcJoinSwapROpt(excessTokenBalance, excessTokenAmountIn, swapAmountIn);
    }

    function calcExitSwapAmounts(
        uint256 excessTokenBalance,
        uint256 limitTokenBalance,
        uint256 excessTokenAmountIn,
        uint256 limitTokenAmountIn,
        uint256 quoteAmountInPerOut
    ) external pure returns (uint256, uint256) {
        return SafeguardMath.calcExitSwapAmounts(
            excessTokenBalance,
            limitTokenBalance,
            excessTokenAmountIn,
            limitTokenAmountIn,
            quoteAmountInPerOut
        );
    }

    function calcExitSwapROpt(
        uint256 excessTokenBalance,
        uint256 excessTokenAmountOut,
        uint256 swapAmountOut
    ) external pure returns (uint256) {
        return SafeguardMath.calcExitSwapROpt(excessTokenBalance, excessTokenAmountOut, swapAmountOut);
    }

    function calcYearlyRate(uint256 yearlyFees) external pure returns(uint256) {
        return SafeguardMath.calcYearlyRate(yearlyFees);
    }

    function calcAccumulatedManagementFees(
        uint256 elapsedTime,
        uint256 yearlyRate,
        uint256 currentSupply
    ) external pure returns(uint256) {
        return SafeguardMath.calcAccumulatedManagementFees(
            elapsedTime,
            yearlyRate,
            currentSupply
        );
    }

}