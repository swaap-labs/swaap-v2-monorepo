import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, currentTimestamp, DAY, MONTH } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { DELEGATE_OWNER, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Oracle from '@balancer-labs/v2-helpers/src/models/oracles/Oracle';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import OraclesDeployer from '@balancer-labs/v2-helpers/src/models/oracles/OraclesDeployer';
import '@balancer-labs/v2-common/setupTests'

describe('SafeguardTwoTokenFactory', function () {
  let tokens: TokenList;
  let oracles: Oracle[];
  let factory: Contract;
  let vault: Vault;
  let owner: SignerWithAddress;

  const NAME = 'Pool Safeguard';
  const SYMBOL = 'SPT';

  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  let createTime: BigNumber;

  before('setup signers', async () => {
    [, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy factory & tokens', async () => {
    vault = await Vault.create();

    factory = await deploy('SafeguardTwoTokenFactory', {
      args: [vault.address, vault.getFeesProvider().address, BASE_PAUSE_WINDOW_DURATION, BASE_BUFFER_PERIOD_DURATION],
    });
    createTime = await currentTimestamp();

    tokens = await TokenList.create(['DAI', 'USDC'], { sorted: true });

    oracles = await tokens.asyncMap(async (token) => (await OraclesDeployer.deployOracle(
      {description: token.name, price :1, decimals:18}
    )));

  });

  const maxPerfDev = fp(0.96);
  const maxTargetDev = fp(0.95);
  const maxPriceDev = fp(0.97);
  const perfUpdateInterval = 1 * DAY;
  const yearlyFees = fp(0.01);
  const mustAllowlistLPs = true;

  async function createPool(
    {isStable0=false, isFlexibleOracle0=false, isStable1=false, isFlexibleOracle1=false, setPegStates=false}
  ): Promise<Contract> {
    
    let initialOracleParams =  [
      {
        oracle: oracles[0].address,
        isStable: isStable0,
        isFlexibleOracle: isFlexibleOracle0
      },
      {
        oracle: oracles[1].address,
        isStable: isStable1,
        isFlexibleOracle: isFlexibleOracle1
      }
    ]

    let safeguardParameters = {
      signer: owner.address,
      maxPerfDev: maxPerfDev,
      maxTargetDev: maxTargetDev,
      maxPriceDev: maxPriceDev,
      perfUpdateInterval: perfUpdateInterval, 
      yearlyFees: yearlyFees,
      mustAllowlistLPs: mustAllowlistLPs
    }

    const receipt = await (
      await factory.create(
        NAME,
        SYMBOL,
        tokens.addresses,
        initialOracleParams,
        safeguardParameters,
        setPegStates
      )
    ).wait();

    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    return deployedAt('SafeguardTwoTokenPool', event.args.pool);
  }

  describe('constructor arguments', () => {
    let pool: Contract;

    sharedBeforeEach(async () => {
      pool = await createPool({});
    });

    it('sets the vault', async () => {
      expect(await pool.getVault()).to.equal(vault.address);
    });

    it('registers tokens in the vault', async () => {
      const poolId = await pool.getPoolId();
      const poolTokens = await vault.getPoolTokens(poolId);

      expect(poolTokens.tokens).to.have.members(tokens.addresses);
      expect(poolTokens.balances).to.be.zeros;
    });

    it('starts with no BPT', async () => {
      expect(await pool.totalSupply()).to.be.equal(0);
    });


    it('sets the pool parameters', async () => {
      const poolParams = await pool.getPoolParameters();
      expect(poolParams.maxPerfDev, "Wrong maxPerfDev").to.be.eq(maxPerfDev);
      expect(poolParams.maxTargetDev, "Wrong maxTargetDev").to.be.eq(maxTargetDev);
      expect(poolParams.maxPriceDev, "Wrong maxPriceDev").to.be.eq(maxPriceDev);
      expect(poolParams.perfUpdateInterval, "Wrong perfUpdateInterval").to.be.eq(perfUpdateInterval);
      // expect(poolParams.mustAllowlistLPs).to.be.eq(mustAllowlistLPs);
    });

    it('sets mustAllowlistLPs', async () => {
      expect(await pool.isAllowlistEnabled()).to.be.eq(mustAllowlistLPs);
    });

    it('sets the oracles parameters', async () => {
      const oracleParams = await pool.getOracleParams();
      oracleParams.forEach((oracleParam: any, index: number) => {
        expect(oracleParam.oracle).to.eq(oracles[index].address);
        expect(oracleParam.isStable).to.eq(false);
        expect(oracleParam.isFlexibleOracle).to.eq(false);
        expect(oracleParam.isPegged).to.eq(false);
        expect(oracleParam.priceScalingFactor).to.eq(fp(1));
      });
    });

    it('sets the asset managers to zero', async () => {
      await tokens.asyncEach(async (token) => {
        const poolId = await pool.getPoolId();
        const info = await vault.getPoolTokenInfo(poolId, token);
        expect(info.assetManager).to.equal(ZERO_ADDRESS);
      });
    });

    it('sets the owner to delegate owner', async () => {
      expect(await pool.getOwner()).to.equal(DELEGATE_OWNER);
    });

    it('sets the name', async () => {
      expect(await pool.name()).to.equal(NAME);
    });

    it('sets the symbol', async () => {
      expect(await pool.symbol()).to.equal(SYMBOL);
    });

    it('sets the decimals', async () => {
      expect(await pool.decimals()).to.equal(18);
    });
  });

  describe('peg state', () => {
    let pool: Contract;

    it('set peg state', async() => {
      pool = await createPool(
        {isStable0: true, isFlexibleOracle0: true, isStable1: true, isFlexibleOracle1: true, setPegStates: true}
      );
      const oracleParams = await pool.getOracleParams();
      oracleParams.forEach((oracleParam: any, index: number) => {
        expect(oracleParam.oracle).to.eq(oracles[index].address);
        expect(oracleParam.isStable).to.eq(true);
        expect(oracleParam.isFlexibleOracle).to.eq(true);
        expect(oracleParam.isPegged).to.eq(true);
        expect(oracleParam.priceScalingFactor).to.eq(fp(1));
      });
    });

    it('stable tokens with flexible oracles', async() => {
      pool = await createPool(
        {isStable0: true, isFlexibleOracle0: true, isStable1: true, isFlexibleOracle1: true, setPegStates: false}
      );
      const oracleParams = await pool.getOracleParams();
      oracleParams.forEach((oracleParam: any, index: number) => {
        expect(oracleParam.oracle).to.eq(oracles[index].address);
        expect(oracleParam.isStable).to.eq(true);
        expect(oracleParam.isFlexibleOracle).to.eq(true);
        expect(oracleParam.isPegged).to.eq(false);
        expect(oracleParam.priceScalingFactor).to.eq(fp(1));
      });
    });

  });

  describe('temporarily pausable', () => {
    it('pools have the correct window end times', async () => {
      const pool = await createPool({});
      const { pauseWindowEndTime, bufferPeriodEndTime } = await pool.getPausedState();

      expect(pauseWindowEndTime).to.equal(createTime.add(BASE_PAUSE_WINDOW_DURATION));
      expect(bufferPeriodEndTime).to.equal(createTime.add(BASE_PAUSE_WINDOW_DURATION + BASE_BUFFER_PERIOD_DURATION));
    });

    it('multiple pools have the same window end times', async () => {
      const firstPool = await createPool({});
      await advanceTime(BASE_PAUSE_WINDOW_DURATION / 3);
      const secondPool = await createPool({});

      const { firstPauseWindowEndTime, firstBufferPeriodEndTime } = await firstPool.getPausedState();
      const { secondPauseWindowEndTime, secondBufferPeriodEndTime } = await secondPool.getPausedState();

      expect(firstPauseWindowEndTime).to.equal(secondPauseWindowEndTime);
      expect(firstBufferPeriodEndTime).to.equal(secondBufferPeriodEndTime);
    });

    it('pools created after the pause window end date have no buffer period', async () => {
      await advanceTime(BASE_PAUSE_WINDOW_DURATION + 1);

      const pool = await createPool({});
      const { pauseWindowEndTime, bufferPeriodEndTime } = await pool.getPausedState();
      const now = await currentTimestamp();

      expect(pauseWindowEndTime).to.equal(now);
      expect(bufferPeriodEndTime).to.equal(now);
    });
  });
});
