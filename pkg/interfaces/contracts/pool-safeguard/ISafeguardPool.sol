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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

interface ISafeguardPool {

    struct InitialSafeguardParams {
        address signer;
        uint256 maxTVLoffset;
        uint256 maxBalOffset;
        uint256 perfUpdateInterval;
        uint256 maxPriceOffet;
    }

    struct PricingParams {
        uint256 maxSwapAmount; // max swap amount in or out for which the quote is valid
        uint256 quoteAmountInPerOut; // base quote before slippage
        uint256 balanceChangeTolerance; // maximum balance change tolerance
        uint256 quoteBalanceIn; // expected on chain balanceIn
        uint256 quoteBalanceOut; // expected on chain balanceOut
        uint256 balanceBasedSlippage; // balance change slippage parameter
        uint256 startTime; // time before applying time based slippage
        uint256 timeBasedSlippage; // elapsed time slippage parameter
        uint256 originBasedSlippage; // slippage based on different tx.origin
    }

}