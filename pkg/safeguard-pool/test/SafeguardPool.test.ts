import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Oracle from '@balancer-labs/v2-helpers/src/models/oracles/Oracle';
import OraclesDeployer from '@balancer-labs/v2-helpers/src/models/oracles/OraclesDeployer';
import SafeguardPool from '@balancer-labs/v2-helpers/src/models/pools/safeguard/SafeguardPool';
import { RawSafeguardPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/safeguard/types';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumberish, fp, bn, fromFp } from '@balancer-labs/v2-helpers/src/numbers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_UINT112, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { DAY, advanceToTimestamp, SECOND, advanceTime } from '@balancer-labs/v2-helpers/src/time';
import '@balancer-labs/v2-common/setupTests'
import VaultDeployer from '@balancer-labs/v2-helpers/src/models/vault/VaultDeployer';
import { calcYearlyRate, calcAccumulatedManagementFees } from '@balancer-labs/v2-helpers/src/models/pools/safeguard/math'
import { expectEqualWithError, expectRelativeErrorBN } from '@balancer-labs/v2-helpers/src/test/relativeError'
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';

let vault: Vault;
let tokens: TokenList;
let oracles: Oracle[];
let deployer: SignerWithAddress, 
  lp: SignerWithAddress,
  owner: SignerWithAddress,
  recipient: SignerWithAddress,
  admin: SignerWithAddress,
  signer: SignerWithAddress,
  other: SignerWithAddress,
  trader: SignerWithAddress;

let maxPerfDev: BigNumberish;
let maxTargetDev: BigNumberish;
let maxPriceDev: BigNumberish;
let perfUpdateInterval: BigNumberish;
let yearlyFees: BigNumberish;
let mustAllowlistLPs: boolean;

const chainId = 31337;
const ORACLE_DECIMALS = [8, 12]
const initialBalancesNumber = [15, 20];
let initialBalances: BigNumber[];
const initPrices = [1, 3];
const tolerance = fp(1e-9);
const lowTolerance = fp(1e-17);

describe('SafeguardPool', function () {

  before('setup signers and tokens', async () => {
    [deployer, lp, owner, recipient, admin, signer, other, trader] = await ethers.getSigners();
    tokens = await TokenList.create([{decimals: 7}, {decimals: 0}], { sorted: false, varyDecimals: true });
    initialBalances = [
      fp(initialBalancesNumber[0]).mul(bn(10).pow(tokens.tokens[0].decimals)).div(fp(1)),
      fp(initialBalancesNumber[1]).mul(bn(10).pow(tokens.tokens[1].decimals)).div(fp(1))
    ]
  });

  let pool: SafeguardPool;

  sharedBeforeEach('deploy pool', async () => {
    vault = await VaultDeployer.deploy({mocked: false});
  
    await tokens.mint({ to: deployer, amount: fp(1000) });
    await tokens.approve({to: vault, amount: fp(1000), from: deployer});

    oracles = [
      await OraclesDeployer.deployOracle({
        description: "low price",
        price: initPrices[0],
        decimals: ORACLE_DECIMALS[0]
      }),
      await OraclesDeployer.deployOracle({
        description: "high price",
        price: initPrices[1],
        decimals: ORACLE_DECIMALS[1]
      })
    ];

    maxPerfDev = fp(0.95);
    maxTargetDev = fp(0.85);
    maxPriceDev = fp(0.97);
    perfUpdateInterval = 1 * DAY;
    yearlyFees = 0;
    mustAllowlistLPs = false;

    let poolConstructor: RawSafeguardPoolDeployment = {
      tokens: tokens,
      vault: vault,
      oracles: oracles,
      signer: signer,
      maxPerfDev: maxPerfDev,
      maxTargetDev: maxTargetDev,
      maxPriceDev: maxPriceDev,
      perfUpdateInterval: perfUpdateInterval,
      yearlyFees: yearlyFees,
      mustAllowlistLPs: mustAllowlistLPs,
      owner: owner
    };

    pool = await SafeguardPool.create(poolConstructor);
  });

  describe('Creation', () => {
    context('when the creation succeeds', () => {

      it('sets the name', async () => {
        expect(await pool.name()).to.equal('Pool Safeguard');
      });

      it('sets the symbol', async () => {
        expect(await pool.symbol()).to.equal('SPT');
      });

      it('sets the decimals', async () => {
        expect(await pool.decimals()).to.equal(18);
      });

      it('sets the owner ', async () => {
        expect(await pool.getOwner()).to.equal(owner.address);
      });

      it('sets the vault correctly', async () => {
        expect(await pool.getVault()).to.equal(pool.vault.address);
      });

      it('uses two token pool specialization', async () => {
        const { address, specialization } = await pool.getRegisteredInfo();

        expect(address).to.equal(pool.address);
        expect(specialization).to.equal(PoolSpecialization.TwoTokenPool);
      });

      it('registers tokens in the vault', async () => {
        const { tokens: poolTokens, balances } = await pool.getTokens();

        expect(poolTokens).to.have.lengthOf(oracles.length);
        expect(poolTokens).to.include.members(tokens.addresses);
        expect(balances).to.be.zeros;
      });

      it('starts with 0 SPT', async () => {
        expect(await pool.totalSupply()).to.be.zero;
      });
      
      it('sets pool parameters correctly', async () => {
        const poolParams = await pool.instance.getPoolParameters();
        expect(poolParams.maxPerfDev, "Wrong maxPerfDev").to.be.eq(maxPerfDev);
        expect(poolParams.maxTargetDev, "Wrong maxTargetDev").to.be.eq(maxTargetDev);
        expect(poolParams.maxPriceDev, "Wrong maxPriceDev").to.be.eq(maxPriceDev);
        expect(poolParams.perfUpdateInterval, "Wrong perfUpdateInterval").to.be.eq(perfUpdateInterval);
      });

      it('sets mustAllowList correctly', async () => {
        expect(await pool.instance.isAllowlistEnabled()).to.be.eq(mustAllowlistLPs);
      });

      it('sets management fees correctly', async () => {
        const [yearlyFees, yearlyRate, previousClaimTime] = await pool.instance.getManagementFeesParams(); 
        expect(yearlyFees).to.be.zero;
        expect(yearlyRate).to.be.zero;
        const lastBlock = await ethers.provider.getBlockNumber();
        const lastBlockTimestamp = (await ethers.provider.getBlock(lastBlock)).timestamp;
        expect(previousClaimTime).be.equal(lastBlockTimestamp);
      });

      it('sets the oracles parameters correctly', async () => {
        const oracleParams = await pool.instance.getOracleParams();
        oracleParams.forEach((oracleParam: any, index: number) => {
          expect(oracleParam.oracle).to.eq(oracles[index].address);
          expect(oracleParam.isStable).to.eq(true);
          expect(oracleParam.isFlexibleOracle).to.eq(false);
          expect(oracleParam.isPegged).to.eq(false);
          expect(oracleParam.priceScalingFactor).to.eq(fp(10 ** (18 - oracles[index].decimals)));
        });
      });
    });
  });

  describe('Initialize', () => {
    
    context('when not initialized', () => {
      context('when not paused', () => {
        it('transfers the initial balances to the vault', async () => {
          const previousBalances = await tokens.balanceOf(pool.vault);

          await pool.init({ initialBalances, recipient: lp });
          
          const currentBalances = await tokens.balanceOf(pool.vault);
          currentBalances.forEach((currentBalance, i) => {
            const initialBalanceIndex = i; // initial balances includes BPT
            const expectedBalance = previousBalances[i].add(initialBalances[initialBalanceIndex]);
            expect(currentBalance).to.be.equal(expectedBalance);
          });
        });

        it('mints 100 BPT', async () => {
          await pool.init({ initialBalances, recipient: lp });
          expect(await pool.totalSupply()).to.be.equal(fp(100));
        });

        it('mints the minimum BPT to the address zero', async () => {
          const minimumBpt = await pool.instance.getMinimumBpt();

          await pool.init({ initialBalances, recipient: lp });

          expect(await pool.balanceOf(ZERO_ADDRESS)).to.be.equal(minimumBpt);
        });

        it('reverts with invalid initial balances', async () => {
          await expect(pool.init({ recipient, initialBalances: [fp(1)] })).to.be.revertedWith(
            'BAL#524'
          );
        });
      });

      context('when paused', () => {
        sharedBeforeEach('pause pool', async () => {
          await pool.pause();
        });

        it('reverts', async () => {
          await expect(pool.init({ initialBalances, recipient: lp })).to.be.revertedWith('BAL#402');
        });
      });

      context('in recovery mode', () => {
        sharedBeforeEach('enable recovery mode', async () => {
          await pool.enableRecoveryMode(admin);
        });

        it('does not revert', async () => {
          await expect(pool.init({ initialBalances, recipient: lp })).to.not.be.reverted;
        });
      });
    });

    context('when it was already initialized', () => {
      sharedBeforeEach('init pool', async () => {
        await pool.init({ initialBalances, recipient: lp });
      });

      it('initial balances are correct', async () => {        
        const currentBalances = await pool.getBalances();
        for(let i = 0; i < currentBalances.length; i++){
          expect(currentBalances[i]).to.be.equal(initialBalances[i]);
        }
      });
      
      it('initial hodl balances are correct', async () => {        
        const hodlBalancesPerPT: BigNumberish[] = await pool.instance.getHodlBalancesPerPT();
        for(let i = 0; i < initialBalances.length; i++){
          expect(hodlBalancesPerPT[i]).to.be.equal(initialBalances[i].mul(bn(10).pow(18-tokens.tokens[i].decimals)).div(bn(100)));
        }
      });

      it('reverts', async () => {
        await expect(pool.init({ initialBalances, recipient: lp })).to.be.revertedWith('BAL#310');
      });
    });
  });

  describe('Post-init', () => {

    sharedBeforeEach('init pool', async () => {
      await pool.init({ initialBalances, recipient: lp });
    });

    describe('Join/Exit', () => {

      let tokenIndex: number;
      let token: Token;
      
      context('generic', () => {
        sharedBeforeEach('allow vault', async () => {
          await tokens.mint({ to: recipient, amount: fp(100) });
          await tokens.approve({ from: recipient, to: pool.vault });
        });

        sharedBeforeEach('get token to join with', async () => {
          // tokens are sorted, and do not include BPT, so get the last one
          tokenIndex = Math.floor(Math.random() * tokens.length);
          token = tokens.get(tokenIndex);
        });

        it('fails if caller is not the vault', async () => {
          await expect(
            pool.instance.connect(lp).onJoinPool(pool.poolId, lp.address, other.address, [0], 0, 0, '0x')
          ).to.be.revertedWith('BAL#205');
        });

        it('fails if no user data', async () => {
          await expect(pool.join({ data: '0x' })).to.be.reverted;
        });

        it('fails if wrong user data', async () => {
          const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);
          await expect(pool.join({ data: wrongUserData })).to.be.reverted;
        });

      });

      context('joinAllGivenOut', () => {

        const bptOut: BigNumber = fp(10);
        let lpBalanceBefore: BigNumber

        sharedBeforeEach('set', async () => {
          lpBalanceBefore = await pool.balanceOf(lp.address); 
        });

        describe('when paused', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.pause();
          });
          it('reverts', async () => {
            await expect(
              pool.joinAllGivenOut({
                bptOut: bptOut,
                from: deployer,
                recipient: lp
              })
            ).to.be.revertedWith('BAL#402');
          });
        });

        describe('when in recovery mode', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.enableRecoveryMode(admin);
          });
          it('valid', async () => {
            await pool.pause();
            await expect(
              pool.joinAllGivenOut({
                bptOut: bptOut,
                from: deployer,
                recipient: lp
              })
            ).to.be.revertedWith("BAL#402");
          });
        });

        describe('when in normal mode', () => {
          it('valid', async () => {
            const balance0 = await tokens.tokens[0].balanceOf(deployer);
            const balance1 = await tokens.tokens[1].balanceOf(deployer);
            const expectedBalances = [balance0, balance1].map((currentBalance, index) => currentBalance.sub(initialBalances[index].mul(bptOut).div(fp(100))));
            await pool.joinAllGivenOut({
              bptOut: bptOut,
              from: deployer,
              recipient: lp
            })
            const lpBalanceAfter = await pool.balanceOf(lp.address);
            expect(lpBalanceAfter).to.be.equal(lpBalanceBefore.add(bptOut));
            const currentBalance0 = await tokens.tokens[0].balanceOf(deployer);
            const currentBalance1 = await tokens.tokens[1].balanceOf(deployer);
            expectEqualWithError(currentBalance0, expectedBalances[0], lowTolerance);
            expectEqualWithError(currentBalance1, expectedBalances[1], lowTolerance);
          });
        });
        
        describe('when in allowlist mode', () => {
          it('valid', async() => {
            const action = await actionId(pool.instance, 'setMustAllowlistLPs');
            await pool.vault.authorizer.connect(deployer).grantPermissions([action], deployer.address, [pool.address]);
            await pool.instance.setMustAllowlistLPs(true);
            await pool.joinAllGivenOut({
              bptOut: bptOut,
              from: deployer,
              recipient: lp,
              chainId: chainId,
              signer: signer
            })
            const lpBalanceAfter = await pool.balanceOf(lp.address);
            expect(lpBalanceAfter).to.be.equal(lpBalanceBefore.add(bptOut));
          });
        });
    
      });      
      
      context('joinGivenIn', () => {

        let amountsIn: BigNumber[];
        let lpBalanceBefore: BigNumber
        sharedBeforeEach('set', async () => {
          lpBalanceBefore = await pool.balanceOf(lp.address);
          amountsIn = [fp(2).mul(bn(10).pow(tokens.tokens[0].decimals)).div(fp(1)), fp(0.001).mul(bn(10).pow(tokens.tokens[1].decimals)).div(fp(1))];
        });

        describe('when paused', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.pause();
          });
          it('reverts', async () => {
            await expect(
              pool.joinGivenIn({
                recipient: lp.address,
                chainId: chainId,
                amountsIn: amountsIn,
                swapTokenIn: tokens.tokens[0],
                signer: signer
              })
            ).to.be.revertedWith('BAL#402');
          });
        });

        describe('when in recovery mode', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.enableRecoveryMode(admin);
          });
          it('valid', async () => {
            await pool.pause();
            await expect(
              pool.joinGivenIn({
                recipient: lp.address,
                chainId: chainId,
                amountsIn: amountsIn,
                swapTokenIn: tokens.tokens[0],
                signer: signer
              })
            ).to.be.revertedWith("BAL#402");
          });
        });

        describe('when in normal mode', () => {
          it('reverts: wrong excess token', async () => {
            await expect(pool.joinGivenIn({
              recipient: lp.address,
              chainId: chainId,
              amountsIn: amountsIn,
              swapTokenIn: tokens.tokens[1],
              signer: signer
            })).to.be.revertedWith("SWAAP#21");
          });
          
          it('valid', async () => {
            const currentBalances = await pool.getBalances();
            const expectedBalances = currentBalances.map((currentBalance, index) => currentBalance.add(amountsIn[index]));
            await pool.joinGivenIn({
              recipient: lp.address,
              chainId: chainId,
              amountsIn: amountsIn,
              swapTokenIn: tokens.tokens[0],
              signer: signer
            });
            const updatedBalances = await pool.getBalances();
            expectEqualWithError(updatedBalances[0], expectedBalances[0], lowTolerance);
            expectEqualWithError(updatedBalances[1], expectedBalances[1], lowTolerance);
          });
        });
      });
      
      context('exitGivenOut', () => {

        let amountsOut: BigNumber[]
        let lpBalanceBefore: BigNumber

        sharedBeforeEach('set', async () => {
          lpBalanceBefore = await pool.balanceOf(lp.address);
          amountsOut = [fp(1.1).mul(bn(10).pow(tokens.tokens[0].decimals)).div(fp(1)), fp(0.001).mul(bn(10).pow(tokens.tokens[1].decimals)).div(fp(1))];
        });

        describe('when paused', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.pause();
          });
          it('reverts', async () => {
            await expect(
              pool.exitGivenOut({
                from: lp,
                recipient: lp.address,
                chainId: chainId,
                amountsOut: amountsOut,
                swapTokenIn: tokens.tokens[1],
                signer: signer
              })
            ).to.be.revertedWith('BAL#402');
          });
        });

        describe('when in recovery mode', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.enableRecoveryMode(admin);
          });
          it('valid', async () => {
            await pool.pause();
            await expect(
              pool.exitGivenOut({
                from: lp,
                recipient: lp.address,
                chainId: chainId,
                amountsOut: amountsOut,
                swapTokenIn: tokens.tokens[1],
                signer: signer
              })
            ).to.be.revertedWith("BAL#402");
          });
        });

        describe('when in normal mode', () => {
          it('reverts: wrong excess token', async () => {
            await expect(pool.exitGivenOut({
              from: lp,
              recipient: lp.address,
              chainId: chainId,
              amountsOut: amountsOut,
              swapTokenIn: tokens.tokens[0],
              signer: signer
            })).to.be.revertedWith("SWAAP#22");
          });

          it('valid', async () => {
            const currentBalances = await pool.getBalances();
            const expectedBalances = currentBalances.map((currentBalance, index) => currentBalance.sub(amountsOut[index]));
            await pool.exitGivenOut({
              from: lp,
              recipient: lp.address,
              chainId: chainId,
              amountsOut: amountsOut,
              swapTokenIn: tokens.tokens[1],
              signer: signer
            });
            const updatedBalances = await pool.getBalances();
            expectEqualWithError(updatedBalances[0], expectedBalances[0], lowTolerance);
            expectEqualWithError(updatedBalances[1], expectedBalances[1], lowTolerance);
          });
        });
      });

      context('multiExitGivenIn', () => {

        const bptIn: BigNumber = fp(10);
        let lpBalanceBefore: BigNumber

        sharedBeforeEach('set', async () => {
          lpBalanceBefore = await pool.balanceOf(lp.address);
        });

        describe('when paused', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.pause();
          });
          it('reverts', async () => {
            await expect(
              pool.multiExitGivenIn({
                bptIn: bptIn,
                from: lp,
                recipient: lp
              })
            ).to.be.revertedWith('BAL#402');
          });
        });

        describe('when in recovery mode', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.enableRecoveryMode(admin);
          });
          it('valid', async () => {
            await pool.pause();
            await expect(
              pool.multiExitGivenIn({
                bptIn: bptIn,
                from: lp,
                recipient: lp
              })
            ).to.be.revertedWith("BAL#402");
          });
        });

        describe('when in normal mode', () => {
          it('valid', async () => {
            await pool.multiExitGivenIn({
              bptIn: bptIn,
              from: lp,
              recipient: lp
            });
            const lpBalanceAfter = await pool.balanceOf(lp.address);
            expect(lpBalanceAfter).to.be.equal(lpBalanceBefore.sub(bptIn));
          });
        });
      });
    
    });
      
    describe('Swap', () => {
      
      context('swapGivenIn', () => {

        const inIndex = 0;
        const outIndex = inIndex == 0? 1 : 0;
        let amountIn: BigNumber
        
        sharedBeforeEach('setting amount', async () => {
          amountIn = fp(1.5).mul(bn(10).pow(tokens.tokens[inIndex].decimals)).div(fp(1));
        });
        
        it('onSwap fails on a regular swap if caller is not the vault', async () => {
          const swapRequest = {
            kind: 0,
            tokenIn: tokens.first.address,
            tokenOut: tokens.get(1).address,
            amount: amountIn,
            poolId: pool.poolId,
            lastChangeBlock: 0,
            from: lp.address,
            to: lp.address,
            userData: '0x',
          };
          await expect(pool.instance.connect(lp).onSwap(swapRequest, initialBalances[0], initialBalances[1])).to.be.revertedWith(
            'BAL#205'
          );
        });

        describe('when paused', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.pause();
          });
          it('reverts', async () => {
            await expect(
              pool.swapGivenIn({
                chainId: chainId,
                in: inIndex,
                out: outIndex,
                amount: amountIn,
                signer: signer,
                from: deployer,
                recipient: lp.address
              })
            ).to.be.revertedWith('BAL#402');
          });
        });

        describe('when in recovery mode', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.enableRecoveryMode(admin);
          });
          it('valid', async () => {
            await expect(
              pool.swapGivenIn({
                chainId: chainId,
                in: inIndex,
                out: outIndex,
                amount: amountIn,
                signer: signer,
                from: deployer,
                recipient: lp.address
              })
            ).not.to.be.reverted;
          });
        });

        describe('when in normal mode', () => {
          it('valid', async () => {
            const currentBalances = await pool.getBalances();
            const expectedBalanceIn = currentBalances[inIndex].add(amountIn);
            await pool.swapGivenIn({
              chainId: chainId,
              in: inIndex,
              out: outIndex,
              amount: amountIn,
              signer: signer,
              from: deployer,
              recipient: lp.address
            });
            const updatedBalances = await pool.getBalances();
            expect(updatedBalances[inIndex]).to.be.equal(expectedBalanceIn)
          });
        });
      });

      context('swapGivenOut', () => {

        const inIndex = 0;
        const outIndex = inIndex == 0? 1 : 0;
        let amountOut: BigNumber
        
        sharedBeforeEach('setting amount', async () => {
          amountOut = fp(1.5).mul(bn(10).pow(tokens.tokens[outIndex].decimals)).div(fp(1));
        });
        
        it('onSwap fails on a regular swap if caller is not the vault', async () => {
          const swapRequest = {
            kind: 1,
            tokenIn: tokens.first.address,
            tokenOut: tokens.get(1).address,
            amount: amountOut,
            poolId: pool.poolId,
            lastChangeBlock: 0,
            from: lp.address,
            to: lp.address,
            userData: '0x',
          };
          await expect(pool.instance.connect(lp).onSwap(swapRequest, initialBalances[0], initialBalances[1])).to.be.revertedWith(
            'BAL#205'
          );
        });

        describe('when paused', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.pause();
          });
          it('reverts', async () => {
            await expect(
              pool.swapGivenOut({
                chainId: chainId,
                in: inIndex,
                out: outIndex,
                amount: amountOut,
                signer: signer,
                from: deployer,
                recipient: lp.address
              })
            ).to.be.revertedWith('BAL#402');
          });
        });

        describe('when in recovery mode', () => {
          sharedBeforeEach('Signature Safeguards', async () => {
            await pool.enableRecoveryMode(admin);
          });
          it('valid', async () => {
            await expect(
              pool.swapGivenOut({
                chainId: chainId,
                in: inIndex,
                out: outIndex,
                amount: amountOut,
                signer: signer,
                from: deployer,
                recipient: lp.address
              })
            ).not.to.be.reverted;
          });
        });

        describe('when in normal mode', () => {
          it('valid', async () => {
            const currentBalances = await pool.getBalances();
            const expectedBalanceOut = currentBalances[outIndex].sub(amountOut);
            await pool.swapGivenOut({
              chainId: chainId,
              in: inIndex,
              out: outIndex,
              amount: amountOut,
              signer: signer,
              from: deployer,
              recipient: lp.address
            });
            const updatedBalances = await pool.getBalances();
            expect(updatedBalances[outIndex]).to.be.equal(expectedBalanceOut)
          });
        });
      });

      context('Detailed Swap', () => {
        
        const inIndex = 0;
        const outIndex = inIndex == 0? 1 : 0;

        it('Swap given in', async () => {

          const startBlock = await ethers.provider.getBlockNumber();
          const startBlockTimestamp = (await ethers.provider.getBlock(startBlock)).timestamp;
          
          const currentBalances = await pool.getBalances();

          const amountInNum = 3
          const amountIn = fp(amountInNum).mul(bn(10).pow(tokens.tokens[inIndex].decimals)).div(fp(1));
          const amount = amountIn

          await tokens.mint({ to: trader, amount: fp(1000) });
          await tokens.approve({to: vault, amount: fp(1000), from: trader});

          const amountInPerOut = await pool.getAmountInPerOut(inIndex)
          const expectedAmountOut = amountIn.mul(fp(1)).div(amountInPerOut)
          
          const startTime = startBlockTimestamp
          const timeBasedSlippage = 0.0001
          const originBasedSlippage = 0.0005

          let swapInput = {
            chainId: chainId,
            in: inIndex,
            out: outIndex,
            amount: amount,
            recipient: trader.address,
            from: trader,
            deadline: startBlockTimestamp + 100000,
            maxSwapAmount: fp(amountInNum),
            quoteAmountInPerOut:amountInPerOut,
            maxBalanceChangeTolerance: fp(0.075),
            quoteBalanceIn: currentBalances[inIndex],
            quoteBalanceOut: currentBalances[outIndex],
            balanceBasedSlippage: fp(0.0002),
            startTime: startTime,
            timeBasedSlippage: fp(timeBasedSlippage),
            signer: signer,
            expectedOrigin: ZERO_ADDRESS,
            originBasedSlippage: fp(originBasedSlippage),
          }
          
          const expectedPoolBalanceIn = currentBalances[inIndex].add(amountIn);
          
          const startUserBalanceIn = await tokens.tokens[inIndex].balanceOf(trader);
          const startUserBalanceOut = await tokens.tokens[outIndex].balanceOf(trader);
          
          await pool.swapGivenIn(swapInput) // swap execution

          const endPoolBalances = await pool.getBalances();
          
          const endUserBalanceIn = await tokens.tokens[inIndex].balanceOf(trader);
          const endUserBalanceOut = await tokens.tokens[outIndex].balanceOf(trader);

          const endBlock = await ethers.provider.getBlockNumber();
          const endBlockTimestamp: number = (await ethers.provider.getBlock(endBlock)).timestamp;

          var penalty = 1
          penalty += timeBasedSlippage * (endBlockTimestamp - startBlockTimestamp)
          penalty += originBasedSlippage
          
          const reducedAmountOut = expectedAmountOut.mul(fp(1)).div(fp(penalty))

          expect(endPoolBalances[inIndex]).to.be.eq(expectedPoolBalanceIn)
          expect(endUserBalanceIn).to.be.eq(startUserBalanceIn.sub(amountIn))
          expectRelativeErrorBN(endUserBalanceOut, startUserBalanceOut.add(reducedAmountOut), tolerance)
        });

        it('Swap given out', async () => {

          const startBlock = await ethers.provider.getBlockNumber();
          const startBlockTimestamp = (await ethers.provider.getBlock(startBlock)).timestamp;
          
          const currentBalances = await pool.getBalances();

          const amountOutNum = 1
          const amountOut = fp(amountOutNum).mul(bn(10).pow(tokens.tokens[outIndex].decimals)).div(fp(1));
          const amount = amountOut

          await tokens.mint({ to: trader, amount: fp(1000) });
          await tokens.approve({to: vault, amount: fp(1000), from: trader});

          const amountInPerOut = await pool.getAmountInPerOut(inIndex)
          const expectedAmountIn = amountOut.mul(amountInPerOut).div(fp(1))

          const startTime = startBlockTimestamp
          const timeBasedSlippage = 0.0001
          const originBasedSlippage = 0.0005

          let swapInput = {
            chainId: chainId,
            in: inIndex,
            out: outIndex,
            amount: amount,
            recipient: trader.address,
            from: trader,
            deadline: startBlockTimestamp + 100000,
            maxSwapAmount: fp(amountOutNum),
            quoteAmountInPerOut:amountInPerOut,
            maxBalanceChangeTolerance: fp(0.075),
            quoteBalanceIn: currentBalances[inIndex],
            quoteBalanceOut: currentBalances[outIndex],
            balanceBasedSlippage: fp(0.0002),
            startTime: startTime,
            timeBasedSlippage: fp(timeBasedSlippage),
            signer: signer,
            expectedOrigin: ZERO_ADDRESS,
            originBasedSlippage: fp(originBasedSlippage),
          }
          
          const expectedPoolBalanceOut = currentBalances[outIndex].sub(amountOut);
          
          const startUserBalanceIn = await tokens.tokens[inIndex].balanceOf(trader);
          const startUserBalanceOut = await tokens.tokens[outIndex].balanceOf(trader);
          
          await pool.swapGivenOut(swapInput) // swap execution

          const endPoolBalances = await pool.getBalances();
          
          const endUserBalanceIn = await tokens.tokens[inIndex].balanceOf(trader);
          const endUserBalanceOut = await tokens.tokens[outIndex].balanceOf(trader);

          const endBlock = await ethers.provider.getBlockNumber();
          const endBlockTimestamp: number = (await ethers.provider.getBlock(endBlock)).timestamp;

          var penalty = 1
          penalty += timeBasedSlippage * (endBlockTimestamp - startBlockTimestamp)
          penalty += originBasedSlippage
          
          const increasedAmountIn = expectedAmountIn.mul(fp(penalty)).div(fp(1))

          expect(endPoolBalances[outIndex]).to.be.eq(expectedPoolBalanceOut)
          expectRelativeErrorBN(endUserBalanceIn, startUserBalanceIn.sub(increasedAmountIn), tolerance)
          expect(endUserBalanceOut).to.be.eq(startUserBalanceOut.add(amountOut))

        });
      });
    });

    describe('Protocol Fees', () => {

      for (let i=1; i < 11; i++) { 
        const window = (i * 1.5) * 365 * DAY
        it (`Management Fees: ${window}s`, async () => {
          
          const yearlyFees = 3 / 100

          const bptIn = fp(1);

          const action = await actionId(pool.instance, 'setManagementFees');
          await pool.vault.authorizer.connect(deployer).grantPermissions([action], deployer.address, [pool.address]);
          await pool.setManagementFees(deployer, fp(yearlyFees))
          let block = await ethers.provider.getBlockNumber();
          const managementFeesInitTimestmap = (await ethers.provider.getBlock(block)).timestamp;

          const collector = (await pool.vault.getFeesCollector()).address

          const totalSupply = await pool.totalSupply();

          await advanceToTimestamp((await ethers.provider.getBlock(block)).timestamp + window);
          const exitResultBis = await pool.multiExitGivenIn({
            bptIn: bptIn,
            from: lp,
            recipient: lp
          });

          block = await ethers.provider.getBlockNumber();
          const currentTimestamp = (await ethers.provider.getBlock(block)).timestamp;

          const expected = fp(
            calcAccumulatedManagementFees(
              (currentTimestamp - managementFeesInitTimestmap) * SECOND,
              calcYearlyRate(yearlyFees),
              totalSupply.div(fp(1)).toNumber()
            )
          )
          expect(exitResultBis.receipt.events != undefined, "empty events")

          const firstEvent = exitResultBis.receipt.events![0]
          try {
            expect(firstEvent.topics[0]).to.be.eq("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") // Transfer(address,address,uint256)
            expect(firstEvent.topics[1]).to.be.eq("0x0000000000000000000000000000000000000000000000000000000000000000") // from
            expect("0x"+firstEvent.topics[2].slice(26)).to.be.eq(collector.toLowerCase()) // to
            expectRelativeErrorBN(BigNumber.from(firstEvent.data), expected, tolerance)
          } catch(e) {
            throw e;
          }

        });
      };
    });

    describe('Setters / Getters', () => {

      context('Unauthorized caller', () => {
        it('Fail to call setFlexibleOracleStates', async () => {
          await expect(pool.instance.setFlexibleOracleStates(true, true)).to.be.revertedWith("BAL#401");
        });
        it('Fail to call setMustAllowlistLPs', async () => {
          await expect(pool.instance.setMustAllowlistLPs(true)).to.be.revertedWith("BAL#401");
        });
        it('Fail to call setSigner', async () => {
          await expect(pool.instance.setSigner(trader.address)).to.be.revertedWith("BAL#401");
        });
        it('Fail to call setPerfUpdateInterval', async () => {
          await expect(pool.instance.setPerfUpdateInterval(1)).to.be.revertedWith("BAL#401");
        });
        it('Fail to call setMaxPerfDev', async () => {
          await expect(pool.instance.setMaxPerfDev(1)).to.be.revertedWith("BAL#401");
        });
        it('Fail to call setMaxPriceDev', async () => {
          await expect(pool.instance.setMaxPriceDev(1)).to.be.revertedWith("BAL#401");
        });
        it('Fail to call setMaxTargetDev', async () => {
          await expect(pool.instance.setMaxTargetDev(1)).to.be.revertedWith("BAL#401");
        });
        it('Fail to call setManagementFees', async () => {
          await expect(pool.instance.setManagementFees(1)).to.be.revertedWith("BAL#401");
        });
      })

      context('when paused', async() => {
        let actionsId: any;

        before('Get action Ids', async () => {
          const actions = ["setFlexibleOracleStates", "setMustAllowlistLPs","setSigner","setPerfUpdateInterval",
          "setMaxPerfDev", "setMaxPriceDev", "setMaxTargetDev", "setManagementFees"];
          actionsId = await Promise.all(actions.map(async(action) => await actionId(pool.instance, action)));
        });
 
        beforeEach('Grant permissions and update all pool parameters', async () => {
          await pool.pause();
          await pool.vault.authorizer.connect(deployer).grantPermissions(actionsId, deployer.address, actionsId.map(() => pool.address));
        });

        it('Fail to call setFlexibleOracleStates', async () => {
          await expect(pool.instance.setFlexibleOracleStates(true, true)).to.be.revertedWith("BAL#402");
        });
        it('Fail to call setMustAllowlistLPs', async () => {
          await expect(pool.instance.setMustAllowlistLPs(true)).to.be.revertedWith("BAL#402");
        });
        it('Fail to call setSigner', async () => {
          await expect(pool.instance.setSigner(deployer.address)).to.be.revertedWith("BAL#402");
        });
        it('Fail to call setPerfUpdateInterval', async () => {
          await expect(pool.instance.setPerfUpdateInterval(1)).to.be.revertedWith("BAL#402");
        });
        it('Fail to call setMaxPerfDev', async () => {
          await expect(pool.instance.setMaxPerfDev(1)).to.be.revertedWith("BAL#402");
        });
        it('Fail to call setMaxPriceDev', async () => {
          await expect(pool.instance.setMaxPriceDev(1)).to.be.revertedWith("BAL#402");
        });
        it('Fail to call setMaxTargetDev', async () => {
          await expect(pool.instance.setMaxTargetDev(1)).to.be.revertedWith("BAL#402");
        });
        it('Fail to call setManagementFees', async () => {
          await expect(pool.instance.setManagementFees(1)).to.be.revertedWith("BAL#402");
        });
        it('Fail to call claimManagementFees', async () => {
          await expect(pool.instance.claimManagementFees()).to.be.revertedWith("BAL#402");
        });
        it('Fail to call updatePerformance', async () => {
          await expect(pool.instance.updatePerformance()).to.be.revertedWith("BAL#402");
        });
        it('Fail to call evaluateStablesPegStates', async () => {
          await expect(pool.instance.evaluateStablesPegStates()).to.be.revertedWith("BAL#402");
        });
      });

      context('Correctly set values wihtout affecting others params', () => {

        let expSigner: any, expMaxPerfDev: any, expMaxTargetDev: any, expMaxPriceDev: any,
          expLastPerfUpdate: any, expPerfUpdateInterval: any, expYearlyFees: any, expYearlyRate: any,
          expPreviousClaimTime: any;
        
        let actSigner: any, actMaxPerfDev: any, actMaxTargetDev: any, actMaxPriceDev: any,
          actLastPerfUpdate: any, actPerfUpdateInterval: any, actYearlyFees: any, actYearlyRate: any,
          actPreviousClaimTime: any;
        
        type OracleParams = {
          oracle: string,
          isStable: boolean,
          isFlexibleOracle: boolean,
          isPegged: boolean,
          priceScalingFactor: BigNumberish
        }

        let expOracleParams : Array<OracleParams>;
        let actOracleParams : Array<OracleParams>;

        let expMustAllowlistLPs: boolean, actMustAllowlistLPs: boolean;
        
        let expHodlBalancesPerPt: Array<BigNumber>,  actHodlBalancesPerPt: Array<BigNumber>; 

        const deepCopyArray = <T>(arr: Array<T>): Array<T> => {
          return JSON.parse(JSON.stringify(arr));
        };
        
        async function updateAllParameters() {
          // update expected values
          actMustAllowlistLPs = await pool.instance.isAllowlistEnabled();
          [actMaxPerfDev, actMaxTargetDev, actMaxPriceDev, actLastPerfUpdate, actPerfUpdateInterval] = await pool.instance.getPoolParameters();
          [actYearlyFees, actYearlyRate, actPreviousClaimTime] = await pool.instance.getManagementFeesParams();
          actOracleParams = await pool.instance.getOracleParams();
          actSigner = await pool.instance.callStatic.signer();
          actHodlBalancesPerPt = await pool.instance.getHodlBalancesPerPT();
        }

        async function resetExpectParameters() {
          await updateAllParameters();
          // setup actual values
          expect(actMaxTargetDev).to.be.equal(fp(0.85));
          expMustAllowlistLPs = actMustAllowlistLPs;
          expSigner = actSigner;
          expMaxPerfDev = actMaxPerfDev;
          expMaxTargetDev = actMaxTargetDev;
          expMaxPriceDev = actMaxPriceDev;
          expLastPerfUpdate = actLastPerfUpdate;
          expPerfUpdateInterval = actPerfUpdateInterval;
          expYearlyFees = actYearlyFees;
          expYearlyRate = actYearlyRate;
          expPreviousClaimTime = actPreviousClaimTime;
          expOracleParams = deepCopyArray(actOracleParams);
          expHodlBalancesPerPt = actHodlBalancesPerPt;
        }

        async function compareParameters() {          
          expect(actMustAllowlistLPs).to.be.equal(expMustAllowlistLPs);
          expect(actMaxPerfDev).to.be.equal(expMaxPerfDev);
          expect(actMaxTargetDev).to.be.equal(expMaxTargetDev);
          expect(actMaxPriceDev).to.be.equal(expMaxPriceDev);
          expect(actLastPerfUpdate).to.be.equal(expLastPerfUpdate);
          expect(actPerfUpdateInterval).to.be.equal(expPerfUpdateInterval);
          expect(actYearlyFees).to.be.equal(expYearlyFees);
          expectEqualWithError(actYearlyRate, expYearlyRate, tolerance);
          expect(actPreviousClaimTime).to.be.equal(expPreviousClaimTime);
          expect(JSON.stringify(actOracleParams)).to.be.equal(JSON.stringify(expOracleParams));
        }

        let actionsId: any;

        before('Get action Ids', async () => {
          const actions = ["setFlexibleOracleStates", "setMustAllowlistLPs","setSigner","setPerfUpdateInterval",
          "setMaxPerfDev", "setMaxPriceDev", "setMaxTargetDev", "setManagementFees"];
          actionsId = await Promise.all(actions.map(async(action) => await actionId(pool.instance, action)));
          
        });
 
        beforeEach('Grant permissions and update all pool parameters', async () => {
          await pool.vault.authorizer.connect(deployer).grantPermissions(actionsId, deployer.address, actionsId.map(() => pool.address));
          await resetExpectParameters();
        });

        afterEach('Compare actual parameters to expected ones', async () => {
          await updateAllParameters();
          await compareParameters();
        });

        it('valid setFlexibleOracleStates', async () => {
          // only change one state
          expOracleParams[0].isFlexibleOracle = actOracleParams[0].isFlexibleOracle;
          expOracleParams[1].isFlexibleOracle = !actOracleParams[1].isFlexibleOracle;
          await pool.instance.setFlexibleOracleStates(actOracleParams[0].isFlexibleOracle, actOracleParams[1].isFlexibleOracle);
        });

        it('valid setMustAllowlistLPs', async () => {
          expMustAllowlistLPs = !actMustAllowlistLPs;
          await pool.instance.setMustAllowlistLPs(expMustAllowlistLPs);;
        });

        it('valid setSigner', async () => {
          expSigner = other.address;
          await pool.instance.setSigner(expSigner);
        });

        it('valid setPerfUpdateInterval', async () => {
          expPerfUpdateInterval = 1.5 * DAY;
          await pool.instance.setPerfUpdateInterval(expPerfUpdateInterval);
        });

        it('valid setMaxPerfDev', async () => {
          expMaxPerfDev = fp(1);
          await pool.instance.setMaxPerfDev(expMaxPerfDev);
        });

        it('valid setMaxTargetDev', async () => {
          expMaxTargetDev = fp(1);
          await pool.instance.setMaxTargetDev(expMaxTargetDev);
        });

        it('valid setMaxPriceDev', async () => {
          expMaxPriceDev = fp(1);
          await pool.instance.setMaxPriceDev(expMaxPriceDev);
        });

        it('valid setManagementFees', async () => {
          const fees = 0.025;
          expYearlyFees = fp(fees);
          expYearlyRate = fp(calcYearlyRate(fees)); // 
          let tx = await pool.setManagementFees(deployer, expYearlyFees);
          expPreviousClaimTime = (await ethers.provider.getBlock(tx.blockNumber)).timestamp;
        });

        it('valid claimManagementFees', async () => {
          const tx = await pool.instance.claimManagementFees();
          expPreviousClaimTime = (await ethers.provider.getBlock(tx.blockNumber)).timestamp;
        });

        context('update performance', () => {
          it('cannot updatePerformance when last update is close', async () => {
            await expect(pool.instance.updatePerformance()).to.be.revertedWith("SWAAP#16");
          });

          it('update performance after 10% of balances', async () => {          
            const expectedPoolPerf = fp(1.1);
            let beforeBalances = await pool.getBalances();
            
            // add 10 % of balance with fake swaps
            await pool.swapGivenIn({
              chainId: chainId,
              in : 0,
              out: 1,
              amount: beforeBalances[0].div(10),
              quoteAmountInPerOut: MAX_UINT112,
              from: deployer,
              signer: signer
            });

            await pool.swapGivenIn({
              chainId: chainId,
              in : 1,
              out: 0,
              amount: beforeBalances[1].div(10),
              quoteAmountInPerOut: MAX_UINT112,
              from: deployer,
              signer: signer 
            });

            await advanceTime(2 * DAY);
            const actualPoolPerf = await pool.instance.getPoolPerformance();
            expectEqualWithError(actualPoolPerf, expectedPoolPerf, lowTolerance);
            const tx = await pool.instance.updatePerformance();
            expHodlBalancesPerPt = actHodlBalancesPerPt.map((balance) => balance.mul(actualPoolPerf).div(fp(1)));            
            expLastPerfUpdate = (await ethers.provider.getBlock(tx.blockNumber)).timestamp;
          });

          it('update performance after 10% of TVL', async () => {          
            const expectedPoolPerf = fp(1.1);
            let beforeBalances = await pool.getBalances();
            
            // add 10 % of amount0 with fake swap
            await pool.swapGivenIn({
              chainId: chainId,
              in : 0,
              out: 1,
              amount: beforeBalances[0].div(10),
              quoteAmountInPerOut: MAX_UINT112,
              from: deployer,
              signer: signer
            });

            // set price of token 1 to almost 0
            await oracles[1].setPrice(bn(1));

            await advanceTime(2 * DAY);
            const actualPoolPerf = await pool.instance.getPoolPerformance();
            expectEqualWithError(actualPoolPerf, expectedPoolPerf, lowTolerance);
            const tx = await pool.instance.updatePerformance();
            expHodlBalancesPerPt = actHodlBalancesPerPt.map((balance) => balance.mul(actualPoolPerf).div(fp(1)));            
            expLastPerfUpdate = (await ethers.provider.getBlock(tx.blockNumber)).timestamp;
          });
  
        });
      });
         
      context('Oracle', () => {

        it('Revert if oracle price is zero', async() => {
          await oracles[1].setPrice(bn(0));
          await expect(pool.swapGivenIn({
            chainId: chainId,
            in : 0,
            out: 1,
            amount: fp(1),
            quoteAmountInPerOut: 1,
            from: deployer,
            signer: signer
          })).to.be.revertedWith("SWAAP#24");
        })

        describe('setFlexibleOracleStates', () => {

          [true, false].forEach(isFlexibleOracle0 => {
            [true, false].forEach(isFlexibleOracle1 => {
                it (`isFlexibleOracle0=${isFlexibleOracle0}, isFlexibleOracle1=${isFlexibleOracle1}`, async () => {
                  const action = await actionId(pool.instance, 'setFlexibleOracleStates');
                  await pool.vault.authorizer.connect(deployer).grantPermissions([action], deployer.address, [pool.address]);
                  await pool.setFlexibleOracleStates(
                    deployer,
                    isFlexibleOracle0,
                    isFlexibleOracle1
                  );
                  const params = await pool.getOracleParams();
                  expect(params[0].isFlexibleOracle).to.be.eq(isFlexibleOracle0)
                  expect(params[1].isFlexibleOracle).to.be.eq(isFlexibleOracle1)
                  if (!isFlexibleOracle0) {
                    expect(params[0].isPegged).to.be.false
                  }
                  if (!isFlexibleOracle1) {
                    expect(params[1].isPegged).to.be.false
                  }
              });
            });
          });

        });
        
        describe('isPegged', () => {

          let initialPeggedState0: boolean
          let initialPeggedState1: boolean
          sharedBeforeEach('sets flexible to true', async () => {
            const action = await actionId(pool.instance, 'setFlexibleOracleStates');
            await pool.vault.authorizer.connect(deployer).grantPermissions([action], deployer.address, [pool.address]);
            await pool.setFlexibleOracleStates(
              deployer,
              true,
              true
            );
            const params = await pool.getOracleParams();
            initialPeggedState0 = params[0].isPegged
            initialPeggedState1 = params[1].isPegged
          });

          [0, 1, 2].forEach(pegged0 => {
            [0, 1, 2].forEach(pegged1 => {
              it (`checking isPegged values`, async () => {
                await oracles[0].setPrice(
                  oracles[0].scalePrice(pegged0==0? 1: (pegged0==1? 1 * 2 : 1 * 1.03))
                )
                await oracles[1].setPrice(
                  oracles[1].scalePrice(pegged1==0? 1: (pegged1==1? 1 * 2 : 1 * 1.03))
                )
                const action = await actionId(pool.instance, 'evaluateStablesPegStates');
                await pool.vault.authorizer.connect(deployer).grantPermissions([action], deployer.address, [pool.address]);
                await pool.evaluateStablesPegStates(deployer);
                const params = await pool.getOracleParams();
                expect(params[0].isPegged).to.be.eq(pegged0==0? true: (pegged0==1? false: initialPeggedState0))
                expect(params[1].isPegged).to.be.eq(pegged1==0? true: (pegged1==1? false: initialPeggedState1))
              });
            });
          });

        });
      
      });

    });

  });

});
