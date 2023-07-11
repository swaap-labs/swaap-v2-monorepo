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

pragma solidity ^0.8.18;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
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

contract WstETHToBasePriceCache is IWstETHToBasePriceAdapter, Ownable {
  /**
   * @notice Price feed for (ETH / Base) pair
   */

  struct RateCache {
    int128 latestCachedRate;
    uint64 lastRateUpdate;
    bool paused;
  }

  RateCache public _rateCache;

  AggregatorV3Interface public immutable STETH_TO_BASE;

  /**
   * @notice stETH token contract to get ratio
   */
  IStETH public immutable STETH;

  /**
   * @notice Number of decimals in the output of this price adapter
   */

  uint8 private constant PRICE_DECIMALS = 18;

  /**
   * @notice Scale factor to convert stETH / BASE decimals to PRICE_DECIMALS
   */
  int256 public immutable STETH_TO_BASE_SCALE_FACTOR;

  /**
   * @notice Number of decimals for wstETH / stETH ratio
   */
  uint256 public constant ONE = 10**PRICE_DECIMALS;

  string private _description;

  modifier _whenNotPaused() {
    _srequire(!_rateCache.paused, SwaapV2Errors.PAUSED);
    _;
  }

  /**
   * @notice Maximum allowed timeout before updating the wstETH / stETH rate
   * @dev This is to prevent the price adapter from being used with outdated data
   * @dev The rate changes really slowly for wstETH / stETH (~4% yearly at the time of writing),
   * @dev updating the rate weekly or even monthly should be enough.
   */
  uint256 public constant MAX_UPDATE_TIMEOUT = 30 days;

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

    updateCache();

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
  function latestRoundData() external view override _whenNotPaused
  returns (uint80, int256, uint256, uint256, uint80) {

    (
      uint80 roundId,
      int256 stEthToBasePrice,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    ) = STETH_TO_BASE.latestRoundData();
    
    RateCache memory rateCache = _rateCache;

    _srequire(stEthToBasePrice > 0 && rateCache.latestCachedRate > 0, SwaapV2Errors.NON_POSITIVE_PRICE);

    int256 wstEthToBasePrice = stEthToBasePrice * STETH_TO_BASE_SCALE_FACTOR * rateCache.latestCachedRate / int256(ONE);

    _srequire(block.timestamp - rateCache.lastRateUpdate < MAX_UPDATE_TIMEOUT, SwaapV2Errors.EXCEEDS_TIMEOUT);

    return (
      roundId,
      wstEthToBasePrice,
      startedAt,
      updatedAt,
      answeredInRound
    );
  }

  function updateCache() public {
    RateCache storage rateCache = _rateCache;
    uint256 rate = STETH.getPooledEthByShares(ONE);

    if(rate < uint128(type(int128).max)) {
      rateCache.latestCachedRate = int128(uint128(rate));
    } else {
      // if the rate is too high, we set it to -1 to avoid overflow and make the price adapter unusable.
      // however overflowing should never happen in practice
      rateCache.latestCachedRate = int128(-1);
    }

    rateCache.lastRateUpdate = uint64(block.timestamp); 

    emit PriceUpdated(rateCache.latestCachedRate, rateCache.lastRateUpdate); 
  }

  function pause() external onlyOwner {
    _rateCache.paused = true;
    emit PauseStateChanged(true);
  }

  function unpause() external onlyOwner {
    _rateCache.paused = false;
    emit PauseStateChanged(false);
  }

}