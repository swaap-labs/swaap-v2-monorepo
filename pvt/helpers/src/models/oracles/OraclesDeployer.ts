import { ethers } from 'hardhat';

import { deploy } from '../../contract';

import Oracle from './Oracle';
import { OracleDeployment } from './types';

class OraclesDeployer {

  async deployOracle(params: OracleDeployment): Promise<Oracle> {
    const sender = (await ethers.getSigners())[0];

    let instance = await deploy('pool-safeguard/TestOracle', {
      from: sender,
      args: [params.description, params.price, params.decimals],
    });

    return new Oracle(params.description, params.price, params.decimals, instance);
  }

}

export default new OraclesDeployer();
