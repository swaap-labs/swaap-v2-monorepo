import { BigNumber, Contract, ContractFunction, ContractReceipt, ContractTransaction } from 'ethers';
import { BigNumberish, bn, fp, fpMul } from '../../../numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '../../../constants';
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
  // JoinAllGivenOutSafeguardPool,
  JoinResult,
  RawSafeguardPoolDeployment,
  ExitResult,
  SwapResult,
  // SingleExitGivenInSafeguardPool,
  // MultiExitGivenInSafeguardPool,
  // ExitGivenOutSafeguardPool,
  SwapSafeguardPool,
  ExitQueryResult,
  JoinQueryResult,
  PoolQueryResult,
  CircuitBreakerState,
} from './types';

import Oracle from "../../oracles/Oracle";

import {

} from './math';

import { Account, accountToAddress, SwapKind, SafeguardPoolEncoder } from '@balancer-labs/balancer-js';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import BasePool from '../base/BasePool';
import { currentTimestamp } from '../../../time';

const MAX_IN_RATIO = fp(0.3);
const MAX_OUT_RATIO = fp(0.3);
const MAX_INVARIANT_RATIO = fp(3);
const MIN_INVARIANT_RATIO = fp(0.7);

export default class SafeguardPool extends BasePool {
  oracles: Oracle[];
  assetManagers: string[];
  swapEnabledOnStart: boolean;
  mustAllowlistLPs: boolean;
  poolVersion: string;

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
    swapFeePercentage: BigNumberish,
    swapEnabledOnStart: boolean,
    mustAllowlistLPs: boolean,
    poolVersion: string,
    owner?: SignerWithAddress
  ) {
    super(instance, poolId, vault, tokens, swapFeePercentage, owner);

    this.oracles = oracles;
    this.assetManagers = assetManagers;
    this.swapEnabledOnStart = swapEnabledOnStart;
    this.mustAllowlistLPs = mustAllowlistLPs;
    this.poolVersion = poolVersion;
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
    return this.join(this._buildInitParams(params));
  }

  async joinGivenIn(params: JoinGivenInSafeguardPool): Promise<JoinResult> {
    console.log("joinGivenIn");
    return this.join(await this._buildJoinGivenInParams(params));
  }

  async queryJoinGivenIn(params: JoinGivenInSafeguardPool): Promise<JoinQueryResult> {
    return this.queryJoin(this._buildJoinGivenInParams(params));
  }

  async joinGivenOut(params: JoinGivenOutSafeguardPool): Promise<JoinResult> {
    return this.join(this._buildJoinGivenOutParams(params));
  }

  async queryJoinGivenOut(params: JoinGivenOutSafeguardPool): Promise<JoinQueryResult> {
    return this.queryJoin(this._buildJoinGivenOutParams(params));
  }

  async joinAllGivenOut(params: JoinAllGivenOutSafeguardPool): Promise<JoinResult> {
    return this.join(this._buildJoinAllGivenOutParams(params));
  }

  async queryJoinAllGivenOut(params: JoinAllGivenOutSafeguardPool): Promise<JoinQueryResult> {
    return this.queryJoin(this._buildJoinAllGivenOutParams(params));
  }

  async exitGivenOut(params: ExitGivenOutSafeguardPool): Promise<ExitResult> {
    return this.exit(this._buildExitGivenOutParams(params));
  }

  async queryExitGivenOut(params: ExitGivenOutSafeguardPool): Promise<ExitQueryResult> {
    return this.queryExit(this._buildExitGivenOutParams(params));
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

  private async _buildSwapParams(kind: number, params: SwapSafeguardPool): Promise<MinimalSwap> {
    const currentBalances = await this.getBalances();
    const { tokens } = await this.vault.getPoolTokens(this.poolId);
    const tokenIn = typeof params.in === 'number' ? tokens[params.in] : params.in.address;
    const tokenOut = typeof params.out === 'number' ? tokens[params.out] : params.out.address;
    const recipient = params.recipient ?? ZERO_ADDRESS;
    const deadline = params.deadline?? MAX_UINT256;
    const slippageParameter = params.slippageParameter?? MAX_UINT256;
    const startTime = params.startTime?? MAX_UINT256;
    const quoteBalance0 = params.quoteBalances? params.quoteBalances[0] : currentBalances[0];
    const quoteBalance1 = params.quoteBalances? params.quoteBalances[1] : currentBalances[1];

    const data = await SafeguardPoolEncoder.swap(
      params.chainId,
      this.address,
      kind,
      await this.getPoolId(),
      tokenIn,
      tokenOut,
      params.amount,
      recipient,
      deadline,
      params.variableAmount,
      slippageParameter,
      startTime,
      quoteBalance0,
      quoteBalance1,
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

  private _buildInitParams(params: InitSafeguardPool): JoinExitSafeguardPool {
    const { initialBalances: balances } = params;
    const amountsIn = Array.isArray(balances) ? balances : Array(this.tokens.length).fill(balances);

    return {
      from: params.from,
      recipient: params.recipient,
      protocolFeePercentage: params.protocolFeePercentage,
      data: SafeguardPoolEncoder.joinInit(amountsIn),
    };
  };

  private async _buildJoinGivenInParams(params: JoinGivenInSafeguardPool): Promise<JoinExitSafeguardPool> {
    // const { amountsIn: amounts } = params;
    console.log("_buildJoinGivenInParams")
    const amountsIn = Array.isArray(params.amountsIn) ? params.amountsIn : Array(this.tokens.length).fill(params.amountsIn);

    const { tokens } = await this.getTokens();
    
    const buyToken = tokens.find( (token) => token != params.sellToken) || "";

    const contractAddress = this.address;
    const poolId = this.poolId;
    const receiver = params.receiver;
    const chainId = params.chainId;
    const startTime = params.startTime || MAX_UINT256;
    const deadline = params.deadline  || MAX_UINT256;
    const minBptAmountOut = params.minBptAmountOut || 0;
    const sellToken = params.sellToken;
    const maxSwapAmountIn = params.maxSwapAmountIn;
    const amountIn0 = amountsIn[0];
    const amountIn1 = amountsIn[1];
    const variableAmount = params.variableAmount;
    const quoteBalanceIn = params.quoteBalanceIn || await this.getTokenBalance(params.sellToken);
    const quoteBalanceOut = params.quoteBalanceOut || await this.getTokenBalance(buyToken);
    const slippageParameter = params.slippageParameter || 0;
    const signer = params.signer;

    return {
      from: params.from,
      recipient: params.receiver,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: await SafeguardPoolEncoder.joinExactTokensInForBPTOut(
        chainId,
        contractAddress,
        poolId,
        receiver,
        startTime,
        deadline,
        minBptAmountOut,
        sellToken,
        maxSwapAmountIn,
        amountIn0,
        amountIn1,
        variableAmount,
        quoteBalanceIn,
        quoteBalanceOut,
        slippageParameter,
        signer
      ),
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

  private _buildJoinAllGivenOutParams(params: JoinAllGivenOutSafeguardPool): JoinExitSafeguardPool {
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(params.bptOut),
    };
  }

  private _buildExitGivenOutParams(params: ExitGivenOutSafeguardPool): JoinExitSafeguardPool {
    const { amountsOut: amounts } = params;
    const amountsOut = Array.isArray(amounts) ? amounts : Array(this.tokens.length).fill(amounts);
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: SafeguardPoolEncoder.exitBPTInForExactTokensOut(amountsOut, params.maximumBptIn ?? MAX_UINT256),
    };
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
