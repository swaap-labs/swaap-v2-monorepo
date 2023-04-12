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

pragma solidity >=0.7.0 <0.9.0;

import "./ISafeguardPool.sol";

library SafeguardPoolUserData {
    // In order to preserve backwards compatibility, make sure new join and exit kinds are added at the end of the enum.
    enum JoinKind { INIT, ALL_TOKENS_IN_FOR_EXACT_BPT_OUT, EXACT_TOKENS_IN_FOR_BPT_OUT }
    enum ExitKind { EXACT_BPT_IN_FOR_TOKENS_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT }

    function joinKind(bytes memory self) internal pure returns (JoinKind) {
        return abi.decode(self, (JoinKind));
    }

    function exitKind(bytes memory self) internal pure returns (ExitKind) {
        return abi.decode(self, (ExitKind));
    }

    // Swaps
    
    function pricingParameters(bytes memory self) internal pure
    returns(
        uint256 maxSwapAmount,
        uint256 quoteAmountInPerOut,
        uint256 balanceChangeTolerance,
        uint256 quoteBalanceIn,
        uint256 quoteBalanceOut,
        uint256 balanceBasedSlippage,
        uint256 startTime,
        uint256 timeBasedSlippage
    ) {
        (
            maxSwapAmount,
            quoteAmountInPerOut,
            balanceChangeTolerance,
            quoteBalanceIn,
            quoteBalanceOut,
            balanceBasedSlippage,
            startTime,
            timeBasedSlippage
        ) = abi.decode(self, (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256));
    }

    function maxSwapAmount(bytes memory self) internal pure returns(uint256) {
        return abi.decode(self, (uint256));
    }

    function decodeSignedSwapData(bytes calldata self) internal pure 
    returns(uint256 deadline, bytes memory extraData, bytes memory signature) {
        (
            deadline,
            extraData,
            signature
        ) = abi.decode(self, (uint256, bytes, bytes));
    }


    // Joins

    function initJoin(bytes memory self) internal pure returns (JoinKind kind, uint256[] memory amountsIn) {
        (kind, amountsIn) = abi.decode(self, (JoinKind, uint256[]));
    }

    function allTokensInForExactBptOut(bytes memory self) internal pure returns (uint256 bptAmountOut) {
        (, bptAmountOut) = abi.decode(self, (JoinKind, uint256));
    }

    // Exits

    function exactBptInForTokensOut(bytes memory self) internal pure returns (uint256 bptAmountIn) {
        (, bptAmountIn) = abi.decode(self, (ExitKind, uint256));
    }

    function decodeSignedExitData(bytes memory self) internal pure 
    returns(ExitKind kind, uint256 deadline, bytes memory exitData, bytes memory signature){
        (
            kind,
            deadline,
            exitData,
            signature
        ) = abi.decode(self, (ExitKind, uint256, bytes, bytes));
    }

    // Join/Exit + Swap
    function joinExitSwapData(bytes memory self) internal pure 
    returns (
        uint256 limitBptAmount,
        uint256[] memory joinExitAmounts,
        IERC20 swapTokenIn,
        uint256 deadline,
        bytes memory swapData,
        bytes memory signature
    ) {
        
        (
            , // corresponds to join or exit kind
            limitBptAmount, // minBptAmountOut or maxBptAmountIn
            joinExitAmounts, // join amountsIn or exit amounts Out
            swapTokenIn, // excess token in or limit token in
            deadline, // swap deadline
            swapData,
            signature
        ) = abi.decode(self, (uint8, uint, uint[], IERC20, uint256, bytes, bytes));

    }

}