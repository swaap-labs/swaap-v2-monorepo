import { Contract } from 'ethers';

import * as expectEvent from '../../../test/expectEvent';
import { deploy, deployedAt } from '../../../contract';

import Vault from '../../vault/Vault';
import SafeguardPool from './SafeguardPool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import { ManagedPoolParams, RawSafeguardPoolDeployment, SafeguardPoolDeployment } from './types';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { ProtocolFee } from '../../vault/types';
import { MONTH } from '../../../time';

const NAME = 'Pool Safeguard';
const SYMBOL = 'SPT';

export default {
  async deploy(params: RawSafeguardPoolDeployment): Promise<SafeguardPool> {
    const deployment = TypesConverter.toSafeguardPoolDeployment(params);
    const vault = params?.vault ?? (await VaultDeployer.deploy(TypesConverter.toRawVaultDeployment(params)));
    // const pool = await (params.fromFactory ? this._deployFromFactory : this._deployStandalone)(deployment, vault);
    const pool = await this._deployStandalone(deployment, vault);
    const poolId = await pool.getPoolId();

    const {
      tokens,
      assetManagers,
      oracleParameters,
      pauseWindowDuration,
      bufferPeriodDuration
    } = deployment;

    return new SafeguardPool(
      pool,
      poolId,
      vault,
      tokens,
      oracleParameters.map((oracleParam) => oracleParam.oracle),
      assetManagers,
      pauseWindowDuration,
      bufferPeriodDuration
    );
  },

  async _deployStandalone(params: SafeguardPoolDeployment, vault: Vault): Promise<Contract> {
       
    const {
      tokens,
      assetManagers,
      pauseWindowDuration,
      bufferPeriodDuration,
      owner,
      from,
      oracleParameters,
      safeguardParameters
    } = params;

    let result: Promise<Contract>;

    result = deploy('v2-pool-safeguard/TestSafeguardPool', {
          args: [
            vault.address,
            NAME,
            SYMBOL,
            tokens.addresses,
            assetManagers,
            pauseWindowDuration,
            bufferPeriodDuration,
            TypesConverter.toAddress(owner),
            oracleParameters.map((oracleParam) => {
              return {
                oracle: oracleParam.oracle.address,
                isStable: oracleParam.isStable,
                isFlexibleOracle: oracleParam.isFlexibleOracle,
              }
            }),
            {
              ...safeguardParameters,
              signer: safeguardParameters.signer.address,
            }
          ],
          from,
        });

    return result;
  },

};
