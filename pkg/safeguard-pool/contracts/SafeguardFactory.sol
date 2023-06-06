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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolFactory.sol";

import "./SafeguardPool.sol";
import "@swaap-labs/v2-interfaces/contracts/safeguard-pool/ISafeguardPool.sol";
import "@swaap-labs/v2-interfaces/contracts/safeguard-pool/ISafeguardFactory.sol";

contract SafeguardFactory is ISafeguardFactory, BasePoolFactory {

    constructor(
        IVault vault,
        IProtocolFeePercentagesProvider protocolFeeProvider,
        uint256 initialPauseWindowDuration,
        uint256 bufferPeriodDuration
    )
        BasePoolFactory(
            vault,
            protocolFeeProvider,
            initialPauseWindowDuration,
            bufferPeriodDuration,
            type(SafeguardPool).creationCode
        )
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Deploys a new `SafeguardPool`.
     */
    function create(
        SafeguardFactoryParameters memory parameters,
        bytes32 salt
    ) external override returns (address) {
        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();
        
        address pool = super._create(
            abi.encode(
                getVault(),
                parameters.name,
                parameters.symbol,
                parameters.tokens,
                new address[](parameters.tokens.length), // Don't allow asset managers
                pauseWindowDuration,
                bufferPeriodDuration,
                0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B, // only delegate ownership
                parameters.oracleParams,
                parameters.safeguardParameters
            ), 
            salt
        );

        if(parameters.setPegStates) {
            ISafeguardPool(pool).evaluateStablesPegStates();
        }

        return pool;
    }
}