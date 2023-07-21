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

pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import { Test } from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/LogExpMath.sol";

import "../../contracts/SafeguardMath.sol";

/** 
 * @notice Intended to provide a fuzz test for the management fees.
 * @dev The property intended to be verified is that no matter the order of the join/exit operations
 * @dev the management fees are fairly extracted to all the users. 
 */
contract InvariantManagementFees is Test {
    
    using FixedPoint for uint256;

    uint256 private constant _ONE_YEAR = 365 days;
    uint256 private yearlyFees;
    
    // being 0.0001% accurate on the fees calculation is way more than enough
    uint256 private constant _PRECISION = 1e12; // 1e-6
    uint256 private constant _PERCENTAGE_PRECISION = 1e14; // 1e-4

    MockManagementFees mock;
    ManagementFeesHandler handler;

    function setUp() external {
        mock = new MockManagementFees();
        handler = new ManagementFeesHandler(address(mock));
        yearlyFees = mock.YEARLY_FEES();
        targetContract(address(handler));
    }

    // checks if at the end of the year we have the correct dilution (compounded over the years)
    function invariant_fair_yearly_fees() public {

        uint256 totalElapsedTime = mock.totalElapsedTime();
        
        // checks the invariant for all the users
        for(uint256 i = 0; i < 4; i++) {
            
            MockManagementFees.UserInfo memory userInfo = mock.getUserInfo(i);

            if (userInfo.bpt == 0 || userInfo.amountIn == 0) {
                continue;
            }

            uint256 userElapsedTime = totalElapsedTime - userInfo.lastJoinExitTime;
            
            // get minted supply until end of year
            uint256 timeToFullYear = _ONE_YEAR - (userElapsedTime % _ONE_YEAR);

            if(timeToFullYear == 0) {
                continue;
            }

            uint256 expectedMintedSupply = mock.getProtocolFees(timeToFullYear);

            uint256 expectedEOYSupply = mock.totalSupply() + expectedMintedSupply;

            uint256 numOfYears = userElapsedTime / _ONE_YEAR + 1;

            uint256 expectedEOYUserAssets = mock.computeProportionalAmountOut(
                mock.totalAssets(),
                expectedEOYSupply,
                userInfo.bpt
            );

            // for lower values, calculation precision becomes a problem and affects the test
            if(userInfo.bpt < 1e12 || expectedEOYUserAssets < 1e12) {
                continue;
            }

            uint256 targetCompoundedDilution = pow18(FixedPoint.ONE - yearlyFees, numOfYears);

            assertApproxEqRel(
                expectedEOYUserAssets,
                userInfo.amountIn.mulDown(targetCompoundedDilution),
                _PRECISION
            );
        }
    }

    // checks if the dilution is the same as the expected one
    function invariant_expected_dilution() public {

        uint256 totalElapsedTime = mock.totalElapsedTime();
        
        // checks the invariant for all the users
        for(uint256 i = 0; i < 4; i++) {
            
            MockManagementFees.UserInfo memory userInfo = mock.getUserInfo(i);

            if (userInfo.bpt < 1e12 || userInfo.amountIn < 1e12) {
                continue;
            }

            uint256 userElapsedTime = totalElapsedTime - userInfo.lastJoinExitTime;
            
            if(userElapsedTime == 0) {
                continue;
            }

            // actual owned assets
            uint256 actualOwnedAssets = mock.computeProportionalAmountOut(
                mock.totalAssets(),
                mock.totalSupply(),
                userInfo.bpt
            );

            // actual dilution
            uint256 actualDilution = actualOwnedAssets.divDown(userInfo.amountIn);

            uint256 expectedDilution = FixedPoint.ONE.divDown(
                FixedPoint.ONE + SafeguardMath.calcAccumulatedManagementFees(
                    userElapsedTime,
                    mock.yearlyRate(),
                    FixedPoint.ONE
                )
            );

            assertApproxEqRel(
                actualDilution,
                expectedDilution,
                _PRECISION
            );
        }

    }

    // checks if by diluting at the same rate for a year still holds out
    function invariant_fair_constant_dilution() public {

        uint256 totalElapsedTime = mock.totalElapsedTime();
        
        // checks the invariant for all the users
        for(uint256 i = 0; i < 4; i++) {

            MockManagementFees.UserInfo memory userInfo = mock.getUserInfo(i);

            // for lower values calculation precision becomes a problem and affects the test
            if (userInfo.bpt < 1e12 || userInfo.amountIn < 1e12) {
                continue;
            }

            uint256 userElapsedTime = totalElapsedTime - userInfo.lastJoinExitTime;

            if(userElapsedTime == 0) {
                continue;
            }

            // actual owned assets
            uint256 actualOwnedAssets = mock.computeProportionalAmountOut(
                mock.totalAssets(),
                mock.totalSupply(),
                userInfo.bpt
            );

            // actual dilution
            uint256 actualDilution = actualOwnedAssets.divDown(userInfo.amountIn);

            uint256 projectedNumOfYears = userElapsedTime / _ONE_YEAR + 1;

            uint256 projectedDilution = LogExpMath.pow(
                actualDilution,
                (projectedNumOfYears * _ONE_YEAR).divDown(userElapsedTime)
            );

            uint256 targetCompoundedDilution = pow18(FixedPoint.ONE - yearlyFees, projectedNumOfYears);

            assertApproxEqRel(
                projectedDilution,
                targetCompoundedDilution,
                _PERCENTAGE_PRECISION
            );
        }

    }

    function pow18(uint256 a, uint256 b) private pure returns (uint256) {
        
        if(b == 0) {
            return 1;
        }

        if(a == 0) {
            return 0;
        }

        uint256 result = a;

        for(uint i = 1; i < b; ++i) {
            result = result.mulDown(a);
        }

        return result;
    }

    // function assertApproxEqRel(
    //     uint256 a,
    //     uint256 b,
    //     uint256 maxPercentDelta
    // ) internal override {
    //     if ((b * maxPercentDelta) / 1e18 == 0) {
    //         assertApproxEqAbs(a, b, 1);
    //     } else {
    //         super.assertApproxEqRel(a, b, maxPercentDelta);
    //     }
    // }

}

contract ManagementFeesHandler is Test {

    uint256 private constant _MIN_BPT_IN = 1e15;
    uint256 private constant _MAX_BPT_IN = 1e22;

    uint256 private constant _MIN_BPT_OUT = 1e15;
    uint256 private constant _MAX_BPT_OUT = 1e22;

    uint256 private constant _MIN_ELAPSED_TIME = 1 days;
    uint256 private constant _MAX_ELAPSED_TIME = 6 * 30 days; // 6 months

    MockManagementFees mock;

    constructor(address _mock) {
        mock = MockManagementFees(_mock);
    }

    function joinPool(
        uint256 userId,
        uint256 bptOut,
        uint256 elapsedTime
    ) public {

        // we assume user 0 as having constant supply of reference
        userId = bound(userId, 1, 3);

        bptOut = bound(bptOut, _MIN_BPT_OUT, _MAX_BPT_OUT);

        elapsedTime = bound(elapsedTime, _MIN_ELAPSED_TIME, _MAX_ELAPSED_TIME);

        mock.joinPool(userId, bptOut, elapsedTime);
    }

    function exitPool(
        uint256 userId,
        uint256 bptIn,
        uint256 elapsedTime
    ) public {
        
        // we assume user 0 as having constant supply of reference
        userId = bound(userId, 1, 3);

        bptIn = bound(bptIn, _MIN_BPT_IN, _MAX_BPT_IN);

        bptIn = Math.min(bptIn, mock.getUserInfo(userId).bpt);

        elapsedTime = bound(elapsedTime, _MIN_ELAPSED_TIME, _MAX_ELAPSED_TIME);

        mock.exitPool(userId, bptIn, elapsedTime);
    }

    function claimFees(uint256 elapsedTime) public {
        // claim fees
        elapsedTime = bound(elapsedTime, _MIN_ELAPSED_TIME, _MAX_ELAPSED_TIME);

        mock.claimFees(elapsedTime);
    }

}

contract MockManagementFees is Test {

    using FixedPoint for uint256;

    uint256 private constant _INITIAL_BPT = 100e22;
    uint256 private constant _INITIAL_CONTRIBUTION = 90e20;

    uint256 private constant _ONE_YEAR = 365 days;

    uint256 public constant YEARLY_FEES = 15e15; // 1.5% yearly fees
    
    uint256 public immutable yearlyRate; // 1.5% yearly fees

    struct UserInfo {
        uint256 amountIn;
        uint256 bpt;
        uint256 lastJoinExitTime;
    }

    UserInfo[4] public userInfos;

    uint256 public totalAssets;
    uint256 public totalSupply;
    uint256 public totalElapsedTime;

    constructor() {
        // only user 0 has bpt initially and is constant
        userInfos[0].amountIn = _INITIAL_CONTRIBUTION;
        userInfos[0].bpt = _INITIAL_BPT;
        userInfos[0].lastJoinExitTime = 0;

        totalAssets = _INITIAL_CONTRIBUTION;
        totalSupply = _INITIAL_BPT;

        yearlyRate = SafeguardMath.calcYearlyRate(YEARLY_FEES);

    }

    modifier _claimFees_(uint256 elapsedTime) {
        claimFees(elapsedTime);
        _;
    }

    function getUserInfo(uint256 i) public view returns (UserInfo memory){
        return userInfos[i];
    }

    function claimFees(uint256 elapsedTime) public {

        totalElapsedTime += elapsedTime;

        if(elapsedTime > 0) {

            uint256 protocolFees = getProtocolFees(elapsedTime);

            _payProtocolFees(protocolFees);

        }
    }

    function getProtocolFees(uint256 elapsedTime) public view returns (uint256) {
        return SafeguardMath.calcAccumulatedManagementFees(
            elapsedTime,
            yearlyRate,
            totalSupply
        );
    }

    function _payProtocolFees(uint256 protocolFees) internal {
        // mint bpt to protocol
        totalSupply += protocolFees;
        console2.log("Minted Fees", protocolFees);
    }

    function joinPool(
        uint256 userId,
        uint256 bptOut,
        uint256 elapsedTime
    ) public _claimFees_(elapsedTime) {

        uint256 amountIn = computeProportionalAmountIn(
            totalAssets,
            totalSupply,
            bptOut
        );

        totalAssets += amountIn;
        totalSupply += bptOut;

        userInfos[userId].bpt += bptOut;
        userInfos[userId].amountIn = computeProportionalAmountIn(
            totalAssets,
            totalSupply,
            userInfos[userId].bpt
        );
        userInfos[userId].lastJoinExitTime = totalElapsedTime;

    }

    function exitPool(
        uint256 userId,
        uint256 bptIn,
        uint256 elapsedTime
    ) public _claimFees_(elapsedTime) {

        uint256 amountOut = computeProportionalAmountOut(
            totalAssets,
            totalSupply,
            bptIn
        );

        totalAssets -= amountOut;
        totalSupply -= bptIn;

        userInfos[userId].bpt -= bptIn;
        
        userInfos[userId].amountIn = computeProportionalAmountIn(
            totalAssets,
            totalSupply,
            userInfos[userId].bpt
        );
        
        userInfos[userId].lastJoinExitTime = totalElapsedTime;

    }


    function computeProportionalAmountIn(
        uint256 balance,
        uint256 bptTotalSupply,
        uint256 bptAmountOut
    ) public pure returns (uint256 amountIn) {
        /************************************************************************************
        // computeProportionalAmountsIn                                                    //
        // (per token)                                                                     //
        // aI = amountIn                   /      bptOut      \                            //
        // b = balance           aI = b * | ----------------- |                            //
        // bptOut = bptAmountOut           \  bptTotalSupply  /                            //
        // bpt = bptTotalSupply                                                            //
        ************************************************************************************/

        // Since we're computing amounts in, we round up overall. This means rounding up on both the
        // multiplication and division.

        uint256 bptRatio = bptAmountOut.divUp(bptTotalSupply);

        amountIn = balance.mulUp(bptRatio);
    }

    function computeProportionalAmountOut(
        uint256 balance,
        uint256 bptTotalSupply,
        uint256 bptAmountIn
    ) public pure returns (uint256 amountOut) {
        /**********************************************************************************************
        // computeProportionalAmountsOut                                                             //
        // (per token)                                                                               //
        // aO = tokenAmountOut             /        bptIn         \                                  //
        // b = tokenBalance      a0 = b * | ---------------------  |                                 //
        // bptIn = bptAmountIn             \     bptTotalSupply    /                                 //
        // bpt = bptTotalSupply                                                                      //
        **********************************************************************************************/

        // Since we're computing an amount out, we round down overall. This means rounding down on both the
        // multiplication and division.

        uint256 bptRatio = bptAmountIn.divDown(bptTotalSupply);

        amountOut = balance.mulDown(bptRatio);
    }

}
