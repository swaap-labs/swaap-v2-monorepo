// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.

/*
                                      s███
                                    ██████
                                   @██████
                              ,s███`
                           ,██████████████
                          █████████^@█████_
                         ██████████_ 7@███_            "█████████M
                        @██████████_     `_              "@█████b
                        ^^^^^^^^^^"                         ^"`
                         
                        ████████████████████p   _█████████████████████
                        @████████████████████   @███████████WT@██████b
                         ████████████████████   @███████████  ,██████
                         @███████████████████   @███████████████████b
                          @██████████████████   @██████████████████b
                           "█████████████████   @█████████████████b
                             @███████████████   @████████████████
                               %█████████████   @██████████████`
                                 ^%██████████   @███████████"
                                     ████████   @██████W"`
                                     1███████
                                      "@█████
                                         7W@█
*/

pragma solidity ^0.7.6;
pragma abicoder v2;

import "@swaap-labs/v2-errors/contracts/SwaapV2Errors.sol";
import "@swaap-labs/v2-interfaces/contracts/standalone-utils/IProxyJoinViaAggregator.sol";

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20Permit.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IBasePool.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ScalingHelpers.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/misc/IWETH.sol";
import "@balancer-labs/v2-pool-utils/contracts/BasePoolAuthorization.sol";

import "@openzeppelin/contracts-v0.7/utils/Pausable.sol";
import "@openzeppelin/contracts-v0.7/utils/Address.sol";

/**
 * @title ProxyJoinViaAggregator
 * @author Swaap-labs (https://github.com/swaap-labs/swaap-v2-monorepo)
 * @notice Proxy that enables to swap tokens with aggregators before joining a pool.
*/
contract ProxyJoinViaAggregator is BasePoolAuthorization, ReentrancyGuard, Pausable, IProxyJoinViaAggregator {

    using FixedPoint for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    modifier beforeDeadline(uint256 deadline) {
        _srequire(block.timestamp <= deadline, SwaapV2Errors.PASSED_DEADLINE);
        _;
    }

    address constant  private NATIVE_ADDRESS = address(0);
    uint256 constant  private ONE = 10 ** 18;

    IVault immutable public vault;
    IWETH immutable public weth;
    address immutable public zeroEx;
    address immutable public paraswap;
    address immutable public oneInch;
    address immutable public odos;

    constructor(address _vault, IWETH _weth, address _zeroEx, address _paraswap, address _oneInch, address _odos)
    BasePoolAuthorization(_DELEGATE_OWNER)
    Authentication(bytes20(address(this)))
    {
        vault = IVault(_vault);
        weth = _weth;
        zeroEx = _zeroEx;
        paraswap = _paraswap;
        oneInch = _oneInch;
        odos = _odos;
    }

    /// @inheritdoc IProxyJoinViaAggregator
    function permitJoinPoolViaAggregator(
        bytes32 poolId,
        IVault.JoinPoolRequest calldata request,
        Quote[] calldata fillQuotes,
        IERC20[] calldata joiningAssets,
        uint256[] calldata joiningAmounts,
        PermitToken[] calldata permitTokens,
        uint256 minBptAmountOut,
        uint256 deadline
    )
    external payable override
    whenNotPaused
    nonReentrant
    beforeDeadline(deadline)
    returns (uint256 bptAmountOut)
    {   

        _permitERC20s(permitTokens);
        
        return _joinPoolViaAggregator(
            poolId,
            request,
            fillQuotes,
            joiningAssets,
            joiningAmounts,
            minBptAmountOut
        );
    }

    function _permitERC20s(PermitToken[] calldata permitTokens) internal {
        
        // If permitData is empty, skip the permit call
        for(uint256 i; i < permitTokens.length; ++i) {
            _permitERC20(permitTokens[i].token, permitTokens[i].permitData);
        }    

    }

    function _permitERC20(IERC20 joiningAsset, bytes calldata permitData) internal {
        
        // If permitData is empty, skip the permit call
        _srequire(permitData.length == 224, SwaapV2Errors.INVALID_DATA_LENGTH);
        
        (bool success, bytes memory returnData) = address(joiningAsset).call(
            abi.encodePacked(
                IERC20Permit.permit.selector,
                permitData
            )
        );

        if(!success) {
            assembly {
                revert(add(returnData, 32), mload(returnData))
            }
        }        
    }

    /// @inheritdoc IProxyJoinViaAggregator
    function joinPoolViaAggregator(
        bytes32 poolId,
        IVault.JoinPoolRequest memory request,
        Quote[] calldata fillQuotes,
        IERC20[] calldata joiningAssets,
        uint256[] calldata joiningAmounts,
        uint256 minBptAmountOut,
        uint256 deadline
    )
    external payable override
    whenNotPaused
    nonReentrant
    beforeDeadline(deadline)
    returns (uint256 bptAmountOut)
    {
        return _joinPoolViaAggregator(
            poolId,
            request,
            fillQuotes,
            joiningAssets,
            joiningAmounts,
            minBptAmountOut
        );
    }

    function _joinPoolViaAggregator(
        bytes32 poolId,
        IVault.JoinPoolRequest memory request,
        Quote[] calldata fillQuotes,
        IERC20[] calldata joiningAssets,
        uint256[] calldata joiningAmounts,
        uint256 minBptAmountOut
    ) internal returns (uint256 bptAmountOut) {

        _transferFromMultipleAssets(joiningAssets, joiningAmounts);
        
        _tradeAssetsExternally(fillQuotes);

        // The vault will make sure that the tokens are the same as the pool 
        (IERC20[] memory poolTokens,uint256[] memory poolBalances,) = vault.getPoolTokens(poolId);

        bptAmountOut = _getMaximumPoolShares(_getPoolAddress(poolId), poolTokens, poolBalances, request);

        _srequire(bptAmountOut >= minBptAmountOut, SwaapV2Errors.MIN_BALANCE_OUT_NOT_MET);

        _injectPoolSharesOut(request.userData, bptAmountOut);

        _ensureVaultAllowances(poolTokens, request.maxAmountsIn);

        _joinPool(bptAmountOut, poolId, request);

        _handleRemainingTokens(poolTokens, joiningAssets);

        return bptAmountOut;
    }

    function _joinPool(
        uint256 expectedBptAmountOut,
        bytes32 poolId,
        IVault.JoinPoolRequest memory request
    ) internal {

        address poolAddress = _getPoolAddress(poolId);

        uint256 prevBptBalance = IERC20(poolAddress).balanceOf(msg.sender);

        vault.joinPool(
            poolId,
            address(this),
            msg.sender,
            request
        );

        uint256 afterBptBalance = IERC20(poolAddress).balanceOf(msg.sender);

        _srequire(afterBptBalance.sub(prevBptBalance) >= expectedBptAmountOut, SwaapV2Errors.MIN_BALANCE_OUT_NOT_MET);
    }

    function _transferFromMultipleAssets(IERC20[] memory assets, uint256[] memory amounts) internal {
        
        // for gas optimization purposes we convert all native token
        // to wrapped native because the vault will do it anyways and 
        // most likely the other exchanges will wrap it too
        
        // ensure length of joiningAssets and joiningAmounts are the same
        
        uint256 length = assets.length;

        InputHelpers.ensureInputLengthMatch(length, amounts.length);

        for(uint256 i; i < length; ++i) {
            transferFromAll(assets[i], amounts[i]);
        }
    }

    function _getExpectedPoolShares(bytes memory userData) internal pure returns (uint256 expectedPoolShares) {
        (, expectedPoolShares) = abi.decode(userData, (uint8, uint256));
    }

    function _handleRemainingTokens(
        IERC20[] memory poolTokens,
        IERC20[] memory joiningAssets
    ) internal {

        for(uint256 i; i < joiningAssets.length; ++i) {
            IERC20 joiningAsset = joiningAssets[i];
            transferAll(joiningAsset, getBalance(joiningAsset));
        }

        for(uint256 i; i < poolTokens.length; ++i) {
            IERC20 poolToken = poolTokens[i];
            transferAll(poolToken, getBalance(poolToken));
        }

    }

    function _tradeAssetsExternally(
        Quote[] calldata fillQuotes
    ) internal {
    
        for(uint256 i; i < fillQuotes.length; ++i) {           
            
            Quote memory quote = fillQuotes[i];

            if(quote.targetAggregator == zeroEx) {
                _tradeWithAggregator(zeroEx, quote);
            } else if(quote.targetAggregator == paraswap) {
                _tradeWithAggregator(paraswap, quote);
            } else if(quote.targetAggregator == oneInch) {
                _tradeWithAggregator(oneInch, quote);
            } else if(quote.targetAggregator == odos) {
                _tradeWithAggregator(odos, quote);
            } else {
                _srevert(SwaapV2Errors.INVALID_AGGREGATOR);
            }
        }
    }

    function _tradeWithAggregator(
        address aggregator,
        Quote memory quote
    ) private {

        IERC20 sellToken = isNative(quote.sellToken)? weth : quote.sellToken;
        IERC20 buyToken = isNative(quote.buyToken)? weth : quote.buyToken;

        uint256 prevSellBalance = getBalance(sellToken);
        uint256 prevBuyBalance = getBalance(buyToken);

        _srequire(buyToken != sellToken, SwaapV2Errors.SAME_TOKENS);

        _getApproval(sellToken, quote.spender, quote.sellAmount);

        _performExternalCall(aggregator, quote.quoteCallData);

        uint256 soldAmount = prevSellBalance.sub(getBalance(sellToken));
        uint256 boughtAmount = getBalance(buyToken).sub(prevBuyBalance);

        _srequire(soldAmount <= quote.sellAmount, SwaapV2Errors.EXCEEDED_SWAP_AMOUNT_IN);
        _srequire(boughtAmount >= quote.buyAmount, SwaapV2Errors.MIN_BALANCE_OUT_NOT_MET);
    }

    function _performExternalCall(
        address target,
        bytes memory data
    ) private returns (bytes memory) {
        
        bytes32 selector;
        
        assembly {
            selector := mload(add(data, 0x20))
        }

        require(bytes4(selector) != IERC20.transferFrom.selector, "transferFrom not allowed for externalCall");

        (bool success, bytes memory returnData) = target.call(data);

        if(!success) {
            assembly {
                revert(add(data, 32), mload(returnData))
            }
        }
        
        return returnData;
    }

    function _ensureVaultAllowances(
        IERC20[] memory poolTokens,
        uint256[] memory maxAmountsIn
    ) internal {

        uint256 length = poolTokens.length;

        InputHelpers.ensureInputLengthMatch(length, maxAmountsIn.length);

        for(uint256 i; i < length; ++i) {
            _getApproval(poolTokens[i], address(vault), maxAmountsIn[i]);
        }
    }

    // calculates the maximum amount of pool shares that can be received and modifies the maxAmountsIn array
    function _getMaximumPoolShares(
        address pool,
        IERC20[] memory poolTokens,
        uint256[] memory poolBalances,
        IVault.JoinPoolRequest memory request // must be in the same order as the pool
    ) internal view
    returns (uint256)
    {
        // verify poolBalances length and maxAmountsIn length
        uint256 length = poolBalances.length;
        InputHelpers.ensureInputLengthMatch(length, request.maxAmountsIn.length);

        // get the proxy balances
        uint256[] memory proxyBalances = new uint256[](poolTokens.length);
        for(uint256 i; i < length; ++i) {
            proxyBalances[i] = getBalance(poolTokens[i]);
        }

        {

            // Get scaling factors
            uint256[] memory scalingFactors = IBasePool(pool).getScalingFactors();

            // upscale pool balances
            _upscaleArray(proxyBalances, scalingFactors);
            _upscaleArray(poolBalances, scalingFactors);

        }

        {
            uint256 ratio = type(uint256).max;

            for(uint256 i; i < length; ++i) {
                uint256 localRatio = FixedPoint.divDown(proxyBalances[i], poolBalances[i]);
                
                if(localRatio < ratio) {
                    ratio = localRatio;
                }
            }

            uint256 extractablePoolShares = FixedPoint.mulDown(ratio, IERC20(pool).totalSupply());

            uint256 expectedPoolShares = _getExpectedPoolShares(request.userData);

            uint256 sharesRatio = FixedPoint.divUp(extractablePoolShares, expectedPoolShares);

            for(uint256 i; i < length; ++i) {
                request.maxAmountsIn[i] = FixedPoint.mulUp(request.maxAmountsIn[i], sharesRatio);
            }

            return extractablePoolShares;
        }
    }

    // expected userData = [joinKind, poolAmountOut]
    function _injectPoolSharesOut(bytes memory userData, uint256 sharesAmountOut) internal pure {
        assembly {
            mstore(add(userData, 0x40), sharesAmountOut)
        }
    }

    /**
     * @dev Returns the address of a Pool's contract.
     *
     * Due to how Pool IDs are created, this is done with no storage accesses and costs little gas.
     */
    function _getPoolAddress(bytes32 poolId) internal pure returns (address) {
        // 12 byte logical shift left to remove the nonce and specialization setting. We don't need to mask,
        // since the logical shift already sets the upper bits to zero.
        return address(uint256(poolId) >> (12 * 8));
    }

    function transferFromAll(IERC20 token, uint256 amount) internal {
        if (isNative(token)) {
            // The 'amount' input is not used in the payable case in order to convert all the
            // native token to wrapped native token. This is useful in function transferAll where only 
            // one transfer is needed when a fraction of the wrapped tokens are used.
            weth.deposit{value: msg.value}();
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    function _getApproval(IERC20 token, address target, uint256 amount) internal {
        
        if (token.allowance(address(this), target) < amount) {
            token.safeApprove(target, type(uint256).max);
        }

    }

    function getBalance(IERC20 token) internal view returns (uint256) {
        if (isNative(token)) {
            return weth.balanceOf(address(this));
        } else {
            return IERC20(token).balanceOf(address(this));
        }
    }

    function transferAll(IERC20 token, uint256 amount) internal {
        if (amount != 0) {
            if (isNative(token)) {
                IWETH(weth).withdraw(amount);
                payable(msg.sender).sendValue(amount);
            } else {
                IERC20(token).safeTransfer(msg.sender, amount);
            }
        }
    }

    receive() external payable {
        _require(msg.sender == address(weth), Errors.ETH_TRANSFER);
    }

    function isNative(IERC20 token) internal pure returns(bool) {
        return (address(token) == NATIVE_ADDRESS);
    }

    // Pause functions
    function pause() external authenticate {
        _pause();
    }

    function unpause() external authenticate {
        _unpause();
    }

    // Must impement for BasePoolAuthorization
    function _getAuthorizer() internal view override returns (IAuthorizer) {
        return vault.getAuthorizer();
    }

}