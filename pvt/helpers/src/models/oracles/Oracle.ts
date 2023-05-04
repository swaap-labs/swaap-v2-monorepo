import { BigNumber, BigNumberish, Contract, ContractTransaction } from 'ethers';

import Decimal from 'decimal.js';

import OraclesDeployer from './OraclesDeployer';
import { OracleDeployment } from './types';
import { scaleUp, bn } from '../../numbers';

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

  async setPrice(price: Decimal | number): Promise<ContractTransaction> {
    const scaledPrice = scaleUp(bn(price), bn(10).pow(bn(this.decimals)));
    this.price = price;
    return this.instance.setPrice(scaledPrice);
  }

}
