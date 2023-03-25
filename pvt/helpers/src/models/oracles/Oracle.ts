import { BigNumber, BigNumberish, Contract, ContractTransaction } from 'ethers';

import { decimal } from '../../numbers';
import Decimal from 'decimal.js';

import OraclesDeployer from './OraclesDeployer';
import { OracleDeployment } from './types';

export default class Oracle {
  description: string;
  price: Decimal | number;
  decimals: number;
  instance: Contract;

  static async create(params: OracleDeployment): Promise<Oracle> {
    return OraclesDeployer.deployOracle(params);
  }

  constructor(description: string, price: Decimal | number, decimals: number, instance: Contract) {
    this.description = description;
    this.price = price;
    this.decimals = decimals;
    this.instance = instance;
  }

  get address(): string {
    return this.instance.address;
  }

  async latestAnswer(): Promise<BigNumber> {
    return this.instance.latestAnswer();
  }

  getDecimals(): BigNumberish {
    return this.decimals;
  }

  async setPrice(price: Decimal): Promise<ContractTransaction> {
    
    return this.instance.setPrice(price.mul(decimal(10).pow(this.decimals)));

  }

}
