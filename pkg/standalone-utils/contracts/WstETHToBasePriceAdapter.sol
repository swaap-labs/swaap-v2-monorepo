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

/*
                                      s███
                                    ██████
                                   @██████
                              ,s███`
                           ,██████████████
                          █████████^@█████_
                         ██████████_ 7@███_            "██████████M
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

pragma solidity ^0.8.18;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@swaap-labs/v2-interfaces/contracts/standalone-utils/IStETH.sol";
import "@swaap-labs/v2-interfaces/contracts/standalone-utils/IWstETHToBasePriceAdapter.sol";
import "@swaap-labs/v2-errors/contracts/SwaapV2Errors.sol";

/**
 * @title WstETHToBasePriceAdapter
 * @author Swaap-labs (https://github.com/swaap-labs/swaap-v2-monorepo)
 * @notice Price adapter to calculate price of (wstETH / USD) pair by using
 * @notice Chainlink data feed for (stETH / USD) and (wstETH / stETH) ratio.
 * @dev This contract is used to calculate price of (wstETH / USD) pair. The contract is
 * @dev inspired by WstETHSynchronicityPriceAdapter developed by BGD Labs & used by Aave.
*/
contract WstETHToBasePriceAdapter is IWstETHToBasePriceAdapter {
  /**
   * @notice Price feed for (ETH / Base) pair
   */
  AggregatorV3Interface public immutable STETH_TO_BASE;

  /**
   * @notice stETH token contract to get ratio
   */
  IStETH public immutable STETH;

  /**
   * @notice Number of decimals in the output of this price adapter
   */

  uint8 private constant PRICE_DECIMALS = 18;
  int256 public immutable STETH_TO_BASE_SCALE_FACTOR;

  /**
   * @notice Number of decimals for wstETH / stETH ratio
   */
  uint256 public constant ONE = 10**PRICE_DECIMALS;

  string private _description;

  /**
   * @param stEthToBaseAggregatorAddress the address of ETH / BASE feed
   * @param stEthAddress the address of the stETH contract
   * @param pairName name identifier
   */
  constructor(address stEthToBaseAggregatorAddress, address stEthAddress, string memory pairName) {
    STETH_TO_BASE = AggregatorV3Interface(stEthToBaseAggregatorAddress);
    STETH = IStETH(stEthAddress);

    uint256 decimals_ = STETH_TO_BASE.decimals();

    // should revert if decimals_ > PRICE_DECIMALS
    STETH_TO_BASE_SCALE_FACTOR = int256(10**(PRICE_DECIMALS - decimals_));

    _description = pairName;
  }

  /// @inheritdoc IWstETHToBasePriceAdapter
  function description() external view override returns (string memory) {
    return _description;
  }

  /// @inheritdoc IWstETHToBasePriceAdapter
  function decimals() external pure override returns (uint8) {
    return PRICE_DECIMALS;
  }

  /// @inheritdoc IWstETHToBasePriceAdapter
  function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {

    (
      uint80 roundId,
      int256 stEthToBasePrice,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    ) = STETH_TO_BASE.latestRoundData();
    
    int256 ratio = SafeCast.toInt256(STETH.getPooledEthByShares(ONE));  

    _srequire(stEthToBasePrice > 0 || ratio <= 0, SwaapV2Errors.NON_POSITIVE_PRICE);

    int256 scaledStEthToBasePrice = stEthToBasePrice * STETH_TO_BASE_SCALE_FACTOR;

    int256 wstEthToBasePrice = scaledStEthToBasePrice * ratio / int256(ONE);

    return (
      roundId,
      wstEthToBasePrice,
      startedAt,
      updatedAt,
      answeredInRound
    );
  }

}