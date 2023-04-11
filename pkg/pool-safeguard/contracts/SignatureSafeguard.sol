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
import "@balancer-labs/v2-interfaces/contracts/pool-safeguard/SafeguardPoolUserData.sol";

abstract contract SignatureSafeguard is EOASignaturesValidator {

    using SafeguardPoolUserData for bytes;

    event Swap(bytes32 digest);
    event JoinSwap(bytes32 digest);
    event ExitSwap(bytes32 digest);

    // keccak256("SwapStruct(uint8 kind,address tokenIn,address sender,address recipient,uint256 deadline,bytes swapData)")
    bytes32 public constant SWAP_STRUCT_TYPEHASH = 0x03435028418929234ab5a9f9f0ae6d8ea683c47ca8dc830e6ef5d1a2692ab9b2;
    
    // keccak256("SwapJoinStruct(uint8 kind,address sender,address recipient,uint256 deadline,bytes joinData)")
    bytes32 public constant SWAPJOIN_STRUCT_TYPEHASH = 0x71525ff392493c3db8bcd7a0c178008cb76de3c9a12af3ae3c07b9fc8fffe632;
    
    // keccak256("SwapExitStruct(uint8 kind,address sender,address recipient,uint256 deadline,bytes exitData)")
    bytes32 public constant SWAPEXIT_STRUCT_TYPEHASH = 0xae990fac1c15ec4531ff12efeda78455f6f03c59794d5612c751a98e0289af3f;

    mapping(bytes32 => bool) internal _usedQuotes;

    /**
    * @dev The inheriting pool contract must have one and immutable poolId and must interact with one and immutable vault's address.
    * Otherwise, it is unsafe to rely solely on the pool's address as a domain seperator assuming that a quote is based on the pool's state.
    */
    function _swapSignatureSafeguard(
        IVault.SwapKind kind,
        IERC20 tokenIn,
        address sender,
        address recipient,
        bytes memory userData
    ) internal returns (bytes memory) {

        (
            uint256 deadline,
            bytes memory swapData,
            bytes memory signature
        ) = userData.decodeSignedSwapData();

        // For a two token pool,we can only include the tokenIn in the signature. For pools that has more than two tokens
        // the tokenOut must be specified to ensure the correctness of the trade.
        bytes32 structHash = keccak256(abi.encode(
            SWAP_STRUCT_TYPEHASH,
            kind,
            tokenIn,
            sender,
            recipient,
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

    /**
    * @dev The inheriting pool contract must have one and immutable poolId and must interact with one and immutable vault's address.
    * Otherwise, it is unsafe to rely solely on the pool's address as a domain seperator assuming that a quote is based on the pool's state.
    */
    function _joinPoolSignatureSafeguard(
        address sender,
        address recipient,
        bytes memory userData
    ) internal returns (bytes memory) {

        (
            SafeguardPoolUserData.JoinKind kind,
            uint256 deadline,
            bytes memory joinPoolData,
            bytes memory signature
        ) = userData.decodeSignedJoinData();

        bytes32 structHash = keccak256(abi.encode(
            SWAPJOIN_STRUCT_TYPEHASH,
            kind,
            sender,
            recipient,
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

    /**
    * @dev The inheriting pool contract must have one and immutable poolId and must interact with one and immutable vault's address.
    * Otherwise, it is unsafe to rely solely on the pool's address as a domain seperator assuming that a quote is based on the pool's state.
    */
    function _exitPoolSignatureSafeguard(
        address sender,
        address recipient,
        bytes memory userData
    ) internal returns (bytes memory) {

        (
            SafeguardPoolUserData.ExitKind kind,
            uint256 deadline,
            bytes memory exitPoolData,
            bytes memory signature
        ) = userData.decodeSignedExitData();

        bytes32 structHash = keccak256(abi.encode(
            SWAPEXIT_STRUCT_TYPEHASH,
            kind,
            sender,
            recipient,
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
        
        return digest;
    }

    function signer() public view virtual returns(address);

}