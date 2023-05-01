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

    event PegStatesUpdated(bool isPegged0, bool isPegged1);
    event FlexibleOracleStatesUpdated(bool isFlexibleOracle0, bool isFlexibleOracle1);
    event SignerChanged(address signer);
    event MustAllowlistLPsSet(bool mustAllowlistLPs);
    event PerfUpdateIntervalChanged(uint256 perfUpdateInterval);
    event MaxPerfDevChanged(uint256 maxPerfDev);
    event MaxTargetDevChanged(uint256 maxTargetDev);
    event MaxPriceDevChanged(uint256 maxPriceDev);
    event PerformanceUpdated(uint256 hodlBalancePerPT0, uint256 hodlBalancePerPT1, uint256 amount0Per1, uint256 time);

    struct InitialSafeguardParams {
        address signer; // address that signs the quotes
        uint256 maxPerfDev; // maximum performance deviation
        uint256 maxTargetDev; // maximum balance deviation from hodl benchmark
        uint256 maxPriceDev; // maximum price deviation
        uint256 perfUpdateInterval; // performance update interval
        uint256 yearlyFees; // management fees in yearly %
        bool    mustAllowlistLPs; // must use allowlist flag
    }

    struct InitialOracleParams {
        AggregatorV3Interface oracle;
        bool isStable;
        bool isFlexibleOracle;
    }

    /// @dev sets or removes flexible oracles
    function setFlexibleOracleStates(bool isFlexibleOracle0, bool isFlexibleOracle1) external;

    /// @dev sets or removes allowlist 
    function setMustAllowlistLPs(bool mustAllowlistLPs) external;

    /// @dev sets the quote signer
    function setSigner(address signer) external;

    /// @dev sets the performance update interval
    function setPerfUpdateInterval(uint256 perfUpdateInterval) external;

    /// @dev sets the max performance deviation
    function setMaxPerfDev(uint256 maxPerfDev) external;

    /// @dev sets the maximum deviation from target balances
    function setMaxTargetDev(uint256 maxTargetDev) external;

    /// @dev sets the maximum quote price deviation from the oracles
    function setMaxPriceDev(uint256 maxPriceDev) external;

    /// @dev updates the performance and the hodl balances (should be permissionless)
    function updatePerformance() external;

    /// @dev unpegs or repegs oracles based on the latest prices (should be permissionless)
    function evaluateStablesPegStates() external;
}