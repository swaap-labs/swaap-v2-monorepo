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

pragma solidity =0.7.6;
pragma experimental ABIEncoderV2;

import "../SafeguardPool.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

contract TestSafeguardPool is SafeguardPool {

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        address[] memory assetManagers,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        InitialOracleParams[] memory oracleParams,
        InitialSafeguardParams memory safeguardParameters
    ) SafeguardPool(
        vault,
        name,
        symbol,
        tokens,
        assetManagers,
        pauseWindowDuration,
        bufferPeriodDuration,
        owner,
        oracleParams,
        safeguardParameters
    ) {}

    function validateSwap(
        IVault.SwapKind kind,
        bool    isTokenInToken0,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 quoteAmountInPerOut,
        uint256 maxSwapAmount
    ) external {  
        return SafeguardPool._validateSwap(
            kind,
            isTokenInToken0,
            balanceTokenIn,
            balanceTokenOut,
            amountIn,
            amountOut,
            quoteAmountInPerOut,
            maxSwapAmount
        );
    }

    function swapSignatureSafeguard(
        IVault.SwapKind kind,
        bool isTokenInToken0,
        address sender,
        address recipient,
        bytes calldata userData
    ) external returns (bytes memory) {
        return _swapSignatureSafeguard(
            kind,
            isTokenInToken0,
            sender,
            recipient,
            userData
        );
    }

    function validateSwapSignature(
        IVault.SwapKind kind,
        bool isTokenInToken0,
        address sender,
        address recipient,
        bytes memory swapData,
        bytes memory signature,
        uint256 quoteIndex,
        uint256 deadline
    ) external {
        _validateSwapSignature(
            kind,
            isTokenInToken0,
            sender,
            recipient,
            swapData,
            signature,
            quoteIndex,
            deadline
        );
    }

    function isQuoteUsedTest(
        uint256 index
    ) external view returns (bool) {
        return _isQuoteUsed(
            index
        );
    }

    function isLPAllowed(address sender, bytes memory userData) external returns (bytes memory) {
        return _isLPAllowed(sender, userData);
    }

    function getMinimumBpt() external pure returns (uint256) {
        return _getMinimumBpt();
    }

}