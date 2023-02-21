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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/EOASignaturesValidator.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

abstract contract SignatureSafeguard is EOASignaturesValidator {

    // "SwapStruct(SwapKind kind,bytes32 poolId,address tokenIn,address tokenOut,
    // uint256 amountIn,uint256 amountOut,uint256 quoteBalanceIn,uint256 quoteBalanceOut,address to,uint256 deadline)"
    bytes32 public constant SWAPSTRUCT_TYPEHASH = 0x198c90b68f8baaa35d2652c0c1d8cdce8d5a7e910ad965dd4b730ce10b1b7b74;

    mapping(bytes32 => bool) internal _usedQuotes;

    function _signatureDeadlineSafeguard(
        IVault.SwapKind kind,
        bytes32 poolId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 quoteBalanceIn,
        uint256 quoteBalanceOut,
        address to,
        uint256 deadline,
        bytes memory signature
    ) internal {

        _require(deadline >= block.timestamp, Errors.EXPIRED_SIGNATURE);

        bytes32 digest = keccak256(abi.encode(
            SWAPSTRUCT_TYPEHASH,
            kind,
            poolId,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            quoteBalanceIn,
            quoteBalanceOut,
            to,
            deadline
        ));


        // TODO add appropriate error code
        _require(!_usedQuotes[digest], 0);
        _require(_isValidSignature(signer(), digest, signature), 0);

        _usedQuotes[digest] = true;

    }

    function signer() public view virtual returns(address);

}