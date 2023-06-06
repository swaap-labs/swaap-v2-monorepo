import { ethers } from 'hardhat';
import '@balancer-labs/v2-common/setupTests'
import { fp, fpDiv } from '@balancer-labs/v2-helpers/src/numbers';
import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { 
  calcYearlyRate, 
  calcAccumulatedManagementFees, 
  calcTimeSlippagePenalty,
  calcJoinSwapAmounts,
  calcJoinSwapROpt,
  calcExitSwapAmounts,
  calcExitSwapROpt
} from '@balancer-labs/v2-helpers/src/models/pools/safeguard/math'
import { expect } from 'chai';
import { DAY } from '@balancer-labs/v2-helpers/src/time';
import { expectRelativeErrorBN } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import '@balancer-labs/v2-common/setupTests'

describe('SafeguardMath', () => {
  let lib: Contract;

  const tolerance = fp(1e-9);

  sharedBeforeEach('deploy lib', async () => {
    lib = await deploy('v2-safeguard-pool/TestSafeguardMath', { args: [] });
  });

  describe('Management fees', () => {

    it ('Check helper functions', async () => {
      const ts = 1000
      const rate = 3 / 100
      const yearlyRateTerm = calcYearlyRate(rate)
      const expected = ts * (1 / (1 - rate) - 1)
      const actual = calcAccumulatedManagementFees(
        365 * DAY,
        yearlyRateTerm,
        ts
      )
      expectRelativeErrorBN(fp(actual), fp(expected), tolerance)
    });
  });

  describe('calcYearlyRate', () => {

    it ('0 rate', async () => {
      const rawRateNumber = 0 / 100
      const actual = await lib.calcYearlyRate(fp(rawRateNumber))
      expect(actual, "rate should be zero").to.be.zero
    });

    it ('non-0 rate', async () => {
      const rawRateNumber = 3 / 100
      const expected = fp(calcYearlyRate(rawRateNumber))
      const actual = await lib.calcYearlyRate(fp(rawRateNumber))
      expectRelativeErrorBN(actual, expected, tolerance)
    });

  });

  describe('calcAccumulatedManagementFees', () => {

    it ('0 fee', async () => {
      const rawRateNumber = 0
      const elapsedTimeNumber = Math.round(365 * DAY)
      const yearlyRateNumber = calcYearlyRate(rawRateNumber)
      const currentSupplyNumber = 99
      const actualMintedSupply = await lib.calcAccumulatedManagementFees(
        elapsedTimeNumber,
        fp(yearlyRateNumber),
        fp(currentSupplyNumber)
      )
      expect(actualMintedSupply, "rate should be zero").to.be.zero
    });

    it ('1-year fee', async () => {
      const rawRateNumber = 3 / 100
      const elapsedTimeNumber = Math.round(365 * DAY)
      const yearlyRateNumber = calcYearlyRate(rawRateNumber)
      const initialSupply = 99
      const expectedMintedSupply = fp(
        calcAccumulatedManagementFees(
          elapsedTimeNumber,
          yearlyRateNumber,
          initialSupply
        )
      )
      const actualMintedSupply = await lib.calcAccumulatedManagementFees(
        elapsedTimeNumber,
        fp(yearlyRateNumber),
        fp(initialSupply)
      )
      expectRelativeErrorBN(actualMintedSupply, expectedMintedSupply, tolerance)
      
      const actualPoolOwnership = fpDiv(fp(initialSupply), fp(initialSupply).add(actualMintedSupply));
      const actualFees = fp(1).sub(actualPoolOwnership);
      expectRelativeErrorBN(actualFees, fp(rawRateNumber), tolerance);
    });

    it ('n-year rate', async () => {
      const rawRateNumber = 3 / 100
      const nYears = 50
      const elapsedTimeNumber = Math.round(nYears * 365 * DAY)
      const yearlyRateNumber = calcYearlyRate(rawRateNumber)
      const initialSupply = 99
      const expectedPoolOwnership = fp((1 - rawRateNumber) ** nYears);
      const actualMintedSupply = await lib.calcAccumulatedManagementFees(
        elapsedTimeNumber,
        fp(yearlyRateNumber),
        fp(initialSupply)
      )
      const actualPoolOwnership = fpDiv(fp(initialSupply), actualMintedSupply.add(fp(initialSupply)));
      console.log(actualPoolOwnership);
      expectRelativeErrorBN(actualPoolOwnership, expectedPoolOwnership, tolerance)
    });


  });

  describe('calcTimeSlippagePenalty', () => {
    
    it ('no penalty: currentTimestamp < startTime', async () => {
      const currentTimestamp = 1290
      const startTime = currentTimestamp + 10
      const timeBasedSlippage = 0.00012345
      const actual = await lib.calcTimeSlippagePenalty(
        currentTimestamp,
        startTime,
        fp(timeBasedSlippage)
      )
      expect(actual).to.be.zero
    });

    it ('no penalty: timeBasedSlippage = 0', async () => {
      const currentTimestamp = 1290
      const startTime = currentTimestamp - 10
      const timeBasedSlippage = 0.
      const actual = await lib.calcTimeSlippagePenalty(
        currentTimestamp,
        startTime,
        fp(timeBasedSlippage)
      )
      expect(actual).to.be.zero
    });

    it ('non 0 penalty', async () => {
      const currentTimestamp = 1290
      const startTime = currentTimestamp - 10
      const timeBasedSlippage = 0.00012345
      const actual = await lib.calcTimeSlippagePenalty(
        currentTimestamp,
        startTime,
        fp(timeBasedSlippage)
      )
      const expected = fp(calcTimeSlippagePenalty(currentTimestamp, startTime, timeBasedSlippage))
      expectRelativeErrorBN(actual, expected, tolerance)
    });

  });
  
  describe('calcOriginBasedSlippage', () => {

    it ('slippage', async () => {
      const [deployer, ] = await ethers.getSigners();
      const expectedOrigin = deployer.address
      const originBasedSlippage = fp(0.00012345)
      const actual = await lib.connect(ZERO_ADDRESS).calcOriginBasedSlippage(
          expectedOrigin,
          originBasedSlippage, 
      )
      const expected = originBasedSlippage
      expectRelativeErrorBN(actual, expected, tolerance)
    });

    it ('no slippage', async () => {
      const [deployer, lp] = await ethers.getSigners();
      const expectedOrigin = deployer.address
      const originBasedSlippage = fp(0.00012345)
      const actual = await lib.connect(expectedOrigin).calcOriginBasedSlippage(
        expectedOrigin,
        originBasedSlippage, 
      )
      expect(actual).to.be.zero
    });

  });

  describe('calcBalanceBasedPenalty', () => {

    it ('slippage on balance of tokenIn', async () => {
      const balanceTokenIn = fp(1)
      const balanceTokenOut = fp(1)
      const totalSupply = fp(100)
      const quoteBalanceIn = fp(2)
      const quoteBalanceOut = fp(1)
      const quoteTotalSupply = totalSupply;
      const balanceChangeTolerance = fp(1) // 100%
      const balanceBasedSlippage = fp(0.01)

      const actual = await lib.connect(ZERO_ADDRESS).calcBalanceBasedPenalty(
        balanceTokenIn,
        balanceTokenOut,
        totalSupply,
        quoteBalanceIn,
        quoteBalanceOut,
        quoteTotalSupply,
        balanceChangeTolerance,
        balanceBasedSlippage
      );

      const expected = balanceBasedSlippage.mul(quoteBalanceIn.sub(balanceTokenIn)).mul(fp(1)).div(balanceTokenIn).div(fp(1))
      expectRelativeErrorBN(actual, expected, tolerance)
    });

    it ('slippage on balance of tokenOut', async () => {
      const balanceTokenIn = fp(1)
      const balanceTokenOut = fp(1)
      const totalSupply = fp(100);
      const quoteBalanceIn = fp(2)
      const quoteBalanceOut = fp(2)
      const quoteTotalSupply = totalSupply;
      const balanceChangeTolerance = fp(1) // 100%
      const balanceBasedSlippage = fp(0.01)

      const actual = await lib.connect(ZERO_ADDRESS).calcBalanceBasedPenalty(
        balanceTokenIn,
        balanceTokenOut,
        totalSupply,
        quoteBalanceIn,
        quoteBalanceOut,
        quoteTotalSupply,
        balanceChangeTolerance,
        balanceBasedSlippage
      )
      const expected = balanceBasedSlippage.mul(quoteBalanceOut.sub(balanceTokenOut)).mul(fp(1)).div(balanceTokenOut).div(fp(1))
      expectRelativeErrorBN(actual, expected, tolerance)
    });

    it ('slippage on balance per PT change', async () => {
      const balanceTokenIn = fp(1)
      const balanceTokenOut = fp(1)
      const totalSupply = fp(150);
      const quoteBalanceIn = fp(1)
      const quoteBalanceOut = fp(1)
      const quoteTotalSupply = fp(100);
      const balanceChangeTolerance = fp(1) // 100%
      const balanceBasedSlippage = fp(0.01)

      const actual = await lib.connect(ZERO_ADDRESS).calcBalanceBasedPenalty(
        balanceTokenIn,
        balanceTokenOut,
        totalSupply,
        quoteBalanceIn,
        quoteBalanceOut,
        quoteTotalSupply,
        balanceChangeTolerance,
        balanceBasedSlippage
      )

      const expected = balanceBasedSlippage.mul(totalSupply.sub(quoteTotalSupply)).div(quoteTotalSupply);
      expectRelativeErrorBN(actual, expected, tolerance)
    });

    it ('reverts on large balance change', async () => {
      const balanceTokenIn = fp(1)
      const balanceTokenOut = fp(1)
      const totalSupply = fp(100);
      const quoteBalanceIn = fp(2)
      const quoteBalanceOut = fp(3)
      const quoteTotalSupply = totalSupply;
      const balanceChangeTolerance = fp(0.1) // 10%
      const balanceBasedSlippage = fp(0.01)
      await expect(
        lib.connect(ZERO_ADDRESS).calcBalanceBasedPenalty(
          balanceTokenIn,
          balanceTokenOut,
          totalSupply,
          quoteBalanceIn,
          quoteBalanceOut,
          quoteTotalSupply,
          balanceChangeTolerance,
          balanceBasedSlippage
        )
      ).to.be.revertedWith("SWAAP#20")
    });

    it ('reverts on large balance per PT change', async () => {
      const balanceTokenIn = fp(1)
      const balanceTokenOut = fp(1)
      const totalSupply = fp(150);
      const quoteBalanceIn = fp(1)
      const quoteBalanceOut = fp(1)
      const quoteTotalSupply = fp(100);
      const balanceChangeTolerance = fp(0.1) // 10%
      const balanceBasedSlippage = fp(0.01)
      await expect(
        lib.connect(ZERO_ADDRESS).calcBalanceBasedPenalty(
          balanceTokenIn,
          balanceTokenOut,
          totalSupply,
          quoteBalanceIn,
          quoteBalanceOut,
          quoteTotalSupply,
          balanceChangeTolerance,
          balanceBasedSlippage
        )
      ).to.be.revertedWith("SWAAP#20")
    });

  });

  describe('calcJoinSwapAmounts', () => {

    it ('calcJoinSwapAmounts', async () => {
      const excessTokenBalance = 10
      const limitTokenBalance = 10
      const excessTokenAmountIn = 2
      const limitTokenAmountIn = 1
      const quoteAmountInPerOut = 1/2
      const actual = await lib.calcJoinSwapAmounts(
        fp(excessTokenBalance),
        fp(limitTokenBalance), 
        fp(excessTokenAmountIn),
        fp(limitTokenAmountIn),
        fp(quoteAmountInPerOut)
      )
      const expected = calcJoinSwapAmounts(
        excessTokenBalance,
        limitTokenBalance, 
        excessTokenAmountIn,
        limitTokenAmountIn,
        quoteAmountInPerOut
      )
      expectRelativeErrorBN(actual[0], fp(expected[0]), tolerance)
      expectRelativeErrorBN(actual[1], fp(expected[1]), tolerance)

      const rOptExcess = await lib.calcJoinSwapROpt(
        fp(excessTokenBalance),
        fp(excessTokenAmountIn),
        actual[0]
      )
      expectRelativeErrorBN(
        fp(limitTokenAmountIn).add(actual[1]).mul(fp(1)).div(fp(limitTokenBalance).sub(actual[1])),
        rOptExcess,
        tolerance
      )

    });

  });

  describe('calcJoinSwapROpt', () => {

    it ('calcJoinSwapROpt', async () => {
      const excessTokenBalance = 10
      const excessTokenAmountIn = 2
      const swapAmountIn = 0.43478260869565216
      const actual = await lib.calcJoinSwapROpt(
        fp(excessTokenBalance),
        fp(excessTokenAmountIn),
        fp(swapAmountIn)
      )
      const expected = calcJoinSwapROpt(
        excessTokenBalance,
        excessTokenAmountIn,
        swapAmountIn
      )
      expectRelativeErrorBN(actual, fp(expected), tolerance)
    });

  });

  describe('calcExitSwapAmounts', () => {

    it ('calcExitSwapAmounts', async () => {
      const excessTokenBalance = 12
      const limitTokenBalance = 11
      const excessTokenAmountOut = 2
      const limitTokenAmountOut = 1
      const quoteAmountInPerOut = 1 / 2
      const actual = await lib.calcExitSwapAmounts(
        fp(excessTokenBalance),
        fp(limitTokenBalance), 
        fp(excessTokenAmountOut),
        fp(limitTokenAmountOut),
        fp(quoteAmountInPerOut)
      )
      const expected = calcExitSwapAmounts(
        excessTokenBalance,
        limitTokenBalance, 
        excessTokenAmountOut,
        limitTokenAmountOut,
        quoteAmountInPerOut
      )
      expectRelativeErrorBN(actual[0], fp(expected[0]), tolerance)
      expectRelativeErrorBN(actual[1], fp(expected[1]), tolerance)

      const rOptExcess = await lib.calcExitSwapROpt(
        fp(excessTokenBalance),
        fp(excessTokenAmountOut),
        actual[0]
      )
      expectRelativeErrorBN(
        fp(limitTokenAmountOut).add(actual[1]).mul(fp(1)).div(fp(limitTokenBalance).add(actual[1])),
        rOptExcess,
        tolerance
      )

    });

  });

  describe('calcExitSwapROpt', () => {

    it ('calcExitSwapROpt', async () => {
      const excessTokenBalance = 12
      const excessTokenAmountOut = 2
      const swapAmountOut = 0.5
      const actual = await lib.calcExitSwapROpt(
        fp(excessTokenBalance),
        fp(excessTokenAmountOut),
        fp(swapAmountOut)
      )
      const expected = calcExitSwapROpt(
        excessTokenBalance,
        excessTokenAmountOut,
        swapAmountOut
      )
      expectRelativeErrorBN(actual, fp(expected), tolerance)
    });

  });

});

