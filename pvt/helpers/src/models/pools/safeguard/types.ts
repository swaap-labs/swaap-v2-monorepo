import { BigNumber, ContractReceipt } from 'ethers';
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
  maxOracleTimeouts?: BigNumberish[];
  stableTokens?: boolean[];
  flexibleOracles?: boolean[];
  assetManagers?: string[];
  pauseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  swapEnabledOnStart?: boolean;
  owner?: Account;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
  vault?: Vault;
  mockContractName?: string;
  fromFactory?: boolean;
  signer: SignerWithAddress;
  maxPerfDev?: BigNumberish;
  maxTargetDev?: BigNumberish;
  maxPriceDev?: BigNumberish
  perfUpdateInterval?: BigNumberish;
  yearlyFees?: BigNumberish;
  mustAllowlistLPs?: boolean;
};

export type SafeguardPoolDeployment = {
  tokens: TokenList;
  assetManagers: string[];
  pauseWindowDuration: BigNumberish;
  bufferPeriodDuration: BigNumberish;
  owner?: string;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
  oracleParameters : InitialOracleParams[];
  safeguardParameters : InitialSafeguardParams;
};

export type InitialOracleParams = {
  oracle: Oracle;
  maxTimeout: BigNumberish;
  isStable: boolean;
  isFlexibleOracle: boolean;
}

export type OracleParams = {
  oracle: string;
  isStable: boolean;
  isFlexibleOracle: boolean;
  isPegged: boolean;
  priceScalingFactor: BigNumber;
}

export type InitialSafeguardParams = {
  signer: SignerWithAddress;
  maxPerfDev?: BigNumberish;
  maxTargetDev?: BigNumberish;
  maxPriceDev?: BigNumberish
  perfUpdateInterval?: BigNumberish;
  yearlyFees: BigNumberish;
  mustAllowlistLPs: boolean;
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
  expectedOrigin?           : string;
  maxSwapAmount?            : BigNumberish;
  quoteAmountInPerOut?      : BigNumberish;
  maxBalanceChangeTolerance?: BigNumberish;
  quoteBalanceIn?           : BigNumberish;
  quoteBalanceOut?          : BigNumberish;
  quoteTotalSupply?         : BigNumberish;
  balanceBasedSlippage?     : BigNumberish;
  startTime?                : BigNumberish;
  timeBasedSlippage?        : BigNumberish;
  originBasedSlippage?      : BigNumberish;
  quoteIndex?               : BigNumberish;
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
  chainId?: number;
  deadline?: BigNumberish;
  signer?: SignerWithAddress; 
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
  expectedOrigin?           : string;
  maxSwapAmount?            : BigNumberish;
  quoteAmountInPerOut?      : BigNumberish;
  maxBalanceChangeTolerance?: BigNumberish;
  quoteBalanceIn?           : BigNumberish;
  quoteBalanceOut?          : BigNumberish;
  quoteTotalSupply?         : BigNumberish;
  balanceBasedSlippage?     : BigNumberish;
  startTime?                : BigNumberish;
  timeBasedSlippage?        : BigNumberish;
  originBasedSlippage?      : BigNumberish;
  quoteIndex?               : BigNumberish;
  signer                    : SignerWithAddress;
  allowlistDeadline?        : BigNumberish;
};

export type JoinAllGivenOutSafeguardPool = {
  bptOut: BigNumberish;
  from?: SignerWithAddress;
  recipient?: Account;
  lastChangeBlock?: BigNumberish;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
  chainId?: number;
  deadline?: BigNumberish;
  signer?: SignerWithAddress
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
  expectedOrigin?           : string;
  maxSwapAmount?            : BigNumberish;
  quoteAmountInPerOut?      : BigNumberish;
  maxBalanceChangeTolerance?: BigNumberish;
  quoteBalanceIn?           : BigNumberish;
  quoteBalanceOut?          : BigNumberish;
  quoteTotalSupply?         : BigNumberish;
  balanceBasedSlippage?     : BigNumberish;
  originBasedSlippage?      : BigNumberish;
  startTime?                : BigNumberish;
  timeBasedSlippage?        : BigNumberish;
  quoteIndex?               : BigNumberish;
  signer                    : SignerWithAddress;
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

export type CircuitBreakerState = {
  bptPrice: BigNumber;
  referenceWeight: BigNumber;
  lowerBound: BigNumber;
  upperBound: BigNumber;
  lowerBptPriceBound: BigNumber;
  upperBptPriceBound: BigNumber;
};
