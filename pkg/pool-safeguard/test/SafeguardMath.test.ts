import '@balancer-labs/v2-common/setupTests'
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { calcYearlyRate, calcAccumulatedManagementFees } from '@balancer-labs/v2-helpers/src/models/pools/safeguard/math'
import { expect } from 'chai';
import { DAY } from '@balancer-labs/v2-helpers/src/time';

describe('SafeguardMath', () => {
  let lib: Contract;

  const tolerance = fp(1e-9);

  const rawRateNumber = 3 / 100

  sharedBeforeEach('deploy lib', async () => {
    lib = await deploy('TestSafeguardMath', { args: [] });
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
      expect(fp(actual / expected - 1).abs()).to.be.lessThan(tolerance)
    });
  });

  it ('calcYearlyRate', async () => {
    const expected = fp(calcYearlyRate(rawRateNumber))
    const actual = await lib.calcYearlyRate(fp(rawRateNumber))
    expect(actual.div(expected).sub(fp(1))).to.be.lessThan(tolerance)
  });

  it ('calcAccumulatedManagementFees', async () => {
    const elapsedTimeNumber = Math.round(365 * DAY)
    const yearlyRateNumber = calcYearlyRate(rawRateNumber)
    const currentSupplyNumber = 99
    const expected = fp(
      calcAccumulatedManagementFees(
        elapsedTimeNumber,
        yearlyRateNumber,
        currentSupplyNumber
      )
    )
    console.log("expected:", expected.toString())
    console.log("yearlyRateNumber:", yearlyRateNumber.toString())
    console.log("elapsedTimeNumber:", elapsedTimeNumber.toString())

    const actual = await lib.calcAccumulatedManagementFees(
      elapsedTimeNumber,
      fp(yearlyRateNumber),
      fp(currentSupplyNumber)
    )
    console.log("actual:", actual.toString())
    console.log("((actual.mul(fp(1)).div(expected)).sub(fp(1))).abs():", ((actual.mul(fp(1)).div(expected)).sub(fp(1))).abs().toString())
    expect(((actual.mul(fp(1)).div(expected)).sub(fp(1))).abs()).to.be.lessThan(tolerance)
  });

});

