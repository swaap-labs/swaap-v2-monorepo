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

    result = deploy('v2-pool-safeguard/SafeguardTwoTokenPool', {
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

  // async _deployFromFactory(params: WeightedPoolDeployment, vault: Vault): Promise<Contract> {
  //   // Note that we only support asset managers with the standalone deploy method.
  //   const {
  //     tokens,
  //     weights,
  //     rateProviders,
  //     assetManagers,
  //     swapFeePercentage,
  //     swapEnabledOnStart,
  //     mustAllowlistLPs,
  //     managementAumFeePercentage,
  //     poolType,
  //     owner,
  //     from,
  //     aumFeeId,
  //     factoryVersion,
  //     poolVersion,
  //   } = params;

  //   let result: Promise<Contract>;
  //   const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  //   const BASE_BUFFER_PERIOD_DURATION = MONTH;

  //   switch (poolType) {
  //     case WeightedPoolType.LIQUIDITY_BOOTSTRAPPING_POOL: {
  //       const factory = await deploy('v2-pool-weighted/LiquidityBootstrappingPoolFactory', {
  //         args: [
  //           vault.address,
  //           vault.getFeesProvider().address,
  //           BASE_PAUSE_WINDOW_DURATION,
  //           BASE_BUFFER_PERIOD_DURATION,
  //         ],
  //         from,
  //       });
  //       const tx = await factory.create(
  //         NAME,
  //         SYMBOL,
  //         tokens.addresses,
  //         weights,
  //         swapFeePercentage,
  //         owner,
  //         swapEnabledOnStart
  //       );
  //       const receipt = await tx.wait();
  //       const event = expectEvent.inReceipt(receipt, 'PoolCreated');
  //       result = deployedAt('v2-pool-weighted/LiquidityBootstrappingPool', event.args.pool);
  //       break;
  //     }
  //     case WeightedPoolType.MANAGED_POOL: {
  //       const MANAGED_PAUSE_WINDOW_DURATION = MONTH * 9;
  //       const MANAGED_BUFFER_PERIOD_DURATION = MONTH * 2;

  //       const addRemoveTokenLib = await deploy('v2-pool-weighted/ManagedPoolAddRemoveTokenLib');
  //       const circuitBreakerLib = await deploy('v2-pool-weighted/CircuitBreakerLib');
  //       const factory = await deploy('v2-pool-weighted/ManagedPoolFactory', {
  //         args: [
  //           vault.address,
  //           vault.getFeesProvider().address,
  //           factoryVersion,
  //           poolVersion,
  //           MANAGED_PAUSE_WINDOW_DURATION,
  //           MANAGED_BUFFER_PERIOD_DURATION,
  //         ],
  //         from,
  //         libraries: {
  //           CircuitBreakerLib: circuitBreakerLib.address,
  //           ManagedPoolAddRemoveTokenLib: addRemoveTokenLib.address,
  //         },
  //       });

  //       const poolParams = {
  //         name: NAME,
  //         symbol: SYMBOL,
  //         assetManagers,
  //       };

  //       const settingsParams: ManagedPoolParams = {
  //         tokens: tokens.addresses,
  //         normalizedWeights: weights,
  //         swapFeePercentage: swapFeePercentage,
  //         swapEnabledOnStart: swapEnabledOnStart,
  //         mustAllowlistLPs: mustAllowlistLPs,
  //         managementAumFeePercentage: managementAumFeePercentage,
  //         aumFeeId: aumFeeId ?? ProtocolFee.AUM,
  //       };

  //       const tx = await factory
  //         .connect(from || ZERO_ADDRESS)
  //         .create(poolParams, settingsParams, from?.address || ZERO_ADDRESS);
  //       const receipt = await tx.wait();
  //       const event = expectEvent.inReceipt(receipt, 'ManagedPoolCreated');

  //       result = deployedAt('v2-pool-weighted/ManagedPool', event.args.pool);
  //       break;
  //     }
  //     case WeightedPoolType.MOCK_MANAGED_POOL: {
  //       throw new Error('Mock type not supported to deploy from factory');
  //     }
  //     default: {
  //       const factory = await deploy('v2-pool-weighted/WeightedPoolFactory', {
  //         args: [
  //           vault.address,
  //           vault.getFeesProvider().address,
  //           BASE_PAUSE_WINDOW_DURATION,
  //           BASE_BUFFER_PERIOD_DURATION,
  //         ],
  //         from,
  //       });
  //       const tx = await factory.create(
  //         NAME,
  //         SYMBOL,
  //         tokens.addresses,
  //         weights,
  //         rateProviders,
  //         swapFeePercentage,
  //         owner
  //       );
  //       const receipt = await tx.wait();
  //       const event = expectEvent.inReceipt(receipt, 'PoolCreated');
  //       result = deployedAt('v2-pool-weighted/WeightedPool', event.args.pool);
  //     }
  //   }

  //   return result;
  // },
};
