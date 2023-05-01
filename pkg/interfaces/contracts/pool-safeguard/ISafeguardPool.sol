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

import "../solidity-utils/openzeppelin/IERC20.sol";
import "@chainlink/contracts/src/v0.7/interfaces/AggregatorV3Interface.sol";

interface ISafeguardPool {

    struct InitialSafeguardParams {
        address signer; // address that signs the quotes
        uint256 maxPerfDev; // maximum performance deviation
        uint256 maxTargetDev; // maximum balance deviation from hodl benchmark
        uint256 maxPriceDev; // maximum price deviation
        uint256 perfUpdateInterval; // performance update interval
        uint256 yearlyFees; // management fees in yearly %
        bool    isAllowlistEnabled; // use allowlist flag
    }

    struct InitialOracleParams {
        AggregatorV3Interface oracle;
        bool isStable;
        bool isFlexibleOracle;
    }

    function evaluateStablesPegStates() external;
}