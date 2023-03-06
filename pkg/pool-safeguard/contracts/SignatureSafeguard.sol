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

    event Swap(bytes32 digest);
    event JoinSwap(bytes32 digest);
    event ExitSwap(bytes32 digest);

    // keccak256("SwapStruct(uint8 kind,bytes32 poolId,address tokenIn,address tokenOut,uint256 amount,address receiver,uint256 deadline,bytes swapData)")
    bytes32 public constant SWAPSTRUCT_TYPEHASH = 0x1b69f9bd02dd47e80d3e6fa5788c7ce1125263c904bea51563a5ce054d35a0e2;
    
    // keccak256("JoinExactTokensStruct(uint8 kind,bytes32 poolId,address receiver,uint256 deadline,bytes joinData)")
    bytes32 public constant JOINSTRUCT_TYPEHASH = 0xf3497e39bd0a6e26c884818f17836b589e816134556f0584fb2c1c53e94994d9;
    
    // keccak256("ExitExactTokensStruct(uint8 kind,bytes32 poolId,address receiver,uint256 deadline,bytes exitData)")
    bytes32 public constant EXITSTRUCT_TYPEHASH = 0x0a312806f986e49d3a3d2accc3e1861b88c3e73dc656e27176f6e97c53a43674;

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
    ) internal returns (bytes memory) {

        (
            uint256 deadline,
            bytes memory swapData,
            bytes memory signature
        ) = _decodeSignedUserData(userData);

        bytes32 structHash = keccak256(abi.encode(
            SWAPSTRUCT_TYPEHASH,
            kind,
            poolId,
            tokenIn,
            tokenOut,
            amount,
            receiver,
            deadline,
            keccak256(swapData)
        ));

        bytes32 digest = _ensureValidSignatureNoNonce(
            structHash,
            signature,
            deadline,
            0 // TODO add proper error code
        );

        emit Swap(digest);

        return swapData;
    }


    // TODO this is temporary, it should be moved elsewhere to an interface
    enum JoinKind { INIT, ALL_TOKENS_IN_FOR_EXACT_BPT_OUT, EXACT_TOKENS_IN_FOR_BPT_OUT }

    function _joinPoolSignatureSafeguard(
        JoinKind kind,
        bytes32 poolId,
        address receiver,
        bytes memory userData
    ) internal returns (bytes memory) {

        (
            uint256 deadline,
            bytes memory joinPoolData,
            bytes memory signature
        ) = _decodeSignedUserData(userData);

        bytes32 structHash = keccak256(abi.encode(
            JOINSTRUCT_TYPEHASH,
            kind,
            poolId,
            receiver,
            deadline,
            keccak256(joinPoolData)
        ));

        bytes32 digest = _ensureValidSignatureNoNonce(
            structHash,
            signature,
            deadline,
            0 // TODO add proper error code
        );

        emit JoinSwap(digest);

        return joinPoolData;
    }

    // TODO this is temporary, it should be moved elsewhere to an interface
    enum ExitKind { EXACT_BPT_IN_FOR_TOKENS_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT }

    function _exitPoolSignatureSafeguard(
        ExitKind kind,
        bytes32 poolId,
        address receiver,
        bytes memory userData
    ) internal returns (bytes memory) {

        (
            uint256 deadline,
            bytes memory exitPoolData,
            bytes memory signature
        ) = _decodeSignedUserData(userData);

        bytes32 structHash = keccak256(abi.encode(
            EXITSTRUCT_TYPEHASH,
            kind,
            poolId,
            receiver,
            deadline,
            keccak256(exitPoolData)
        ));

        bytes32 digest = _ensureValidSignatureNoNonce(
            structHash,
            signature,
            deadline,
            0 // TODO add proper error code
        );

        emit ExitSwap(digest);

        return exitPoolData;
    }

    function _ensureValidSignatureNoNonce(
        bytes32 structHash,
        bytes memory signature,
        uint256 deadline,
        uint256 errorCode
    ) internal returns(bytes32) {
        bytes32 digest = _hashTypedDataV4(structHash);
        _require(_isValidSignature(signer(), digest, signature), errorCode);
        
        // We could check for the deadline before validating the signature, but this leads to saner error processing (as
        // we only care about expired deadlines if the signature is correct) and only affects the gas cost of the revert
        // scenario, which will only occur infrequently, if ever.
        // The deadline is timestamp-based: it should not be relied upon for sub-minute accuracy.
        // solhint-disable-next-line not-rely-on-time
        _require(deadline >= block.timestamp, Errors.EXPIRED_SIGNATURE);
        
        // TODO add proper error code
        _require(!_usedQuotes[digest], 0);
        _usedQuotes[digest] = true;
    }

    function signer() public view virtual returns(address);

}