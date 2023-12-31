import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractFunction, ContractReceipt, ContractTransaction } from 'ethers';
import { BigNumberish, bn, fp, fpMul, fpDiv } from '../../../numbers';
import { MAX_INT256, MAX_UINT112, MAX_UINT256, ZERO_ADDRESS } from '../../../constants';
import * as expectEvent from '../../../test/expectEvent';
import Vault from '../../vault/Vault';
import TokenList from '../../tokens/TokenList';
import TypesConverter from '../../types/TypesConverter';
import SafeguardPoolDeployer from './SafeguardPoolDeployer';
import { MinimalSwap } from '../../vault/types';
import {
  JoinExitSafeguardPool,
  InitSafeguardPool,
  JoinGivenInSafeguardPool,
  // JoinGivenOutSafeguardPool,
  JoinAllGivenOutSafeguardPool,
  JoinResult,
  RawSafeguardPoolDeployment,
  ExitResult,
  SwapResult,
  // SingleExitGivenInSafeguardPool,
  MultiExitGivenInSafeguardPool,
  ExitGivenOutSafeguardPool,
  SwapSafeguardPool,
  ExitQueryResult,
  JoinQueryResult,
  PoolQueryResult,
  OracleParams,
} from './types';
import { signSwapData } from '@swaap-labs/v2-swaap-js/src/safeguard-pool/SafeguardPoolSigner';
import Oracle from "../../oracles/Oracle";

import {

} from './math';

import { SafeguardPoolExitKind, SafeguardPoolJoinKind, SafeguardPoolEncoder } from '@swaap-labs/v2-swaap-js';
import { SwapKind } from '@balancer-labs/balancer-js';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import BasePool from '../base/BasePool';
import { fromBNish } from './helpers';
import { parseUnits } from 'ethers/lib/utils';
import { get } from 'lodash';

const MAX_IN_RATIO = fp(0.3);
const MAX_OUT_RATIO = fp(0.3);

export default class SafeguardPool extends BasePool {
  oracles: Oracle[];
  assetManagers: string[];
  pauseWindowDuration: BigNumberish;
  bufferPeriodDuration: BigNumberish;
  quoteIndex: BigNumber = fp(0);

  static async create(params: RawSafeguardPoolDeployment): Promise<SafeguardPool> {
    return SafeguardPoolDeployer.deploy(params);
  }

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    oracles: Oracle[],
    assetManagers: string[],
    pauseWindowDuration: BigNumberish,
    bufferPeriodDuration: BigNumberish,
    owner?: SignerWithAddress
  ) {
    super(instance, poolId, vault, tokens, 0, owner);

    this.oracles = oracles;
    this.assetManagers = assetManagers;
    this.pauseWindowDuration = pauseWindowDuration;
    this.bufferPeriodDuration = bufferPeriodDuration;
  }

  async getLastPostJoinExitInvariant(): Promise<BigNumber> {
    return this.instance.getLastPostJoinExitInvariant();
  }

  async getMaxIn(tokenIndex: number, currentBalances?: BigNumber[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    return fpMul(currentBalances[tokenIndex], MAX_IN_RATIO);
  }

  async getMaxOut(tokenIndex: number, currentBalances?: BigNumber[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    return fpMul(currentBalances[tokenIndex], MAX_OUT_RATIO);
  }

  async getJoinExitEnabled(from: SignerWithAddress): Promise<boolean> {
    return this.instance.connect(from).getJoinExitEnabled();
  }

  async getSwapEnabled(from: SignerWithAddress): Promise<boolean> {
    return this.instance.connect(from).getSwapEnabled();
  }

  async version(): Promise<string[]> {
    return this.instance.version();
  }

  async swapGivenIn(params: SwapSafeguardPool): Promise<SwapResult> {
    return this.swap(await this._buildSwapParams(SwapKind.GivenIn, params));
  }

  async swapGivenOut(params: SwapSafeguardPool): Promise<SwapResult> {
    return this.swap(await this._buildSwapParams(SwapKind.GivenOut, params));
  }

  async updateProtocolFeePercentageCache(): Promise<ContractTransaction> {
    return this.instance.updateProtocolFeePercentageCache();
  }

  async swap(params: MinimalSwap): Promise<SwapResult> {
    let receipt: ContractReceipt;
    if (this.vault.mocked) {
      const tx = await this.vault.minimalSwap(params);
      receipt = await tx.wait();
    } else {
      if (!params.from) throw new Error('No signer provided');
      const tx = await this.vault.instance.connect(params.from).swap(
        {
          poolId: params.poolId,
          kind: params.kind,
          assetIn: params.tokenIn,
          assetOut: params.tokenOut,
          amount: params.amount,
          userData: params.data,
        },
        {
          sender: TypesConverter.toAddress(params.from),
          recipient: TypesConverter.toAddress(params.to) ?? ZERO_ADDRESS,
          fromInternalBalance: false,
          toInternalBalance: false,
        },
        params.kind == 0 ? 0 : MAX_UINT256,
        MAX_UINT256
      );
      receipt = await tx.wait();
    }
    const { amountIn, amountOut } = expectEvent.inReceipt(receipt, 'Swap').args;
    const amount = params.kind == SwapKind.GivenIn ? amountOut : amountIn;

    return { amount, receipt };
  }

  async init(params: InitSafeguardPool): Promise<JoinResult> {
    return this.join(await this._buildInitParams(params));
  }

  async joinGivenIn(params: JoinGivenInSafeguardPool): Promise<JoinResult> {
    return this.join(await this._buildJoinGivenInParams(params));
  }

  async queryJoinGivenIn(params: JoinGivenInSafeguardPool): Promise<JoinQueryResult> {
    return this.queryJoin(await this._buildJoinGivenInParams(params));
  }

  async joinAllGivenOut(params: JoinAllGivenOutSafeguardPool): Promise<JoinResult> {
    return this.join(await this._buildJoinAllGivenOutParams(params));
  }

  async queryJoinAllGivenOut(params: JoinAllGivenOutSafeguardPool): Promise<JoinQueryResult> {
    return this.queryJoin(await this._buildJoinAllGivenOutParams(params));
  }

  async exitGivenOut(params: ExitGivenOutSafeguardPool): Promise<ExitResult> {
    return this.exit(await this._buildExitGivenOutParams(params));
  }

  async queryExitGivenOut(params: ExitGivenOutSafeguardPool): Promise<ExitQueryResult> {
    return this.queryExit(await this._buildExitGivenOutParams(params));
  }

  async multiExitGivenIn(params: MultiExitGivenInSafeguardPool): Promise<ExitResult> {
    return this.exit(this._buildMultiExitGivenInParams(params));
  }

  async queryMultiExitGivenIn(params: MultiExitGivenInSafeguardPool): Promise<ExitQueryResult> {
    return this.queryExit(this._buildMultiExitGivenInParams(params));
  }

  async queryJoin(params: JoinExitSafeguardPool): Promise<JoinQueryResult> {
    const fn = this.instance.queryJoin;
    return (await this._executeQuery(params, fn)) as JoinQueryResult;
  }

  async join(params: JoinExitSafeguardPool): Promise<JoinResult> {
    const currentBalances = params.currentBalances || (await this.getBalances());
    const to = params.recipient ? TypesConverter.toAddress(params.recipient) : params.from?.address ?? ZERO_ADDRESS;
    const { tokens } = await this.getTokens();

    const tx = await this.vault.joinPool({
      poolAddress: this.address,
      poolId: this.poolId,
      recipient: to,
      currentBalances,
      tokens,
      lastChangeBlock: params.lastChangeBlock ?? 0,
      protocolFeePercentage: params.protocolFeePercentage ?? 0,
      data: params.data ?? '0x',
      from: params.from,
    });

    const receipt = await tx.wait();
    const { deltas, protocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    return { amountsIn: deltas, dueProtocolFeeAmounts: protocolFeeAmounts, receipt };
  }

  async queryExit(params: JoinExitSafeguardPool): Promise<ExitQueryResult> {
    const fn = this.instance.queryExit;
    return (await this._executeQuery(params, fn)) as ExitQueryResult;
  }

  async exit(params: JoinExitSafeguardPool): Promise<ExitResult> {
    const currentBalances = params.currentBalances || (await this.getBalances());
    const to = params.recipient ? TypesConverter.toAddress(params.recipient) : params.from?.address ?? ZERO_ADDRESS;
    const { tokens } = await this.getTokens();

    const tx = await this.vault.exitPool({
      poolAddress: this.address,
      poolId: this.poolId,
      recipient: to,
      currentBalances,
      tokens,
      lastChangeBlock: params.lastChangeBlock ?? 0,
      protocolFeePercentage: params.protocolFeePercentage ?? 0,
      data: params.data ?? '0x',
      from: params.from,
    });

    const receipt = await tx.wait();
    const { deltas, protocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    return { amountsOut: deltas.map((x: BigNumber) => x.mul(-1)), dueProtocolFeeAmounts: protocolFeeAmounts, receipt };
  }

  private async _executeQuery(params: JoinExitSafeguardPool, fn: ContractFunction): Promise<PoolQueryResult> {
    const currentBalances = params.currentBalances || (await this.getBalances());
    const to = params.recipient ? TypesConverter.toAddress(params.recipient) : params.from?.address ?? ZERO_ADDRESS;

    return fn(
      this.poolId,
      params.from?.address || ZERO_ADDRESS,
      to,
      currentBalances,
      params.lastChangeBlock ?? 0,
      params.protocolFeePercentage ?? 0,
      params.data ?? '0x'
    );
  }

  /*
  * amountInPerOut = priceOut / priceIn | = amountIn / amountOut
  */
  async getAmountInPerOut(tokenIn: string | number): Promise<BigNumberish> {
    
    const tokens = (await this.getTokens()).tokens;
    const tokenInIndex = typeof tokenIn == "number"? tokenIn : tokens.findIndex((token) => token == tokenIn);

    if (tokenInIndex != 0 && tokenInIndex != 1) {
      throw 'token not found in the pool';
    }

    const oracleIn = this.oracles[tokenInIndex]
    let priceIn = fromBNish(await oracleIn.latestAnswer(), oracleIn.decimals);

    const oracleOut = this.oracles[tokenInIndex == 0? 1 : 0];
    let priceOut = fromBNish(await oracleOut.latestAnswer(), oracleOut.decimals);

    const amountInPerOut = fp(priceOut.div(priceIn));

    return amountInPerOut;
  }

  private async _buildSwapParams(kind: number, params: SwapSafeguardPool): Promise<MinimalSwap> {
    const currentBalances = await this.getBalances();
    const { tokens } = await this.vault.getPoolTokens(this.poolId);
    const tokenIn = typeof params.in === 'number' ? tokens[params.in] : params.in.address;
    const tokenOut = typeof params.out === 'number' ? tokens[params.out] : params.out.address;
    const sender = params.from? TypesConverter.toAddress(params.from) : await this._defaultSenderAddress();
    const recipient = params.recipient ?? ZERO_ADDRESS;
    const deadline = params.deadline?? MAX_UINT256;
    const expectedOrigin = params.expectedOrigin?? sender;
    const quoteAmountInPerOut = params.quoteAmountInPerOut?? await this.getAmountInPerOut(tokenIn);
    const maxSwapAmount = params.maxSwapAmount?? this._getMaxSwapAmount(kind, tokenIn, params.amount, quoteAmountInPerOut);
    const maxBalanceChangeTolerance = params.maxBalanceChangeTolerance?? MAX_UINT256;
    const quoteBalanceIn = params.quoteBalanceIn?? (tokenIn == tokens[0]? currentBalances[0] : currentBalances[1]);
    const quoteBalanceOut = params.quoteBalanceOut?? (tokenOut == tokens[0]? currentBalances[0] : currentBalances[1]);
    const quoteTotalSupply = params.quoteTotalSupply?? await this.instance.totalSupply();
    const balanceBasedSlippage = params.balanceBasedSlippage?? 0;
    const startTime = params.startTime?? MAX_UINT256;
    const timeBasedSlippage = params.timeBasedSlippage?? 0;
    const originBasedSlippage = params.originBasedSlippage?? 0;
    const quoteIndex = params.quoteIndex?? this.newQuoteIndex();

    const data = await SafeguardPoolEncoder.swap(
      params.chainId,
      this.address,
      kind,
      tokenIn == tokens[0],
      sender,
      recipient,
      deadline,
      expectedOrigin,
      maxSwapAmount,
      quoteAmountInPerOut,
      maxBalanceChangeTolerance,
      quoteBalanceIn,
      quoteBalanceOut,
      quoteTotalSupply,
      balanceBasedSlippage,
      startTime,
      timeBasedSlippage,
      originBasedSlippage,
      quoteIndex,
      params.signer
    )
    return {
      kind,
      poolAddress: this.address,
      poolId: this.poolId,
      from: params.from,
      to: recipient,
      tokenIn: tokenIn ?? ZERO_ADDRESS,
      tokenOut: tokenOut ?? ZERO_ADDRESS,
      balanceTokenIn: currentBalances[tokens.indexOf(tokenIn)] || bn(0),
      balanceTokenOut: currentBalances[tokens.indexOf(tokenOut)] || bn(0),
      lastChangeBlock: params.lastChangeBlock ?? 0,
      data: data,
      amount: params.amount,
    };
  }

  private _getMaxSwapAmount(
    kind: number,
    tokenIn: string,
    amount: BigNumberish,
    amountInPerOut: BigNumberish
  ): BigNumber {

    // get tokenIn index
    const tokens = this.tokens.tokens;
    const tokenInIndex = typeof tokenIn == "number"? tokenIn : tokens.findIndex((token) => token.address == tokenIn);
    const tokenOutIndex = tokenInIndex == 0? 1 : 0;

    if (kind == SwapKind.GivenIn) {
      return parseUnits(amount.toString(), 18-tokens[tokenInIndex].decimals).mul(11).div(10);
    } else {
      return parseUnits(amount.toString(), 18-tokens[tokenOutIndex].decimals).mul(11).div(10);
    }

  }

  async buildSwapDecodedUserData(kind: number, params: SwapSafeguardPool): Promise<[string, string, BigNumberish, BigNumberish]> {
    const currentBalances = await this.getBalances();
    const { tokens } = await this.vault.getPoolTokens(this.poolId);
    const tokenIn = typeof params.in === 'number' ? tokens[params.in] : params.in.address;
    const tokenOut = typeof params.out === 'number' ? tokens[params.out] : params.out.address;
    const sender = params.from? TypesConverter.toAddress(params.from) : await this._defaultSenderAddress();
    const recipient = params.recipient ?? ZERO_ADDRESS;
    const deadline = params.deadline?? MAX_UINT256;
    const expectedOrigin = params.expectedOrigin?? sender;
    const quoteAmountInPerOut = params.quoteAmountInPerOut?? await this.getAmountInPerOut(tokenIn);
    const maxSwapAmount = params.maxSwapAmount?? this._getMaxSwapAmount(kind, tokenIn, params.amount, quoteAmountInPerOut);
    const maxBalanceChangeTolerance = params.maxBalanceChangeTolerance?? MAX_UINT256;
    const quoteBalanceIn = params.quoteBalanceIn?? (tokenIn == tokens[0]? currentBalances[0] : currentBalances[1]);
    const quoteBalanceOut = params.quoteBalanceOut?? (tokenOut == tokens[0]? currentBalances[0] : currentBalances[1]);
    const quoteTotalSupply = params.quoteTotalSupply?? await this.instance.totalSupply();
    const balanceBasedSlippage = params.balanceBasedSlippage?? 0;
    const startTime = params.startTime?? MAX_UINT256;
    const timeBasedSlippage = params.timeBasedSlippage?? 0;
    const originBasedSlippage = params.originBasedSlippage?? 0;
    const quoteIndex = params.quoteIndex?? this.newQuoteIndex();

    let swapData: string = SafeguardPoolEncoder.encodeSwapData(
      expectedOrigin,
      maxSwapAmount,
      quoteAmountInPerOut,
      maxBalanceChangeTolerance,
      quoteBalanceIn,
      quoteBalanceOut,
      quoteTotalSupply,
      balanceBasedSlippage,
      startTime,
      timeBasedSlippage,
      originBasedSlippage
    );

    let signature: string = await signSwapData(
      params.chainId,
      this.address,
      kind,
      tokenIn == tokens[0],
      sender,
      recipient,
      swapData,
      quoteIndex,
      deadline,
      params.signer
    );

    return [swapData, signature, quoteIndex, deadline];
  }

  private async _buildInitParams(params: InitSafeguardPool): Promise<JoinExitSafeguardPool> {
    const { initialBalances: balances } = params;
    const amountsIn = Array.isArray(balances) ? balances : Array(this.tokens.length).fill(balances);
    let userData = await SafeguardPoolEncoder.joinInit(amountsIn);
    
    if(await this.instance.isAllowlistEnabled()) {
      const sender = params.from?? (await this.vault._defaultSender());

      userData = await SafeguardPoolEncoder.allowlist(
        params.chainId!,
        this.address,
        sender.address,
        params.deadline?? (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp + 100,
        userData,
        params.signer!
      );
    }

    return {
      from: params.from,
      recipient: params.recipient,
      protocolFeePercentage: params.protocolFeePercentage,
      data: userData,
    };
  };

  private async _buildJoinGivenInParams(params: JoinGivenInSafeguardPool): Promise<JoinExitSafeguardPool> {
    
    const { tokens } = await this.getTokens();
    const currentBalances = await this.getBalances();

    const contractAddress = this.address;
    const sender = params.from? TypesConverter.toAddress(params.from) : await this._defaultSenderAddress();
    const recipient = params.recipient ?? ZERO_ADDRESS;
    const chainId = params.chainId;
    const deadline = params.deadline  || MAX_UINT256;
    const minBptAmountOut = params.minBptAmountOut || 0;
    const amountsIn = Array.isArray(params.amountsIn) ? params.amountsIn : Array(this.tokens.length).fill(0);
    const swapTokenIn = typeof params.swapTokenIn === 'number' ? tokens[params.swapTokenIn] : params.swapTokenIn.address;
    const expectedOrigin = params.expectedOrigin?? sender;
    const quoteAmountInPerOut = params.quoteAmountInPerOut?? await this.getAmountInPerOut(swapTokenIn);
    const maxSwapAmount = params.maxSwapAmount?? 
      bn(await this._getSwapAmountJoinGivenIn(swapTokenIn, this._amountsTo18Decimals(currentBalances), amountsIn, quoteAmountInPerOut));
    const maxBalanceChangeTolerance = params.maxBalanceChangeTolerance?? MAX_UINT256;
    const quoteBalanceIn = params.quoteBalanceIn?? (swapTokenIn == tokens[0]? currentBalances[0] : currentBalances[1]);
    const quoteBalanceOut = params.quoteBalanceOut?? (swapTokenIn == tokens[0]? currentBalances[1] : currentBalances[0]);
    const quoteTotalSupply = params.quoteTotalSupply?? await this.instance.totalSupply();
    const balanceBasedSlippage = params.balanceBasedSlippage?? 0;
    const startTime = params.startTime?? MAX_UINT256;
    const timeBasedSlippage = params.timeBasedSlippage?? 0;
    const originBasedSlippage = params.originBasedSlippage?? 0;
    const quoteIndex = params.quoteIndex?? this.newQuoteIndex();
    const signer = params.signer;

    let userData = await SafeguardPoolEncoder.joinExitSwap(
      chainId,
      contractAddress,
      TypesConverter.toAddress(sender),
      recipient,
      deadline,
      SafeguardPoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT,
      minBptAmountOut,
      amountsIn,
      swapTokenIn == tokens[0],
      expectedOrigin,
      maxSwapAmount,
      quoteAmountInPerOut,
      maxBalanceChangeTolerance,
      quoteBalanceIn,
      quoteBalanceOut,
      quoteTotalSupply,
      balanceBasedSlippage,
      startTime,
      timeBasedSlippage,
      originBasedSlippage,
      quoteIndex,
      signer
    );

    if(await this.instance.isAllowlistEnabled()) {
      const sender = params.from?? (await this.vault._defaultSender());
      
      userData = await SafeguardPoolEncoder.allowlist(
        chainId,
        this.address,
        TypesConverter.toAddress(sender),
        params.allowlistDeadline?? (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp + 100,
        userData,
        signer
      );
    }

    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: userData
    };
  }

  private _amountsTo18Decimals(amounts: BigNumberish[]): BigNumber[] {
    const decimals = this.tokens.map((token) => token.decimals)
    return amounts.map((amount, index) =>  parseUnits(amount.toString(), 18-decimals[index]));
  }

  // estimates the amount of tokens to swap when joining with arbitrary amountsIn
  private async _getSwapAmountJoinGivenIn(
      tokenIn: string | number,
      currentBalances: BigNumber[],
      amountsIn: BigNumberish[],
      quoteAmountInPerOut: BigNumberish
    ): Promise<BigNumberish> {
      
      const tokens = (await this.getTokens()).tokens;
      const tokenInIndex = typeof tokenIn == "number"? tokenIn : tokens.findIndex((token) => token == tokenIn);
      const tokenOutIndex = tokenInIndex == 0? 1 : 0;

      const fpCurrentBalances = this._amountsTo18Decimals(currentBalances);

      const numerator = fpMul(amountsIn[tokenInIndex], fpCurrentBalances[tokenOutIndex]).sub(fpMul(amountsIn[tokenOutIndex], fpCurrentBalances[tokenInIndex]));

      const denom = bn(fpCurrentBalances[tokenOutIndex]).add(amountsIn[tokenOutIndex]).add(
        fpDiv(bn(fpCurrentBalances[tokenInIndex]).add(amountsIn[tokenInIndex]), quoteAmountInPerOut)
      );
        
      const maxSwapAmount = fpDiv(numerator, denom);

      return maxSwapAmount > BigNumber.from(0) ? maxSwapAmount.mul(11).div(10) : BigNumber.from(0);
  }

  private async _buildJoinAllGivenOutParams(params: JoinAllGivenOutSafeguardPool): Promise<JoinExitSafeguardPool> {
    
    let userData = await SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(params.bptOut);

    if(await this.instance.isAllowlistEnabled()) {
      const sender = params.from?? (await this.vault._defaultSender());

      userData = await SafeguardPoolEncoder.allowlist(
        params.chainId!,
        this.address,
        sender.address,
        params.deadline?? (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp + 100,
        userData,
        params.signer!
      );
    }

    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: userData,
    };
  }

  private async _buildExitGivenOutParams(params: ExitGivenOutSafeguardPool): Promise<JoinExitSafeguardPool> {

    const { tokens } = await this.getTokens();
    const currentBalances = await this.getBalances();

    const contractAddress = this.address;
    const sender = params.from? TypesConverter.toAddress(params.from) : await this._defaultSenderAddress();
    const recipient = params.recipient ?? ZERO_ADDRESS;
    const chainId = params.chainId;
    const deadline = params.deadline  || MAX_UINT256;
    const maxBptAmountIn = params.maxBptAmountIn || MAX_UINT256;
    const amountsOut = Array.isArray(params.amountsOut) ? params.amountsOut : Array(this.tokens.length).fill(params.amountsOut);
    const swapTokenIn = typeof params.swapTokenIn === 'number' ? tokens[params.swapTokenIn] : params.swapTokenIn.address;
    const expectedOrigin = params.expectedOrigin?? sender;
    const quoteAmountInPerOut = params.quoteAmountInPerOut?? await this.getAmountInPerOut(swapTokenIn);
    const maxSwapAmount = params.maxSwapAmount?? 
      bn(await this._getSwapAmountExitGivenOut(swapTokenIn, this._amountsTo18Decimals(currentBalances), amountsOut, quoteAmountInPerOut));
    const maxBalanceChangeTolerance = params.maxBalanceChangeTolerance?? MAX_UINT256;
    const quoteBalanceIn = params.quoteBalanceIn?? (swapTokenIn == tokens[0]? currentBalances[0] : currentBalances[1]);
    const quoteBalanceOut = params.quoteBalanceOut?? (swapTokenIn == tokens[0]? currentBalances[1] : currentBalances[0]);
    const quoteTotalSupply = params.quoteTotalSupply?? await this.instance.totalSupply();
    const balanceBasedSlippage = params.balanceBasedSlippage?? 0;
    const startTime = params.startTime?? MAX_UINT256;
    const timeBasedSlippage = params.timeBasedSlippage?? 0;
    const originBasedSlippage = params.originBasedSlippage?? 0;
    const quoteIndex = params.quoteIndex?? this.newQuoteIndex();
    const signer = params.signer;

    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: await SafeguardPoolEncoder.joinExitSwap(
        chainId,
        contractAddress,
        sender,
        recipient,
        deadline,
        SafeguardPoolExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT,
        maxBptAmountIn,
        amountsOut,
        swapTokenIn == tokens[0],
        expectedOrigin,
        maxSwapAmount,
        quoteAmountInPerOut,
        maxBalanceChangeTolerance,
        quoteBalanceIn,
        quoteBalanceOut,
        quoteTotalSupply,
        balanceBasedSlippage,
        startTime,
        timeBasedSlippage,
        originBasedSlippage,
        quoteIndex,
        signer
      ),
    };
  }

    // estimates the amount of tokens to swap when joining with arbitrary amountsIn
    private async _getSwapAmountExitGivenOut(
      tokenIn: string | number,
      currentBalances: BigNumber[], // should be in 18 decimals
      amountsOut: BigNumberish[], // should be in 18 decimals
      quoteAmountInPerOut: BigNumberish // should be in 18 decimals
    ): Promise<BigNumberish> {
      
      const tokens = (await this.getTokens()).tokens;
      const tokenInIndex = typeof tokenIn == "number"? tokenIn : tokens.findIndex((token) => token == tokenIn);
      const tokenOutIndex = tokenInIndex == 0? 1 : 0;

      const numerator = fpMul(amountsOut[tokenOutIndex], currentBalances[tokenInIndex]).sub(fpMul(amountsOut[tokenInIndex], currentBalances[tokenOutIndex]));

      const denom = bn(currentBalances[tokenOutIndex]).sub(amountsOut[tokenOutIndex]).add(
        fpMul(bn(currentBalances[tokenInIndex]).sub(amountsOut[tokenInIndex]), quoteAmountInPerOut)
      );
        
      const maxSwapAmount = fpDiv(numerator, denom);
      return maxSwapAmount > BigNumber.from(0) ? maxSwapAmount.mul(11).div(10) : BigNumber.from(0);
  }

  public newQuoteIndex(): BigNumberish {
    const currentIndex = this.quoteIndex;
    this.quoteIndex = this.quoteIndex.add(1);
    return currentIndex;
  }

  private _buildMultiExitGivenInParams(params: MultiExitGivenInSafeguardPool): JoinExitSafeguardPool {
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: SafeguardPoolEncoder.exitExactBPTInForTokensOut(params.bptIn),
    };
  }

  async setJoinExitEnabled(from: SignerWithAddress, joinExitEnabled: boolean): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.setJoinExitEnabled(joinExitEnabled);
  }

  async setSwapEnabled(from: SignerWithAddress, swapEnabled: boolean): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.setSwapEnabled(swapEnabled);
  }

  async setSwapFeePercentage(from: SignerWithAddress, swapFeePercentage: BigNumberish): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.setSwapFeePercentage(swapFeePercentage);
  }

  async setManagementFees(from: SignerWithAddress, yearlyFees: BigNumberish) {
    const pool = this.instance.connect(from);
    return pool.setManagementFees(yearlyFees);
  }

  async setFlexibleOracleStates(from: SignerWithAddress, isFlexibleOracle0: boolean, isFlexibleOracle1: boolean) {
    const pool = this.instance.connect(from);
    return pool.setFlexibleOracleStates(isFlexibleOracle0, isFlexibleOracle1);
  }

  async evaluateStablesPegStates(from: SignerWithAddress) {
    const pool = this.instance.connect(from);
    return pool.evaluateStablesPegStates();
  }

  async getOracleParams(): Promise<OracleParams[]> {
    return this.instance.getOracleParams();
  }

  async getMustAllowlistLPs(): Promise<boolean> {
    return this.instance.getMustAllowlistLPs();
  }

  async setMustAllowlistLPs(from: SignerWithAddress, mustAllowlistLPs: boolean): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.setMustAllowlistLPs(mustAllowlistLPs);
  }

  async validateSwap(
    kind: number,
    isTokenInToken0: boolean,
    balanceTokenIn: BigNumber,
    balanceTokenOut: BigNumber,
    amountIn: BigNumber,
    amountOut: BigNumber,
    quoteAmountInPerOut: BigNumber,
    maxSwapAmount: BigNumber,
  ): Promise<any> {
    return await this.instance.validateSwap(
      kind,
      isTokenInToken0,
      balanceTokenIn,
      balanceTokenOut,
      amountIn,
      amountOut,
      quoteAmountInPerOut,
      maxSwapAmount,
    );
  }

  async getBalanceAndPrice(isTokenInToken0: boolean): Promise<[BigNumber, BigNumber, BigNumber]> {
    const currentBalances = await this.getBalances();
    const amountInPerOut = await this.getAmountInPerOut(isTokenInToken0 ? 0: 1)
    return [
      isTokenInToken0 ? currentBalances[0] : currentBalances[1],
      isTokenInToken0 ? currentBalances[1] : currentBalances[0],
      bn(amountInPerOut)
    ]
  };

  async swapSignatureSafeguard(
    kind: number,
    isTokenInToken0: boolean,
    sender: string,
    recipient: string,
    userData: string,
  ): Promise<[BigNumber, BigNumber, BigNumber]> {
    return await this.instance.swapSignatureSafeguard(
      kind,
      isTokenInToken0,
      sender,
      recipient,
      userData
    );
  };

  async validateSwapSignature(
    kind: number,
    isTokenInToken0: boolean,
    sender: string,
    recipient: string,
    swapData: string,
    signature: string,
    quoteIndex: BigNumberish,
    deadline: BigNumberish,
  ): Promise<any> {
    return await this.instance.validateSwapSignature(
      kind,
      isTokenInToken0,
      sender,
      recipient,
      swapData,
      signature,
      quoteIndex,
      deadline
    );
  };

  async buildSwapUserData(params: SwapSafeguardPool): Promise<MinimalSwap> {
    return await this._buildSwapParams(SwapKind.GivenIn, params);
  }

  async isQuoteUsed(isQuoteValid: BigNumberish): Promise<boolean> {
    return await this.instance.isQuoteUsedTest(isQuoteValid);
  }

  async isLPAllowed(sender: string, userData: string): Promise<ContractReceipt> {
    return await this.instance.callStatic.isLPAllowed(sender, userData);
  }

  async getAllowListUserData(
    chainId: number, 
    sender: string, 
    deadline: BigNumber, 
    signer: SignerWithAddress,
    joinData: string
  ): Promise<string> {
    return await SafeguardPoolEncoder.allowlist(
      chainId,
      this.address,
      sender,
      deadline,
      joinData,
      signer
    );
  }

}
