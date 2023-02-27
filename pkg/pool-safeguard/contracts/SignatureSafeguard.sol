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
    
    bytes32 public constant JOINSTRUCT_TYPEHASH = 0x0; 
    
    mapping(bytes32 => bool) internal _usedQuotes;

    function _decodeSignedUserData(bytes memory userData) internal pure 
    returns(uint256 deadline, bytes memory extraData, bytes memory signature){
        // TODO check if uint128 uses less gas than uint256 
        (
            deadline,
            extraData,
            signature
        ) = abi.decode(userData, (uint256, bytes, bytes));
    }

    function _swapSignatureSafeguard(
        IVault.SwapKind kind,
        bytes32 poolId,
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amount,
        address receiver,
        bytes memory userData
    ) internal returns (uint256, bytes memory) {

        (
            uint256 deadline,
            bytes memory swapData,
            bytes memory signature
        ) = _decodeSignedUserData(userData);

        _require(deadline >= block.timestamp, Errors.EXPIRED_SIGNATURE);

        bytes32 digest = keccak256(abi.encode(
            SWAPSTRUCT_TYPEHASH,
            kind,
            poolId,
            tokenIn,
            tokenOut,
            amount,
            receiver,
            swapData,
            deadline
        ));

        // TODO add appropriate error code
        _require(!_usedQuotes[digest], 0);
        _require(_isValidSignature(signer(), digest, signature), 0);

        _usedQuotes[digest] = true;

        return (deadline, swapData);
    }


    // TODO this is temporary, it should be moved elsewhere to an interface
    enum JoinKind { INIT, ALL_TOKENS_IN_FOR_EXACT_BPT_OUT, EXACT_TOKENS_IN_FOR_BPT_OUT }

    function _swapSignatureSafeguard(
        JoinKind kind,
        bytes32 poolId,
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amount,
        address receiver,
        bytes memory userData
    ) internal returns (uint256, bytes memory) {

        (
            uint256 deadline,
            bytes memory swapData,
            bytes memory signature
        ) = _decodeSignedUserData(userData);

        _require(deadline >= block.timestamp, Errors.EXPIRED_SIGNATURE);

        bytes32 digest = keccak256(abi.encode(
            SWAPSTRUCT_TYPEHASH,
            kind,
            poolId,
            tokenIn,
            tokenOut,
            amount,
            receiver,
            swapData,
            deadline
        ));

        // TODO add appropriate error code
        _require(!_usedQuotes[digest], 0);
        _require(_isValidSignature(signer(), digest, signature), 0);

        _usedQuotes[digest] = true;

        return (deadline, swapData);
    }

    function _joinPoolSignatureSafeguard(
        JoinKind kind,
        bytes32 poolId,
        address receiver,
        bytes memory userData
    ) internal returns (uint256, bytes memory) {

        (
            uint256 deadline,
            bytes memory joinPoolData,
            bytes memory signature
        ) = _decodeSignedUserData(userData);

        _require(deadline >= block.timestamp, Errors.EXPIRED_SIGNATURE);

        bytes32 digest = keccak256(abi.encode(
            JOINSTRUCT_TYPEHASH,
            kind,
            poolId,
            receiver,
            joinPoolData,
            deadline
        ));

        // TODO add appropriate error code
        _require(!_usedQuotes[digest], 0);
        _require(_isValidSignature(signer(), digest, signature), 0);

        _usedQuotes[digest] = true;

        return (deadline, joinPoolData);
    }

    function signer() public view virtual returns(address);

}