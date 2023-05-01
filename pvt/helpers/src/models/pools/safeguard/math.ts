import { Decimal } from 'decimal.js';
import { BigNumberish, decimal, fp, fromFp } from '../../../numbers';
import { fromBNish, toBNish } from './helpers';

const dONE = new Decimal(1);

export function calcPerformance(
  bnBalances: BigNumberish[],
  bnPerfBalances: BigNumberish[],
  bnDecimals: number[],
  prices: Decimal[]
): Decimal {

  const previousTVL = calcTVL(
    bnPerfBalances,
    bnDecimals,
    prices
  );
  
  const currentTVL = calcTVL(
    bnBalances,
    bnDecimals,
    prices
  );

  return currentTVL.div(previousTVL)
}

export function calcTVL(
  bnBalances: BigNumberish[],
  decimals: number[], 
  prices: Decimal[]
  ): Decimal {
  let tvl = decimal(0);
  for(let i = 0; i < bnBalances.length; i++){
    tvl = tvl.add(prices[i].mul(fromBNish(bnBalances[i], decimals[i])));
  }
  return tvl;
}

// For two tokens only
export function calcBptOutGivenAllTokensIn(
  bnBalances: BigNumberish[],
  bnAmountsIn: BigNumberish[],
  decimals: number[],
  prices: Decimal[],
  fpSlippage: BigNumberish,
  fpProtocolFees: BigNumberish,
  fpTotalSupply: BigNumberish
): BigNumberish {

  const balance1 = fromBNish(bnBalances[0], decimals[0]);
  const balance2 = fromBNish(bnBalances[1], decimals[1]);
  const amountIn1 = fromBNish(bnAmountsIn[0], decimals[0]);
  const amountIn2 = fromBNish(bnAmountsIn[1], decimals[1]);
  const slippage = fromFp(fpSlippage);
  const protocolFees = fromFp(fpProtocolFees);
  const totalSupply = fromFp(fpTotalSupply);

  const r1 = amountIn1.div(balance1);
  const r2 = amountIn2.div(balance2);

  let sa1, sa2;

  if (r1 > r2) {
      let relativePrice = prices[1].div(prices[0]); // TODO apply dynfees/ slippage to relative price

      let num = Decimal.sub(
          balance2.mul(amountIn1.div(balance1)),
          amountIn2
      );

      let denom = dONE.add(
          balance2.mul(
              relativePrice.div(balance1)
          )
      );

      sa2 = num.div(denom);
      sa1 = sa2.mul(relativePrice);
  } else {
      let relativePrice = prices[0].div(prices[1]); // TODO apply dynfees/ slippage to relative price
      let num = (amountIn1.sub(balance1.mul(amountIn2.div(balance2))));
      let denom = dONE.add(balance1.mul(relativePrice.div(balance2)));
      sa1 = num.div(denom);
      sa2 = sa1.mul(relativePrice);
  }

  let rOpt = Decimal.min(
      (amountIn1.sub(sa1)).div(balance1),
      (amountIn2.add(sa2)).div(balance2)
  )

  return fp(rOpt.mul(totalSupply));
}

export function calcYearlyRate(yearlyFees: number): number {
  const logInput = 1 - yearlyFees;
  const logResult = Math.log(logInput)
  return -logResult / (365 * 24 * 3600);
}

export function calcAccumulatedManagementFees(
    elapsedTime: number,
    yearlyRate: number,
    currentSupply: number
): number {
    const expInput = yearlyRate * elapsedTime;
    const expResult = Math.exp(expInput);
    return (currentSupply * (expResult - 1));
}

export function calcTimeSlippagePenalty(
  currentTimestamp: number,
  startTime: number,
  timeBasedSlippage: number
): number  {
  if(currentTimestamp <= startTime) {
      return 0;
  }
  return timeBasedSlippage * (currentTimestamp - startTime)
}

export function calcJoinSwapAmounts(
  excessTokenBalance: number,
  limitTokenBalance: number,
  excessTokenAmountIn: number,
  limitTokenAmountIn: number,
  quoteAmountInPerOut: number
): [number, number] {
  const foo = excessTokenAmountIn * limitTokenBalance
  const bar = limitTokenAmountIn * excessTokenBalance
  if (foo < bar) {
    throw "error: wrong tokenIn in excess"
  }
  const num = foo - bar;
  const denom = limitTokenBalance + limitTokenAmountIn + (excessTokenBalance + excessTokenAmountIn) / quoteAmountInPerOut
  const swapAmountIn = num / denom
  const swapAmountOut = swapAmountIn / quoteAmountInPerOut
  return [swapAmountIn, swapAmountOut]
}

export function calcJoinSwapROpt(
  excessTokenBalance: number,
  excessTokenAmountIn: number,
  swapAmountIn: number
): number {
  const num = excessTokenAmountIn - swapAmountIn
  const denom = excessTokenBalance + swapAmountIn
  return num / denom
}

export function calcExitSwapAmounts(
  excessTokenBalance: number,
  limitTokenBalance: number,
  excessTokenAmountOut: number,
  limitTokenAmountOut: number,
  quoteAmountInPerOut: number,
): [number, number] {

  const foo = excessTokenAmountOut * limitTokenBalance
  const bar = limitTokenAmountOut * excessTokenBalance
  if (foo < bar) {
    throw "error: wrong tokenOut in excess"
  }
  const num = foo - bar
  const denom = limitTokenBalance - limitTokenAmountOut + (excessTokenBalance - excessTokenAmountOut) * quoteAmountInPerOut
  const swapAmountOut = num / denom
  const swapAmountIn = quoteAmountInPerOut * swapAmountOut
  return [swapAmountIn, swapAmountOut]
}

export function calcExitSwapROpt(
  excessTokenBalance: number,
  excessTokenAmountOut: number,
  swapAmountOut: number
): number {
  const num = excessTokenAmountOut - swapAmountOut
  const denom = excessTokenBalance - swapAmountOut
  return num / denom
}