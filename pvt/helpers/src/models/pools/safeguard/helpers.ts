import { Decimal } from 'decimal.js';
import { BigNumberish, decimal } from '../../../numbers';
import { bn } from '../../../numbers';

export const toBNish = (x: BigNumberish | Decimal, decimals: number): BigNumberish => bn(decimal(x).mul(decimal(10).pow(decimals)));

export const fromBNish = (x: BigNumberish | Decimal, decimals: number): Decimal => decimal(x).div(decimal(10).pow(decimals));