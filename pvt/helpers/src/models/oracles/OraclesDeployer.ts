import { ethers } from 'hardhat';

import { deploy } from '../../contract';

import Oracle from './Oracle';
import { OracleDeployment } from './types';
import { bn, fp, FP_ONE } from '../../numbers';

class OraclesDeployer {

  async deployOracle(params: OracleDeployment): Promise<Oracle> {
    const sender = (await ethers.getSigners())[0];

    const scaledPrice = fp(params.price).mul(bn(10).pow(bn(params.decimals))).div(FP_ONE);

    let instance = await deploy('v2-pool-safeguard/TestOracle', {
      from: sender,
      args: [params.description, scaledPrice, params.decimals],
    });

    return new Oracle(params.description, params.price, params.decimals, instance);
  }

}

export default new OraclesDeployer();
