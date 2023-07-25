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
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/BasePoolMath.sol";

import "../../contracts/SafeguardMath.sol";

/** 
 * @notice Intended to provide a fuzz test for the joinswap / exitswap operations.
 * @dev The property intended to be verified is that the tvl per pool share is not affected
 * @dev by the joinswap / exitswap operation.
 */
contract SafeguardJoinExitSwapFuzz is Test {
    using FixedPoint for uint256;

    uint256 private constant _MINIMUM_BPT = 1e18;
    uint256 private constant _MAXIMUM_BPT = 1e30;

    uint256 private constant _MINIMUM_BALANCE = 1e18;
    uint256 private constant _MAXIMUM_BALANCE = 1e30;

    uint256 private constant _MIN_PRICE = 1e9;
    uint256 private constant _MAX_PRICE = 1e27;

    uint256 private constant _PRECISION = 1e6; // 1e-12 of precision

    function test_JoinSwap(
        uint256[2] memory balances,
        uint256[2] memory joinAmounts,
        uint256 quoteAmountInPerOut,
        uint256 bptTotalSupply
    ) external {

        for(uint i = 0; i < 2; ++i) {
            balances[i] = bound(balances[i], _MINIMUM_BALANCE, _MAXIMUM_BALANCE);
            joinAmounts[i] = bound(joinAmounts[i], 0, balances[i] / 2);
        }
        
        // Avoids uneccesary reverts.
        vm.assume(joinAmounts[0] > 0 || joinAmounts[1] > 0);

        quoteAmountInPerOut = bound(quoteAmountInPerOut, _MIN_PRICE, _MAX_PRICE);

        bptTotalSupply = bound(bptTotalSupply, _MINIMUM_BPT, _MAXIMUM_BPT);

        // limit token is the token that is swapped out
        bool isLimitToken0 = joinAmounts[0].mulDown(balances[1]) <= joinAmounts[1].mulDown(balances[0]);

        uint256 bptAmountOut = mockJoinExactTokensInForBptOut(
            balances,
            joinAmounts,
            isLimitToken0,
            quoteAmountInPerOut,
            bptTotalSupply
        );

        uint256 tvlPerPTBefore = tvlPerPT(
            balances[0],
            balances[1],
            bptTotalSupply,
            !isLimitToken0,
            quoteAmountInPerOut
        );           

        uint256 tvlPerPTAfter = tvlPerPT(
            balances[0] + joinAmounts[0],
            balances[1] + joinAmounts[1],
            bptTotalSupply + bptAmountOut,
            !isLimitToken0,
            quoteAmountInPerOut
        );

        // avoids cases where totalSupply is too big
        vm.assume(tvlPerPTAfter > 0 && tvlPerPTBefore > 0);

        assertApproxEqRel(tvlPerPTBefore, tvlPerPTAfter, _PRECISION);

    }

    function mockJoinExactTokensInForBptOut(
        uint256[2] memory balances,
        uint256[2] memory joinAmounts,
        bool isLimitToken0,
        uint256 quoteAmountInPerOut,
        uint256 bptTotalSupply
    ) internal pure returns(uint256 bptAmountOut) {
            
        (uint256 excessTokenBalance, uint256 limitTokenBalance) = isLimitToken0?
            (balances[1], balances[0]) : (balances[0], balances[1]);

        (uint256 excessTokenAmountIn, uint256 limitTokenAmountIn) = isLimitToken0?
            (joinAmounts[1], joinAmounts[0]) : (joinAmounts[0], joinAmounts[1]);
        
        (
            uint256 swapAmountIn,
            // swapAmountOut
        ) = SafeguardMath.calcJoinSwapAmounts(
            excessTokenBalance,
            limitTokenBalance,
            excessTokenAmountIn,
            limitTokenAmountIn,
            quoteAmountInPerOut
        );

        uint256 rOpt = SafeguardMath.calcJoinSwapROpt(excessTokenBalance, excessTokenAmountIn, swapAmountIn);

        bptAmountOut = bptTotalSupply.mulDown(rOpt);
    }

    function test_ExitSwap(
        uint256[2] memory balances,
        uint256[2] memory exitAmounts,
        uint256 quoteAmountInPerOut,
        uint256 bptTotalSupply
    ) external {

        for(uint i = 0; i < 2; ++i) {
            balances[i] = bound(balances[i], _MINIMUM_BALANCE, _MAXIMUM_BALANCE);
            exitAmounts[i] = bound(exitAmounts[i], 0, balances[i] / 2);
        }
        
        // Avoids uneccesary reverts.
        vm.assume(exitAmounts[0] > 0 || exitAmounts[1] > 0);

        quoteAmountInPerOut = bound(quoteAmountInPerOut, _MIN_PRICE, _MAX_PRICE);

        bptTotalSupply = bound(bptTotalSupply, _MINIMUM_BPT, _MAXIMUM_BPT);    
    
        // limit token is the token that is swapped in
        bool isLimitToken0 = exitAmounts[0].mulDown(balances[1]) <= exitAmounts[1].mulDown(balances[0]);

        uint256 bptAmountIn = mockExitBPTInForExactTokensOut(
            balances,
            exitAmounts,
            isLimitToken0,
            quoteAmountInPerOut,
            bptTotalSupply
        );

        uint256 tvlPerPTBefore = tvlPerPT(
            balances[0],
            balances[1],
            bptTotalSupply,
            isLimitToken0,
            quoteAmountInPerOut
        );           

        uint256 tvlPerPTAfter = tvlPerPT(
            balances[0] - exitAmounts[0],
            balances[1] - exitAmounts[1],
            bptTotalSupply - bptAmountIn,
            isLimitToken0,
            quoteAmountInPerOut
        );

        // avoids cases where totalSupply is too big
        vm.assume(tvlPerPTAfter > 0 && tvlPerPTBefore > 0);

        assertApproxEqRel(tvlPerPTBefore, tvlPerPTAfter, _PRECISION);

    }

    function mockExitBPTInForExactTokensOut(
        uint256[2] memory balances,
        uint256[2] memory exitAmounts,
        bool isLimitToken0,
        uint256 quoteAmountInPerOut,
        uint256 bptTotalSupply
    ) pure internal returns(uint256 bptAmountIn) {
        
        (uint256 excessTokenBalance, uint256 limitTokenBalance) = isLimitToken0?
            (balances[1], balances[0]) : (balances[0], balances[1]);

        (uint256 excessTokenAmountOut, uint256 limitTokenAmountOut) = isLimitToken0?
            (exitAmounts[1], exitAmounts[0]) : (exitAmounts[0], exitAmounts[1]);
        
        (
            , // swapAmountIn
            uint256 swapAmountOut
        ) = SafeguardMath.calcExitSwapAmounts(
            excessTokenBalance,
            limitTokenBalance,
            excessTokenAmountOut,
            limitTokenAmountOut,
            quoteAmountInPerOut
        );

        uint256 rOpt = SafeguardMath.calcExitSwapROpt(excessTokenBalance, excessTokenAmountOut, swapAmountOut);

        bptAmountIn = bptTotalSupply.mulUp(rOpt);
    }

    function tvlPerPT(
        uint256 balance0,
        uint256 balance1,
        uint256 totalSupply,
        bool isTokenInToken0,
        uint256 quoteAmountInPerOut
    ) pure internal returns(uint256) {
        
        uint256 tvl;
        
        if(isTokenInToken0) {
            // token 0 is limiting --> token 0 is the swapped token in 
            tvl = balance0.add(balance1.mulDown(quoteAmountInPerOut));
        } else {
            // token 1 is limiting --> token 1 is the swapped token in
            tvl = balance1.add(balance0.mulDown(quoteAmountInPerOut));           
        }

        return tvl.divDown(totalSupply);
    }

    function assertApproxEqRel(
        uint256 a,
        uint256 b,
        uint256 maxPercentDelta
    ) internal override {
        if ((b * maxPercentDelta) / 1e18 == 0) {
            assertApproxEqAbs(a, b, 1);
        } else {
            super.assertApproxEqRel(a, b, maxPercentDelta);
        }
    }

}
