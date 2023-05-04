import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Decimal from 'decimal.js';

import { BigNumberish } from '../../numbers';

import { NAry, Account } from '../types/types';

export type OracleDeployment = {
  description: string;
  price: Decimal | number;
  decimals: number;
};

export type RawSetPrice = NAry<{
  price: Decimal;
}>;

export type SetPrice = {
  price: Decimal;
};
