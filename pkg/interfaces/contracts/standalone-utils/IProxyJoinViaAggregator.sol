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
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

interface IProxyJoinViaAggregator {

    struct Quote {
        address targetAggregator;
        IERC20 sellToken;
        IERC20 buyToken;
        uint256 sellAmount;
        uint256 buyAmount;
        address spender;
        bytes quoteCallData;
    }

    struct PermitToken {
        IERC20 token;
        bytes permitData;
    }

    /**
    * @notice Joins the pool after trading input token(s) with the necessary ones externally to the pool
    * @dev The joiningAssets and joiningAmounts should be in the same order
    * @dev The request.assets and request.maxAmountIn should be in the same order as vault.getPoolTokens(poolId)
    * @dev When joining the pool using the native token, the external swap should be done with the wrapped native token
    * @param poolId The pool's id
    * @param request The vault's join pool request
    * @param fillQuotes The external trades needed before joining the pool
    * @param joiningAssets The addresses of the input tokens
    * @param joiningAmounts The total amounts of input tokens
    * @param permitTokens The tokens that need to be permitted before joining the pool
    * @param minBptAmountOut The minimum acceptable amount of pool shares received
    * @param deadline Maximum deadline for accepting the joinswapExternAmountIn
    * @return bptAmountOut The amount of pool shares received
    */
    function permitJoinPoolViaAggregator(
        bytes32 poolId,
        IVault.JoinPoolRequest memory request,
        Quote[] calldata fillQuotes,
        IERC20[] calldata joiningAssets,
        uint256[] calldata joiningAmounts,
        PermitToken[] calldata permitTokens,
        uint256 minBptAmountOut,
        uint256 deadline
    ) external payable returns (uint256 bptAmountOut);

    /**
    * @notice Joins the pool after trading input token(s) with the necessary ones externally to the pool
    * @dev The joiningAssets and joiningAmounts should be in the same order
    * @dev The request.assets and request.maxAmountIn should be in the same order as vault.getPoolTokens(poolId)
    * @dev When joining the pool using the native token, the external swap should be done with the wrapped native token
    * @param poolId The pool's id
    * @param request The vault's join pool request
    * @param fillQuotes The external trades needed before joining the pool
    * @param joiningAssets The addresses of the input tokens
    * @param joiningAmounts The total amounts of input tokens
    * @param minBptAmountOut The minimum acceptable amount of pool shares received
    * @param deadline Maximum deadline for accepting the joinswapExternAmountIn
    * @return bptAmountOut The amount of pool shares received
    */
    function joinPoolViaAggregator(
        bytes32 poolId,
        IVault.JoinPoolRequest memory request,
        Quote[] calldata fillQuotes,
        IERC20[] calldata joiningAssets,
        uint256[] calldata joiningAmounts,
        uint256 minBptAmountOut,
        uint256 deadline
    ) external payable returns (uint256 bptAmountOut);

}