// // SPDX-License-Identifier: GPL-3.0-or-later
// // This program is free software: you can redistribute it and/or modify
// // it under the terms of the GNU Affero General Public License as published by
// // the Free Software Foundation, either version 3 of the License, or any later version.

// // This program is distributed in the hope that it will be useful,
// // but WITHOUT ANY WARRANTY; without even the implied warranty of
// // MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// // GNU Affero General Public License for more details.

// // You should have received a copy of the GNU Affero General Public License
// // along with this program. If not, see <http://www.gnu.org/licenses/>.

// pragma solidity ^0.7.0;
// pragma experimental ABIEncoderV2;

// import "../SafeguardMath.sol";

// contract TestSafeguardMath {

//     function getQuoteAmountInPerOut(
//         uint256 balanceTokenIn,
//         uint256 balanceTokenOut,
//         uint256 quoteAmountInPerOut,
//         uint256 balanceChangeTolerance,
//         uint256 quoteBalanceIn,
//         uint256 quoteBalanceOut,
//         uint256 balanceBasedSlippage,
//         int256 timeAfterStartTime,
//         uint256 timeBasedSlippage

//     ) external view returns(uint256, uint256) {
//         uint256 startTime = uint256(int256(block.timestamp) - timeAfterStartTime);

//         uint256 maxSwapAmount = 0; // not relevant

//         bytes memory swapData = abi.encode(
//             maxSwapAmount,
//             quoteAmountInPerOut,
//             balanceChangeTolerance,
//             quoteBalanceIn,
//             quoteBalanceOut,
//             balanceBasedSlippage,
//             startTime,
//             timeBasedSlippage);

//         return SafeguardMath.getQuoteAmountInPerOut(swapData, balanceTokenIn, balanceTokenOut);

//     }

//     function getTimeSlippagePenalty(
//         int256 timeAfterStartTime,
//         uint256 timeBasedSlippage
//     ) external view returns(uint256) {
        
//         uint256 startTime = uint256(int256(block.timestamp) - timeAfterStartTime);

//         return SafeguardMath.getTimeSlippagePenalty(startTime, timeBasedSlippage);
//     }

//     function getBalanceSlippagePenalty(
//         uint256 balanceTokenIn,
//         uint256 balanceTokenOut,
//         uint256 maxBalanceChangeTolerance,
//         uint256 quoteBalanceIn,
//         uint256 quoteBalanceOut,
//         uint256 balanceBasedSlippage
//     ) external pure returns (uint256) {
//         return SafeguardMath.getBalanceSlippagePenalty(
//             balanceTokenIn,
//             balanceTokenOut,
//             maxBalanceChangeTolerance,
//             quoteBalanceIn,
//             quoteBalanceOut,
//             balanceBasedSlippage
//         );
//     }

// }