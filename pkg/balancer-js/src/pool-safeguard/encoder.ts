import { defaultAbiCoder } from '@ethersproject/abi';
import { BigNumberish, BigNumber } from '@ethersproject/bignumber';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { signSwapData, signAllowlist } from './SafeguardPoolSigner';
import { SafeguardPoolSwapKind, SafeguardPoolJoinKind, SafeguardPoolExitKind } from './kinds';
import { MaxUint256 } from '@ethersproject/constants';

const MaxUint128 = BigNumber.from("0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff")

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
  
  static async allowlist
    (
      chainId: number,
      contractAddress: string,
      sender: string,
      deadline: BigNumberish,
      userData: string,
      signer: SignerWithAddress
    ) : Promise<string>
  {
    const signature = await signAllowlist(chainId, contractAddress, sender, deadline, signer);

    const newUserData: string = defaultAbiCoder.encode(
      ['uint256', 'bytes', 'bytes'],
      [deadline, signature, userData]
    );

    return newUserData;
  }

  /**
   * Encodes the userData parameter for joining a WeightedPool with exact token inputs
   * @param amountsIn - the amounts each of token to deposit in the pool as liquidity
   * @param minimumBPT - the minimum acceptable BPT to receive in return for deposited tokens
   */
  static async joinExitSwap
    (
      chainId: number,
      contractAddress: string,
      sender: string,
      recipient: string,
      deadline: BigNumberish,
      joinExitKind: SafeguardPoolJoinKind | SafeguardPoolExitKind,
      limitBptAmount: BigNumberish,
      joinExitAmounts: BigNumberish[],
      isTokenInToken0: boolean,
      expectedOrigin: string,
      maxSwapAmount: BigNumberish,
      quoteAmountInPerOut: BigNumberish,
      maxBalanceChangeTolerance: BigNumberish,
      quoteBalanceIn: BigNumberish,
      quoteBalanceOut: BigNumberish,
      balanceBasedSlippage: BigNumberish,
      startTime: BigNumberish,
      timeBasedSlippage: BigNumberish,
      originBasedSlippage: BigNumberish,
      quoteIndex: BigNumberish,
      signer: SignerWithAddress
    ): Promise<string>
  {

    let swapData: string = this.encodeSwapData(
      expectedOrigin,
      maxSwapAmount,
      quoteAmountInPerOut,
      maxBalanceChangeTolerance,
      quoteBalanceIn,
      quoteBalanceOut,
      balanceBasedSlippage,
      startTime,
      timeBasedSlippage,
      originBasedSlippage
    );

    let signature: string = await signSwapData(
      chainId,
      contractAddress,
      SafeguardPoolSwapKind.GIVEN_IN,
      isTokenInToken0,
      sender,
      recipient,
      swapData,
      quoteIndex,
      deadline,
      signer
    );

    let signedJoinExiSwapData: string = defaultAbiCoder.encode(
      ['uint8', 'uint256', 'uint256[]', 'bool', 'bytes', 'bytes', 'uint256', 'uint256'],
      [joinExitKind, limitBptAmount, joinExitAmounts, isTokenInToken0, swapData, signature, quoteIndex, deadline]
    );

    return signedJoinExiSwapData;
  }

  static async swap
  (
    chainId: number,
    contractAddress: string,
    kind: SafeguardPoolSwapKind,
    isTokenInToken0: boolean,
    sender: string,
    recipient: string,
    deadline: BigNumberish,
    expectedOrigin: string,
    maxSwapAmount: BigNumberish,
    quoteAmountInPerOut: BigNumberish,
    maxBalanceChangeTolerance: BigNumberish,  //  60 bits
    quoteBalanceIn: BigNumberish,
    quoteBalanceOut:BigNumberish,
    balanceBasedSlippage: BigNumberish,
    startTime: BigNumberish,
    timeBasedSlippage: BigNumberish,
    originBasedSlippage: BigNumberish,
    quoteIndex: BigNumberish,                 
    signer: SignerWithAddress
  ): Promise<string>
  {
    let swapData: string = this.encodeSwapData(
      expectedOrigin,
      maxSwapAmount,
      quoteAmountInPerOut,
      maxBalanceChangeTolerance,
      quoteBalanceIn,
      quoteBalanceOut,
      balanceBasedSlippage,
      startTime,
      timeBasedSlippage,
      originBasedSlippage
    );
    let signature: string = await signSwapData(
      chainId,
      contractAddress,
      kind,
      isTokenInToken0,
      sender,
      recipient,
      swapData,
      quoteIndex,
      deadline,
      signer
    );
    const userData = defaultAbiCoder.encode(
      ['bytes', 'bytes', 'uint256', 'uint256'],
      [swapData, signature, quoteIndex, deadline]
    );
    return userData;
  }

  static encodeSwapData(
      expectedOrigin: string,
      maxSwapAmount: BigNumberish,
      quoteAmountInPerOut: BigNumberish,
      maxBalanceChangeTolerance: BigNumberish,
      quoteBalanceIn: BigNumberish,
      quoteBalanceOut:BigNumberish,
      balanceBasedSlippage: BigNumberish,
      startTime: BigNumberish,
      timeBasedSlippage: BigNumberish,
      originBasedSlippage: BigNumberish
    ) {

    const priceBasedParams = this.packIn256Bits(quoteAmountInPerOut, this.fitIn128bits(maxSwapAmount))
    const quoteBalances = this.packIn256Bits(quoteBalanceIn, quoteBalanceOut)
    const balanceBasedParams = this.packIn256Bits(this.fitIn128bits(maxBalanceChangeTolerance), balanceBasedSlippage)
    const timeBasedParams = this.packIn256Bits(this.fitIn128bits(startTime), timeBasedSlippage)

    return defaultAbiCoder.encode(
      ['address','uint256','uint256','uint256','uint256','uint256'],
      [
        expectedOrigin, // expected origin
        originBasedSlippage, // origin slope
        priceBasedParams, // relative price + maxSwapAmount
        quoteBalances, // quote balanceIn + Out
        balanceBasedParams, // maxBalanceTolerance + balance slope
        timeBasedParams // startTime + time slope
      ]
    );
  }

  static fitIn128bits(a: BigNumberish): BigNumberish {
    if(BigNumber.from(a).eq(MaxUint256)) {
      return MaxUint128;
    }
    return a;
  }

  /**
   * Packs two numbers into 256 bits
   */
  static packIn256Bits(a: BigNumberish, b: BigNumberish): BigNumberish {
    let aBN = BigNumber.from(a);
    let bBN = BigNumber.from(b);

    if(aBN.gt(MaxUint128)) {
      throw "Input 'a' too big"
    }

    if(bBN.gt(MaxUint128)) {
      throw "Input 'b' too big"
    }
  
    return ((aBN.shl(128)).or(bBN));
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
