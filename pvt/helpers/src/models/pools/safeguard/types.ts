import { BigNumber, ContractReceipt, Signer } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { BigNumberish } from '../../../numbers';

import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import Oracle from '../../oracles/Oracle';

import { Account, NAry } from '../../types/types';
import Vault from '../../vault/Vault';

export type RawSafeguardPoolDeployment = {
  tokens?: TokenList;
  oracles?: Oracle[];
  assetManagers?: string[];
  swapFeePercentage?: BigNumberish;
  pauseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  swapEnabledOnStart?: boolean;
  mustAllowlistLPs?: boolean;
  owner?: Account;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
  vault?: Vault;
  mockContractName?: string;
  fromFactory?: boolean;
  factoryVersion?: string;
  poolVersion?: string;
  signer: SignerWithAddress;
  maxTVLoffset?: BigNumberish;
  maxBalOffset?: BigNumberish;
  perfUpdateInterval?: BigNumberish;
  maxQuoteOffset?: BigNumberish;
  maxPriceOffet?: BigNumberish
};

export type SafeguardPoolDeployment = {
  tokens: TokenList;
  oracles: Oracle[];
  assetManagers: string[];
  swapFeePercentage: BigNumberish;
  pauseWindowDuration: BigNumberish;
  bufferPeriodDuration: BigNumberish;
  swapEnabledOnStart: boolean;
  mustAllowlistLPs: boolean;
  factoryVersion: string;
  poolVersion: string;
  owner?: string;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
  safeguardParameters : InitialSafeguardParams
};

export type InitialSafeguardParams = {
  signer: SignerWithAddress;
  maxTVLoffset: BigNumberish;
  maxBalOffset: BigNumberish;
  perfUpdateInterval: BigNumberish;
  maxQuoteOffset: BigNumberish;
  maxPriceOffet: BigNumberish;
};


export type SwapSafeguardPool = {
  chainId                   : number,
  in                        : number | Token;
  out                       : number | Token;
  amount                    : BigNumberish;
  recipient?                : string;
  from?                     : SignerWithAddress;
  lastChangeBlock?          : BigNumberish;
  deadline?                 : BigNumberish;
  maxSwapAmount?            : BigNumberish;
  quoteAmountInPerOut?       : BigNumberish;
  maxBalanceChangeTolerance?: BigNumberish;
  quoteBalanceIn?           : BigNumberish;
  quoteBalanceOut?          : BigNumberish;
  balanceBasedSlippage?     : BigNumberish;
  startTime?                : BigNumberish;
  timeBasedSlippage?        : BigNumberish;
  signer                    : SignerWithAddress;
};

export type JoinExitSafeguardPool = {
  recipient?: Account;
  currentBalances?: BigNumberish[];
  lastChangeBlock?: BigNumberish;
  protocolFeePercentage?: BigNumberish;
  data?: string;
  from?: SignerWithAddress;
};

export type InitSafeguardPool = {
  initialBalances: NAry<BigNumberish>;
  from?: SignerWithAddress;
  recipient?: Account;
  protocolFeePercentage?: BigNumberish;
};

export type JoinGivenInSafeguardPool = {
  from?                     : SignerWithAddress;
  lastChangeBlock?          : BigNumberish;
  currentBalances?          : BigNumberish[];
  protocolFeePercentage?    : BigNumberish;
  recipient                 : string;
  chainId                   : number;
  deadline?                 : BigNumberish;
  minBptAmountOut?          : BigNumberish;
  amountsIn                 : BigNumberish[];
  swapTokenIn               : number | Token;
  maxSwapAmount?            : BigNumberish;
  quoteAmountInPerOut?       : BigNumberish;
  maxBalanceChangeTolerance?: BigNumberish;
  quoteBalanceIn?           : BigNumberish;
  quoteBalanceOut?          : BigNumberish;
  balanceBasedSlippage?     : BigNumberish;
  startTime?                : BigNumberish;
  timeBasedSlippage?        : BigNumberish;
  signer                    : SignerWithAddress;
};

export type JoinGivenOutWeightedPool = {
  token: number | Token;
  bptOut: BigNumberish;
  from?: SignerWithAddress;
  recipient?: Account;
  lastChangeBlock?: BigNumberish;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
};

export type JoinAllGivenOutSafeguardPool = {
  bptOut: BigNumberish;
  from?: SignerWithAddress;
  recipient?: Account;
  lastChangeBlock?: BigNumberish;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
};

export type ExitGivenOutSafeguardPool = {
  from?                     : SignerWithAddress;
  lastChangeBlock?          : BigNumberish;
  currentBalances?          : BigNumberish[];
  protocolFeePercentage?    : BigNumberish;
  recipient                 : string;
  chainId                   : number;
  deadline?                 : BigNumberish;
  maxBptAmountIn?           : BigNumberish;
  amountsOut                : BigNumberish[];
  swapTokenIn               : number | Token;
  maxSwapAmount?            : BigNumberish;
  quoteAmountInPerOut?       : BigNumberish;
  maxBalanceChangeTolerance?: BigNumberish;
  quoteBalanceIn?           : BigNumberish;
  quoteBalanceOut?          : BigNumberish;
  balanceBasedSlippage?     : BigNumberish;
  startTime?                : BigNumberish;
  timeBasedSlippage?        : BigNumberish;
  signer                    : SignerWithAddress;
};

export type SingleExitGivenInWeightedPool = {
  bptIn: BigNumberish;
  token: number | Token;
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
};

export type MultiExitGivenInSafeguardPool = {
  bptIn: BigNumberish;
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
};

export type JoinResult = {
  amountsIn: BigNumber[];
  dueProtocolFeeAmounts: BigNumber[];
  receipt: ContractReceipt;
};

export type ExitResult = {
  amountsOut: BigNumber[];
  dueProtocolFeeAmounts: BigNumber[];
  receipt: ContractReceipt;
};

export type SwapResult = {
  amount: BigNumber;
  receipt: ContractReceipt;
};

export type JoinQueryResult = {
  bptOut: BigNumber;
  amountsIn: BigNumber[];
};

export type ExitQueryResult = {
  bptIn: BigNumber;
  amountsOut: BigNumber[];
};

export type VoidResult = {
  receipt: ContractReceipt;
};

export type PoolQueryResult = JoinQueryResult | ExitQueryResult;

export type BasePoolRights = {
  canTransferOwnership: boolean;
  canChangeSwapFee: boolean;
  canUpdateMetadata: boolean;
};

export type ManagedPoolRights = {
  canChangeWeights: boolean;
  canDisableSwaps: boolean;
  canSetMustAllowlistLPs: boolean;
  canSetCircuitBreakers: boolean;
  canChangeTokens: boolean;
  canChangeMgmtFees: boolean;
  canDisableJoinExit: boolean;
};

export type ManagedPoolParams = {
  tokens: string[];
  normalizedWeights: BigNumberish[];
  swapFeePercentage: BigNumberish;
  swapEnabledOnStart: boolean;
  mustAllowlistLPs: boolean;
  managementAumFeePercentage: BigNumberish;
  aumFeeId: BigNumberish;
};

export type CircuitBreakerState = {
  bptPrice: BigNumber;
  referenceWeight: BigNumber;
  lowerBound: BigNumber;
  upperBound: BigNumber;
  lowerBptPriceBound: BigNumber;
  upperBptPriceBound: BigNumber;
};
