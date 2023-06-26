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

pragma solidity =0.7.6;

contract TestOracle {

    uint80 private _latestRoundId = 10;
    uint8 private _decimals;

    int256 private _price;
    string private _description;

    constructor(string memory desc, int256 value, uint8 dec) {
        _description = desc;
        _price = value;
        _decimals = dec;
    }

    function decimals() public view returns (uint8) {
        return _decimals;
    }

    function version() public pure returns (uint256) {
        return 1;
    }

    function latestRoundData()
    public
    view
    returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (_latestRoundId, _price, block.timestamp, block.timestamp, _latestRoundId);
    }

    function latestAnswer() public view returns (int256) {
        return _price;
    }

    function setPrice(int256 newPrice) public {
        _price = newPrice;
    }

    function description() public view returns (string memory) {
        return string(abi.encode("Constant ", _description));
    }
}