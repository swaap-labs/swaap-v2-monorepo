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

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";
import "@swaap-labs/swaap-core-v1/contracts/ChainlinkUtils.sol";

abstract contract SafeGuardBasePool is BasePool {
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    uint256 private constant _MAX_TOKENS = 8;

    uint256 private immutable _totalTokens;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    IERC20 internal immutable _token2;
    IERC20 internal immutable _token3;
    IERC20 internal immutable _token4;
    IERC20 internal immutable _token5;
    IERC20 internal immutable _token6;
    IERC20 internal immutable _token7;
    
    AggregatorV3Interface internal immutable _oracle0;
    AggregatorV3Interface internal immutable _oracle1;
    AggregatorV3Interface internal immutable _oracle2;
    AggregatorV3Interface internal immutable _oracle3;
    AggregatorV3Interface internal immutable _oracle4;
    AggregatorV3Interface internal immutable _oracle5;
    AggregatorV3Interface internal immutable _oracle6;
    AggregatorV3Interface internal immutable _oracle7;

    uint256 internal immutable _decimals0;
    uint256 internal immutable _decimals1;
    uint256 internal immutable _decimals2;
    uint256 internal immutable _decimals3;
    uint256 internal immutable _decimals4;
    uint256 internal immutable _decimals5;
    uint256 internal immutable _decimals6;
    uint256 internal immutable _decimals7;

    uint256 internal _equilibriumBalance0;
    uint256 internal _equilibriumBalance1;
    uint256 internal _equilibriumBalance2;
    uint256 internal _equilibriumBalance3;
    uint256 internal _equilibriumBalance4;
    uint256 internal _equilibriumBalance5;
    uint256 internal _equilibriumBalance6;
    uint256 internal _equilibriumBalance7;


    // [ signer address | performance update interval | latest performance update ]
    // [    160 bits    |           48 bits           |           48 bits         ]
    // [ MSB                                                                  LSB ]
    bytes32 private _miscData;

    // used to get the signer's address
    uint256 private constant _SIGNER_ADDRESS_OFFSET = 96;
    uint256 private constant _SIGNER_ADDRESS_BIT_LENGTH = 160;

    // used to determine if a performance update is needed before a swap / one-asset-join / one-asset-exit
    uint256 private constant _PERFORMANCE_UPDATE_INTERVAL_BIT_OFFSET = 48;
    uint256 private constant _LATEST_PERFORMANCE_UPDATE_OFFSET = 0;

    // 48 bits is more than enough to store a block timestamp value
    uint256 private constant _PERFORMANCE_TIME_BIT_LENGTH = 48;

    event PerformanceUpdateIntervalChanged(uint256 performanceUpdateInterval);

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        AggregatorV3Interface[] memory oracles,
        address[] memory assetManagers,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        uint256 performanceUpdateInterval
    )   BasePool(
            vault,
            // Given BaseMinimalSwapInfoPool supports both of these specializations, and this Pool never registers
            // or deregisters any tokens after construction, picking Two Token when the Pool only has two tokens is free
            // gas savings.
            // If the pool is expected to be able register new tokens in future, we must choose MINIMAL_SWAP_INFO
            // as clearly the TWO_TOKEN specification doesn't support adding extra tokens in future.
            // tokens.length == 2
            //     ? IVault.PoolSpecialization.TWO_TOKEN
            //     : IVault.PoolSpecialization.GENERAL,
            IVault.PoolSpecialization.GENERAL,
            name,
            symbol,
            tokens,
            assetManagers,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        ) 
    {
        // add upscaling
        uint256 numTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(numTokens, oracles.length);

        // TODO check if this format is more gas efficient
        // (_token0, _oracle0, _decimals0) = (tokens[0], oracles[0], tokens[0].decimals() + oracles[0].decimals());
        // (_token1, _oracle1, _decimals1) = (tokens[1], oracles[1], tokens[1].decimals() + oracles[1].decimals());

        // (_token2, _oracle2, _decimals2) = numTokens > 2 ? 
        //     (tokens[2], oracles[2], tokens[2].decimals() + oracles[2].decimals()) 
        //     : (IERC20(0), AggregatorV3Interface(0), 0);

        // (_token3, _oracle3, _decimals3) = numTokens > 3 ? 
        //     (tokens[3], oracles[3], tokens[3].decimals() + oracles[3].decimals()) 
        //     : (IERC20(0), AggregatorV3Interface(0), 0);

        // (_token4, _oracle4, _decimals4) = numTokens > 4 ? 
        //     (tokens[4], oracles[4], tokens[4].decimals() + oracles[4].decimals()) 
        //     : (IERC20(0), AggregatorV3Interface(0), 0);

        // (_token5, _oracle5, _decimals5) = numTokens > 5 ? 
        //     (tokens[5], oracles[5], tokens[5].decimals() + oracles[5].decimals()) 
        //     : (IERC20(0), AggregatorV3Interface(0), 0);

        // (_token6, _oracle6, _decimals6) = numTokens > 6 ? 
        //     (tokens[6], oracles[6], tokens[6].decimals() + oracles[6].decimals()) 
        //     : (IERC20(0), AggregatorV3Interface(0), 0);

        // (_token7, _oracle7, _decimals7) = numTokens > 7 ? 
        //     (tokens[7], oracles[7], tokens[7].decimals() + oracles[7].decimals()) 
        //     : (IERC20(0), AggregatorV3Interface(0), 0);

        _token0 = tokens[0];
        _token1 = tokens[1];
        _token2 = numTokens > 2 ? tokens[2] : IERC20(0);
        _token3 = numTokens > 3 ? tokens[3] : IERC20(0);
        _token4 = numTokens > 4 ? tokens[4] : IERC20(0);
        _token5 = numTokens > 5 ? tokens[5] : IERC20(0);
        _token6 = numTokens > 6 ? tokens[6] : IERC20(0);
        _token7 = numTokens > 7 ? tokens[7] : IERC20(0);

        _oracle0 = oracles[0];
        _oracle1 = oracles[1];
        _oracle2 = numTokens > 2 ? oracles[2] : AggregatorV3Interface(0);
        _oracle3 = numTokens > 3 ? oracles[3] : AggregatorV3Interface(0);
        _oracle4 = numTokens > 4 ? oracles[4] : AggregatorV3Interface(0);
        _oracle5 = numTokens > 5 ? oracles[5] : AggregatorV3Interface(0);
        _oracle6 = numTokens > 6 ? oracles[6] : AggregatorV3Interface(0);
        _oracle7 = numTokens > 7 ? oracles[7] : AggregatorV3Interface(0);

        _decimals0 = tokens[0].decimals() + oracles[0].decimals();
        _decimals1 = tokens[1].decimals() + oracles[1].decimals();
        _decimals2 = numTokens > 2 ? tokens[2].decimals() + oracles[2].decimals() : 0;
        _decimals3 = numTokens > 3 ? tokens[3].decimals() + oracles[3].decimals() : 0;
        _decimals4 = numTokens > 4 ? tokens[4].decimals() + oracles[4].decimals() : 0;
        _decimals5 = numTokens > 5 ? tokens[5].decimals() + oracles[5].decimals() : 0;
        _decimals6 = numTokens > 6 ? tokens[6].decimals() + oracles[6].decimals() : 0;
        _decimals7 = numTokens > 7 ? tokens[7].decimals() + oracles[7].decimals() : 0;

        _totalTokens = numTokens > _MAX_TOKENS? _MAX_TOKENS : numTokens;

        // TODO add signer setter
        _setPerformanceUpdateInterval(performanceUpdateInterval);

    }

    function onSwap(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external override onlyVault(swapRequest.poolId) returns (uint256) {
        _beforeSwapJoinExit();

        _validateIndexes(indexIn, indexOut, _getTotalTokens());

        return
            swapRequest.kind == IVault.SwapKind.GIVEN_IN
                ? _swapGivenIn(swapRequest, balances, indexIn, indexOut, scalingFactors)
                : _swapGivenOut(swapRequest, balances, indexIn, indexOut, scalingFactors);
    }

    function _swapGivenIn(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut,
        uint256[] memory scalingFactors
    ) internal virtual returns (uint256) {
        // Fees are subtracted before scaling, to reduce the complexity of the rounding direction analysis.
        swapRequest.amount = _subtractSwapFeeAmount(swapRequest.amount);

        _upscaleArray(balances, scalingFactors);
        swapRequest.amount = _upscale(swapRequest.amount, scalingFactors[indexIn]);

        uint256 amountOut = _onSwapGivenIn(swapRequest, balances, indexIn, indexOut);

        // amountOut tokens are exiting the Pool, so we round down.
        return _downscaleDown(amountOut, scalingFactors[indexOut]);
    }


    function _validateIndexes(
        uint256 indexIn,
        uint256 indexOut,
        uint256 limit
    ) private pure {
        _require(indexIn < limit && indexOut < limit, Errors.OUT_OF_BOUNDS);
    }

    // TODO Add signer setter

    /**
     * @notice Set the p erformance update interval.
     * @dev This is a permissioned function, and disabled if the pool is paused.
     * Emits the PerformanceUpdateIntervalChanged event.
     */
    function setPerformanceUpdateInterval(uint256 performanceUpdateInterval) external authenticate whenNotPaused {
        _setPerformanceUpdateInterval(performanceUpdateInterval);
    }

    function _setPerformanceUpdateInterval(uint256 performanceUpdateInterval) internal {

        // insertUint checks if the new value exceeds the given bit slot
        _miscData = _miscData.insertUint(
            performanceUpdateInterval,
            _PERFORMANCE_UPDATE_INTERVAL_BIT_OFFSET,
            _PERFORMANCE_TIME_BIT_LENGTH
        );

        emit PerformanceUpdateIntervalChanged(performanceUpdateInterval);
    }
}