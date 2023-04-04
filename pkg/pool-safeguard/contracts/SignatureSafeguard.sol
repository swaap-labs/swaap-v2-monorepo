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

    // keccak256("SwapStruct(uint8 kind,address tokenIn,address tokenOut,address sender,address recipient,uint256 deadline,bytes swapData)")
    bytes32 public constant SWAPSTRUCT_TYPEHASH = 0x4b9559cac77b73d6b38de5d3514b19ccec78487b49dd0753eb5cfc0d90e42bfe;
    
    // keccak256("JoinExactTokensStruct(uint8 kind,address sender,address recipient,uint256 deadline,bytes joinData)")
    bytes32 public constant JOINSTRUCT_TYPEHASH = 0xaa30b41dfd2bbb67ce7c6715ca223934159456ca684d6865bdb2ad25b741872b;
    
    // keccak256("ExitExactTokensStruct(uint8 kind,address sender,address recipient,uint256 deadline,bytes exitData)")
    bytes32 public constant EXITSTRUCT_TYPEHASH = 0xec489f840bb901310d0f606ea53da305a20a78c305691cf034a05eb1b2b9e519;

    mapping(bytes32 => bool) internal _usedQuotes;

    /**
    * @dev The inheriting pool contract must have one and immutable poolId and must interact with one and immutable vault's address.
    * Otherwise, it is unsafe to rely solely on the pool's address as a domain seperator assuming that a quote is based on the pool's state.
    */
    function _swapSignatureSafeguard(
        IVault.SwapKind kind,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address sender,
        address recipient,
        bytes memory userData
    ) internal returns (bytes memory) {

        (
            uint256 deadline,
            bytes memory swapData,
            bytes memory signature
        ) = userData.decodeSignedSwapData();

        bytes32 structHash = keccak256(abi.encode(
            SWAPSTRUCT_TYPEHASH,
            kind,
            tokenIn,
            tokenOut,
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
            JOINSTRUCT_TYPEHASH,
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
            EXITSTRUCT_TYPEHASH,
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
    }

    function signer() public view virtual returns(address);

}