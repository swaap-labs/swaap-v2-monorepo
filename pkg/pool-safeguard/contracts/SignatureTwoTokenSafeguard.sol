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
import "@balancer-labs/v2-interfaces/contracts/pool-safeguard/ISignatureSafeguard.sol";

abstract contract SignatureTwoTokenSafeguard is EOASignaturesValidator, ISignatureSafeguard {
    using SafeguardPoolUserData for bytes;

    // solhint-disable max-line-length
    bytes32 public constant SWAP_STRUCT_TYPEHASH =
        keccak256(
            "SwapStruct(uint8 kind,bool isTokenInToken0,address sender,address recipient,bytes swapData,uint256 quoteIndex,uint256 deadline)"
        );
    // solhint-enable max-line-length

    bytes32 public constant ALLOWLIST_STRUCT_TYPEHASH = keccak256("AllowlistStruct(address sender,uint256 deadline)");

    // NB Do not assign a high value (e.g. max(uint256)) or else it will overflow when adding it to the block.timestamp
    uint256 private constant _MAX_REMAINING_SIGNATURE_VALIDITY = 5 minutes;

    mapping(uint256 => uint256) internal _usedQuoteBitMap;

    /**
     * @dev The inheriting pool contract must have one and immutable poolId and must
     * interact with one and immutable vault's address. Otherwise, it is unsafe to rely solely
     * on the pool's address as a domain seperator assuming that a quote is based on the pool's state.
     */
    function _swapSignatureSafeguard(
        IVault.SwapKind kind,
        bool isTokenInToken0,
        address sender,
        address recipient,
        bytes calldata userData
    ) internal returns (bytes memory) {
        (bytes memory swapData, bytes memory signature, uint256 quoteIndex, uint256 deadline)
           = userData.decodeSignedSwapData();

        _validateSwapSignature(kind, isTokenInToken0, sender, recipient, swapData, signature, quoteIndex, deadline);

        return swapData;
    }

    /**
     * @dev The inheriting pool contract must have one and immutable poolId and must
     * interact with one and immutable vault's address. Otherwise, it is unsafe to rely solely
     * on the pool's address as a domain seperator assuming that a quote is based on the pool's state.
     */
    function _joinExitSwapSignatureSafeguard(
        address sender,
        address recipient,
        bytes memory userData
    ) internal returns (uint256, uint256[] memory, bool, bytes memory) {
        
        (
            bool isTokenInToken0, // excess token in or limit token in
            bytes memory swapData,
            bytes memory signature,
            uint256 quoteIndex,
            uint256 deadline // swap deadline
        ) = userData.exactJoinExitSwapData();

        _validateSwapSignature(
            IVault.SwapKind.GIVEN_IN, isTokenInToken0, sender, recipient, swapData, signature, quoteIndex, deadline
        );

        (uint256 limitBptAmountOut, uint256[] memory joinExitAmounts) = userData.exactJoinExitAmountsData();

        return (limitBptAmountOut, joinExitAmounts, isTokenInToken0, swapData);
    }

    function _validateSwapSignature(
        IVault.SwapKind kind,
        bool isTokenInToken0,
        address sender,
        address recipient,
        bytes memory swapData,
        bytes memory signature,
        uint256 quoteIndex,
        uint256 deadline
    ) internal {
        // For a two token pool,we can only include the tokenIn in the signature. For pools that has more than
        // two tokens the tokenOut must be specified to ensure the correctness of the trade.
        bytes32 structHash = keccak256(
            abi.encode(
                SWAP_STRUCT_TYPEHASH, kind, isTokenInToken0, sender, recipient,keccak256(swapData), quoteIndex, deadline
            )
        );

        bytes32 digest = _ensureValidBitmapSignature(
            structHash,
            signature,
            quoteIndex,
            deadline,
            0 // TODO add proper error code
        );

        emit SwapSignatureValidated(digest, quoteIndex);
    }

    function _ensureValidBitmapSignature(
        bytes32 structHash,
        bytes memory signature,
        uint256 quoteIndex,
        uint256 deadline,
        uint256 errorCode
    ) internal returns (bytes32) {
        bytes32 digest = _hashTypedDataV4(structHash);
        _require(_isValidSignature(signer(), digest, signature), errorCode);

        // We could check for the deadline & quote index before validating the signature, but this leads to saner
        // error processing (as we only care about expired deadlines & quote if the signature is correct) and only
        // affects the gas cost of the revert scenario, which will only occur infrequently, if ever.
        // The deadline is timestamp-based: it should not be relied upon for sub-minute accuracy.
        // solhint-disable-next-line not-rely-on-time
        _require(deadline >= block.timestamp, Errors.EXPIRED_SIGNATURE);

        require(!_isQuoteUsed(quoteIndex), "error: quote already used");
        _registerUsedQuote(quoteIndex);

        return digest;
    }

    function _isQuoteUsed(uint256 index) internal view returns (bool) {
        uint256 usedQuoteWordIndex = index / 256;
        uint256 usedQuoteBitIndex = index % 256;
        uint256 usedQuoteWord = _usedQuoteBitMap[usedQuoteWordIndex];
        uint256 mask = (1 << usedQuoteBitIndex);
        return usedQuoteWord & mask == mask;
    }

    function _registerUsedQuote(uint256 index) private {
        uint256 usedQuoteWordIndex = index / 256;
        uint256 usedQuoteBitIndex = index % 256;
        _usedQuoteBitMap[usedQuoteWordIndex] = _usedQuoteBitMap[usedQuoteWordIndex] | (1 << usedQuoteBitIndex);
    }

    function _validateAllowlistSignature(address sender, bytes memory userData) internal returns (bytes memory) {
        (uint256 deadline, bytes memory signature, bytes memory joinData) = userData.allowlistData();

        bytes32 structHash = keccak256(abi.encode(ALLOWLIST_STRUCT_TYPEHASH, sender, deadline));

        bytes32 digest = _ensureValidReplayableSignature(
            structHash,
            signature,
            deadline,
            699 // TODO add proper error code
        );

        emit AllowlistJoinSignatureValidated(digest);

        return joinData;
    }

    function _ensureValidReplayableSignature(
        bytes32 structHash,
        bytes memory signature,
        uint256 deadline,
        uint256 errorCode
    ) internal view returns (bytes32) {
        bytes32 digest = _hashTypedDataV4(structHash);
        _require(_isValidSignature(signer(), digest, signature), errorCode);

        // We could check for the deadline before validating the signature, but this leads to saner error processing (as
        // we only care about expired deadlines if the signature is correct) and only affects the gas cost of the revert
        // scenario, which will only occur infrequently, if ever.
        // The deadline is timestamp-based: it should not be relied upon for sub-minute accuracy.
        // solhint-disable-next-line not-rely-on-time
        _require(deadline >= block.timestamp, Errors.EXPIRED_SIGNATURE);
        // Ensures that a signature is not valid forever //TODO add correct error code
        _require(deadline <= block.timestamp + _MAX_REMAINING_SIGNATURE_VALIDITY, Errors.EXPIRED_SIGNATURE);

        return digest;
    }

    /// @inheritdoc ISignatureSafeguard
    function getQuoteBitmapWord(uint256 wordIndex) external view override returns(uint){
        return _usedQuoteBitMap[wordIndex];
    }

    /// @inheritdoc ISignatureSafeguard
    function signer() public view override virtual returns (address);
}
