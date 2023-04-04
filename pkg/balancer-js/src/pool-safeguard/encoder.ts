import { defaultAbiCoder } from '@ethersproject/abi';
import { BigNumberish } from '@ethersproject/bignumber';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { stringify } from 'querystring';
import { signSwapData, signJoinExactTokensData, signExitExactTokensData } from './SafeguardPoolSigner';
import { SafeguardPoolSwapKind, SafeguardPoolJoinKind, SafeguardPoolExitKind } from './kinds';

export class SafeguardPoolEncoder {
  /**
   * Cannot be constructed.
   */
  private constructor() {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
  }

  /**
   * Encodes the userData parameter for providing the initial liquidity to a WeightedPool
   * @param initialBalances - the amounts of tokens to send to the pool to form the initial balances
   */
  static joinInit = (amountsIn: BigNumberish[]): string =>
    defaultAbiCoder.encode(['uint256', 'uint256[]'], [SafeguardPoolJoinKind.INIT, amountsIn]);

  /**
   * Encodes the userData parameter for joining a WeightedPool proportionally to receive an exact amount of BPT
   * @param bptAmountOut - the amount of BPT to be minted
   */
  static joinAllTokensInForExactBPTOut = (bptAmountOut: BigNumberish): string => {   
    
    return defaultAbiCoder.encode(
        ['uint256', 'uint256'],
        [SafeguardPoolJoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT, bptAmountOut]
    );

  }
   
  /**
   * Encodes the userData parameter for joining a WeightedPool with exact token inputs
   * @param amountsIn - the amounts each of token to deposit in the pool as liquidity
   * @param minimumBPT - the minimum acceptable BPT to receive in return for deposited tokens
   */
  static async joinExactTokensInForBPTOut
    (
      chainId: number,
      contractAddress: string,
      sender: string,
      recipient: string,
      deadline: BigNumberish,
      minBptAmountOut: BigNumberish,
      amountsIn: BigNumberish[],
      swapTokenIn: string,
      maxSwapAmount: BigNumberish,
      quoteRelativePrice: BigNumberish,
      maxBalanceChangeTolerance: BigNumberish,
      quoteBalanceIn: BigNumberish,
      quoteBalanceOut: BigNumberish,
      balanceBasedSlippage: BigNumberish,
      timeBasedSlippageSlope: BigNumberish,
      startTime: BigNumberish,
      signer: SignerWithAddress
    ): Promise<string>
  {

    let swapData: string = defaultAbiCoder.encode(
      ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
      [maxSwapAmount, quoteRelativePrice, maxBalanceChangeTolerance, quoteBalanceIn,
        quoteBalanceOut, balanceBasedSlippage, timeBasedSlippageSlope, startTime]
    );

    let joinData: string = defaultAbiCoder.encode(
      ['uint256', 'uint256[]', 'address', 'bytes'],
      [minBptAmountOut, amountsIn, swapTokenIn, swapData]
    );
    
    let signature: string = await signJoinExactTokensData(
      chainId,
      contractAddress,
      sender,
      recipient,
      deadline,
      joinData,
      signer
    );

    let signedJoinData: string = defaultAbiCoder.encode(
      ['uint8', 'uint256', 'bytes', 'bytes'],
      [SafeguardPoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, deadline, joinData, signature]
    );

    return signedJoinData;
  }

  static async exitBPTInForExactTokensOut
    (
      chainId: number,
      contractAddress: string,
      sender: string,
      recipient: string,
      deadline: BigNumberish,
      maxBptAmountIn: BigNumberish,
      amountsOut: BigNumberish[],
      swapTokenIn: string,
      maxSwapAmount: BigNumberish,
      quoteRelativePrice: BigNumberish,
      maxBalanceChangeTolerance: BigNumberish,
      quoteBalanceIn: BigNumberish,
      quoteBalanceOut: BigNumberish,
      balanceBasedSlippage: BigNumberish,
      timeBasedSlippageSlope: BigNumberish,
      startTime: BigNumberish,
      signer: SignerWithAddress
    ): Promise<string>
  {

    let swapData: string = defaultAbiCoder.encode(
      ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
      [maxSwapAmount, quoteRelativePrice, maxBalanceChangeTolerance, quoteBalanceIn,
        quoteBalanceOut, balanceBasedSlippage, timeBasedSlippageSlope, startTime]
    );
    
    let exitData: string = defaultAbiCoder.encode(
      ['uint256', 'uint256[]', 'address', 'bytes'],
      [maxBptAmountIn, amountsOut, swapTokenIn, swapData]
    );

    let signature: string = await signExitExactTokensData(
      chainId,
      contractAddress,
      sender,
      recipient,
      deadline,
      exitData,
      signer
    );

    let signedExitData: string = defaultAbiCoder.encode(
      ['uint8', 'uint256', 'bytes', 'bytes'],
      [SafeguardPoolExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT, deadline, exitData, signature]
    );

    return signedExitData;
  }

  static async swap
  (
    chainId: number,
    contractAddress: string,
    kind: SafeguardPoolSwapKind,
    tokenIn: string,
    tokenOut: string,
    sender: string,
    recipient: string,
    deadline: BigNumberish,
    maxSwapAmount: BigNumberish,
    quoteRelativePrice: BigNumberish,
    maxBalanceChangeTolerance: BigNumberish,
    quoteBalanceIn: BigNumberish,
    quoteBalanceOut:BigNumberish,
    balanceBasedSlippage: BigNumberish,
    timeBasedSlippageSlope: BigNumberish,
    startTime: BigNumberish,
    signer: SignerWithAddress
  ): Promise<string>
{

  let swapData: string = defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
    [maxSwapAmount, quoteRelativePrice, maxBalanceChangeTolerance, quoteBalanceIn,
      quoteBalanceOut, balanceBasedSlippage, timeBasedSlippageSlope, startTime]
  );

  let signature: string = await signSwapData(
    chainId,
    contractAddress,
    kind,
    tokenIn,
    tokenOut,
    sender,
    recipient,
    deadline,
    swapData,   
    signer
  );

  return defaultAbiCoder.encode(
    ['uint256', 'bytes', 'bytes'],
    [deadline, swapData, signature]
  );

}


  /**
   * Encodes the userData parameter for exiting a WeightedPool by removing a single token in return for an exact amount of BPT
   * @param bptAmountIn - the amount of BPT to be burned
   * @param enterTokenIndex - the index of the token to removed from the pool
   */
  // static exitExactBPTInForOneTokenOut = (bptAmountIn: BigNumberish, exitTokenIndex: number): string =>
  //   defaultAbiCoder.encode(
  //     ['uint256', 'uint256', 'uint256'],
  //     [SafeguardPoolExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, bptAmountIn, exitTokenIndex]
  //   );

  /**
   * Encodes the userData parameter for exiting a WeightedPool by removing tokens in return for an exact amount of BPT
   * @param bptAmountIn - the amount of BPT to be burned
   */
  static exitExactBPTInForTokensOut = (bptAmountIn: BigNumberish): string =>
    defaultAbiCoder.encode(['uint256', 'uint256'], [SafeguardPoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptAmountIn]);

  /**
   * Encodes the userData parameter for exiting a WeightedPool by removing exact amounts of tokens
   * @param amountsOut - the amounts of each token to be withdrawn from the pool
   * @param maxBPTAmountIn - the minimum acceptable BPT to burn in return for withdrawn tokens
   */
  // static exitBPTInForExactTokensOut = (amountsOut: BigNumberish[], maxBPTAmountIn: BigNumberish): string =>
  //   defaultAbiCoder.encode(
  //     ['uint256', 'uint256[]', 'uint256'],
  //     [SafeguardPoolExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT, amountsOut, maxBPTAmountIn]
  //   );
}

export class ManagedPoolEncoder {
  /**
   * Cannot be constructed.
   */
  private constructor() {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
  }

  /**
   * Encodes the userData parameter for exiting a ManagedPool to remove a token.
   * This can only be done by the pool owner.
   */
  // static exitForRemoveToken = (tokenIndex: BigNumberish): string =>
  //   defaultAbiCoder.encode(['uint256', 'uint256'], [SafeguardPoolExitKind.REMOVE_TOKEN, tokenIndex]);
}
