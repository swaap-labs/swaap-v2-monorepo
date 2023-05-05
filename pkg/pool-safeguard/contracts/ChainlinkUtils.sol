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

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@chainlink/contracts/src/v0.7/interfaces/AggregatorV3Interface.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@swaap-labs/v2-errors/contracts/Errors.sol";

library ChainlinkUtils {

    uint256 constant private _ORACLE_TIMEOUT = 1.5 days;

    function getLatestPrice(AggregatorV3Interface oracle) internal view returns (uint256) {
        (
            , int256 latestPrice, , uint256 latestTimestamp,
        ) = AggregatorV3Interface(oracle).latestRoundData();
        // we assume that block.timestamp >= latestTimestamp
        _srequire(latestTimestamp >= block.timestamp - _ORACLE_TIMEOUT, SwaapV2Errors.EXCEEDS_TIMEOUT);
        _srequire(latestPrice > 0, SwaapV2Errors.NON_POSITIVE_PRICE);
        return uint256(latestPrice);
    }

    function computePriceScalingFactor(AggregatorV3Interface oracle) internal view returns (uint256) {
        // Oracles that don't implement the `decimals` method are not supported.
        uint256 oracleDecimals = oracle.decimals();

        // Oracles with more than 18 decimals are not supported.
        uint256 decimalsDifference = Math.sub(18, oracleDecimals);
        return FixedPoint.ONE * 10**decimalsDifference;
    }

}