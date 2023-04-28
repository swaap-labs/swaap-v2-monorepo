import { BigNumber, Contract, ContractFunction, ContractReceipt, ContractTransaction } from 'ethers';
import { BigNumberish, bn, fp, fpMul } from '../../../numbers';
import { MAX_INT256, MAX_UINT112, MAX_UINT256, ZERO_ADDRESS } from '../../../constants';
import * as expectEvent from '../../../test/expectEvent';
import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
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
  CircuitBreakerState,
} from './types';

import Oracle from "../../oracles/Oracle";

import {

} from './math';

import { Account, SafeguardPoolExitKind, SafeguardPoolJoinKind, SwapKind, SafeguardPoolEncoder } from '@balancer-labs/balancer-js';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import BasePool from '../base/BasePool';
import { currentTimestamp } from '../../../time';
import { fromBNish, toBNish } from './helpers';
import { start } from 'repl';

const MAX_IN_RATIO = fp(0.3);
const MAX_OUT_RATIO = fp(0.3);
const MAX_INVARIANT_RATIO = fp(3);
const MIN_INVARIANT_RATIO = fp(0.7);

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

  async joinGivenOut(params: JoinGivenOutSafeguardPool): Promise<JoinResult> {
    return this.join(this._buildJoinGivenOutParams(params));
  }

  async queryJoinGivenOut(params: JoinGivenOutSafeguardPool): Promise<JoinQueryResult> {
    return this.queryJoin(this._buildJoinGivenOutParams(params));
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

  async singleExitGivenIn(params: SingleExitGivenInSafeguardPool): Promise<ExitResult> {
    return this.exit(this._buildSingleExitGivenInParams(params));
  }

  async querySingleExitGivenIn(params: SingleExitGivenInSafeguardPool): Promise<ExitQueryResult> {
    return this.queryExit(this._buildSingleExitGivenInParams(params));
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
    const maxSwapAmount = params.maxSwapAmount?? MAX_UINT256;
    const quoteAmountInPerOut = params.quoteAmountInPerOut?? await this.getAmountInPerOut(tokenIn);
    const maxBalanceChangeTolerance = params.maxBalanceChangeTolerance?? MAX_UINT256;
    const quoteBalanceIn = params.quoteBalanceIn?? (tokenIn == tokens[0]? currentBalances[0] : currentBalances[1]);
    const quoteBalanceOut = params.quoteBalanceOut?? (tokenOut == tokens[0]? currentBalances[0] : currentBalances[1]);
    const balanceBasedSlippage = params.balanceBasedSlippage?? 0;
    const startTime = params.startTime?? MAX_UINT256;
    const timeBasedSlippage = params.timeBasedSlippage?? 0;
    const originBasedSlippage = params.originBasedSlippage?? 0;
    const quoteIndex = params.quoteIndex?? this._newQuoteIndex();

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
        params.deadline?? Math.floor(Date.now() / 1000) + 100,
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
    const amountsIn = Array.isArray(params.amountsIn) ? params.amountsIn : Array(this.tokens.length).fill(params.amountsIn);
    const swapTokenIn = typeof params.swapTokenIn === 'number' ? tokens[params.swapTokenIn] : params.swapTokenIn.address;
    const expectedOrigin = params.expectedOrigin?? sender;
    const maxSwapAmount = params.maxSwapAmount?? MAX_UINT256;
    const quoteAmountInPerOut = params.quoteAmountInPerOut?? await this.getAmountInPerOut(swapTokenIn);
    const maxBalanceChangeTolerance = params.maxBalanceChangeTolerance?? MAX_UINT256;
    const quoteBalanceIn = params.quoteBalanceIn?? (swapTokenIn == tokens[0]? currentBalances[0] : currentBalances[1]);
    const quoteBalanceOut = params.quoteBalanceOut?? (swapTokenIn == tokens[0]? currentBalances[1] : currentBalances[0]);
    const balanceBasedSlippage = params.balanceBasedSlippage?? 0;
    const startTime = params.startTime?? MAX_UINT256;
    const timeBasedSlippage = params.timeBasedSlippage?? 0;
    const originBasedSlippage = params.originBasedSlippage?? 0;
    const quoteIndex = params.quoteIndex?? this._newQuoteIndex();
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
        params.allowlistDeadline?? Math.floor(Date.now() / 1000) + 100,
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

  private _buildJoinGivenOutParams(params: JoinGivenOutSafeguardPool): JoinExitSafeguardPool {
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: SafeguardPoolEncoder.joinTokenInForExactBPTOut(params.bptOut, this.tokens.indexOf(params.token)),
    };
  }

  private async _buildJoinAllGivenOutParams(params: JoinAllGivenOutSafeguardPool): Promise<JoinExitSafeguardPool> {
    
    let userData = await SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(params.bptOut);

    if(await this.instance.isAllowlistEnabled()) {
      const sender = params.from?? (await this.vault._defaultSender());

      userData = await SafeguardPoolEncoder.allowlist(
        params.chainId!,
        this.address,
        sender.address,
        params.deadline?? Math.floor(Date.now() / 1000) + 100,
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
    const maxSwapAmount = params.maxSwapAmount?? MAX_UINT256;
    const quoteAmountInPerOut = params.quoteAmountInPerOut?? await this.getAmountInPerOut(swapTokenIn);
    const maxBalanceChangeTolerance = params.maxBalanceChangeTolerance?? MAX_UINT256;
    const quoteBalanceIn = params.quoteBalanceIn?? (swapTokenIn == tokens[0]? currentBalances[0] : currentBalances[1]);
    const quoteBalanceOut = params.quoteBalanceOut?? (swapTokenIn == tokens[0]? currentBalances[1] : currentBalances[0]);
    const balanceBasedSlippage = params.balanceBasedSlippage?? 0;
    const startTime = params.startTime?? MAX_UINT256;
    const timeBasedSlippage = params.timeBasedSlippage?? 0;
    const originBasedSlippage = params.originBasedSlippage?? 0;
    const quoteIndex = params.quoteIndex?? this._newQuoteIndex();
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
        balanceBasedSlippage,
        startTime,
        timeBasedSlippage,
        originBasedSlippage,
        quoteIndex,
        signer
      ),
    };
  }

  private _newQuoteIndex(): BigNumberish {
    const currentIndex = this.quoteIndex;
    this.quoteIndex = this.quoteIndex.add(1);
    return currentIndex;
  }

  private _buildSingleExitGivenInParams(params: SingleExitGivenInSafeguardPool): JoinExitSafeguardPool {
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: SafeguardPoolEncoder.exitExactBPTInForOneTokenOut(params.bptIn, this.tokens.indexOf(params.token)),
    };
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

  async addAllowedAddress(from: SignerWithAddress, member: Account): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.addAllowedAddress(TypesConverter.toAddress(member));
  }

  async removeAllowedAddress(from: SignerWithAddress, member: Account): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.removeAllowedAddress(TypesConverter.toAddress(member));
  }

  async getMustAllowlistLPs(): Promise<boolean> {
    return this.instance.getMustAllowlistLPs();
  }

  async setMustAllowlistLPs(from: SignerWithAddress, mustAllowlistLPs: boolean): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.setMustAllowlistLPs(mustAllowlistLPs);
  }

  async isAllowedAddress(member: string): Promise<boolean> {
    return this.instance.isAllowedAddress(member);
  }

  async setCircuitBreakers(
    from: SignerWithAddress,
    tokens: Token[] | string[],
    bptPrices: BigNumber[],
    lowerBounds: BigNumber[],
    upperBounds: BigNumber[]
  ): Promise<ContractTransaction> {
    const tokensArg = tokens.map((t) => TypesConverter.toAddress(t));
    const pool = this.instance.connect(from);

    return await pool.setCircuitBreakers(tokensArg, bptPrices, lowerBounds, upperBounds);
  }

  async getCircuitBreakerState(token: Token | string): Promise<CircuitBreakerState> {
    return await this.instance.getCircuitBreakerState(TypesConverter.toAddress(token));
  }

}
