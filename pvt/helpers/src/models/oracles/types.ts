import Decimal from 'decimal.js';

import { NAry } from '../types/types';

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
