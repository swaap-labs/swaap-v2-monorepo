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
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { DAY, advanceToTimestamp, SECOND } from '@balancer-labs/v2-helpers/src/time';
import '@balancer-labs/v2-common/setupTests'
import VaultDeployer from '@balancer-labs/v2-helpers/src/models/vault/VaultDeployer';
import { calcYearlyRate, calcAccumulatedManagementFees } from '@balancer-labs/v2-helpers/src/models/pools/safeguard/math'

let vault: Vault;
let allTokens: TokenList;
let allOracles: Oracle[];
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

const initialBalances = [fp(15), fp(15)];
const initPrices = [1, 1];
const tolerance = fp(1e-9);

describe('SafeguardPool', function () {

  before('setup signers and tokens', async () => {
    [deployer, lp, owner, recipient, admin, signer, other, trader] = await ethers.getSigners();
    allTokens = await TokenList.create(2, { sorted: true, varyDecimals: false });
  });

  let pool: SafeguardPool;

  sharedBeforeEach('deploy pool', async () => {
    vault = await VaultDeployer.deploy({mocked: false});
  
    await allTokens.mint({ to: deployer, amount: fp(1000) });
    await allTokens.approve({to: vault, amount: fp(1000), from: deployer});


    allOracles = [
      await OraclesDeployer.deployOracle({
        description: "low",
        price: initPrices[0],
        decimals: 8
      }),
      await OraclesDeployer.deployOracle({
        description: "high",
        price: initPrices[1],
        decimals: 8
      })
    ];

    maxPerfDev = fp(0.9);
    maxTargetDev = fp(0.8);
    maxPriceDev = fp(0.97);
    perfUpdateInterval = 1 * DAY;
    yearlyFees = 0;
    mustAllowlistLPs = false;

    let poolConstructor: RawSafeguardPoolDeployment = {
      tokens: allTokens,
      vault: vault,
      oracles: allOracles,
      signer: signer,
      maxPerfDev: maxPerfDev,
      maxTargetDev: maxTargetDev,
      maxPriceDev: maxPriceDev,
      perfUpdateInterval: perfUpdateInterval,
      yearlyFees: yearlyFees,
      mustAllowlistLPs: mustAllowlistLPs
    };

    pool = await SafeguardPool.create(poolConstructor);
    await pool.init({ initialBalances, recipient: lp });
  });

  describe('Join/exit', () => {

    context('Join/Exit', () => {
        
      it('Initial balances are correct', async () => {        
        const currentBalances = await pool.getBalances();
        for(let i = 0; i < currentBalances.length; i++){
          expect(currentBalances[i]).to.be.equal(initialBalances[i]);
        }
        await allTokens.tokens[0].mint(other, fp(1));
      });
      
      it('JoinAllGivenOut', async() => {        
        const bptOut = fp(10);
        const lpBalanceBefore = await pool.balanceOf(lp.address);

        const balance0 = await allTokens.tokens[0].balanceOf(deployer);
        const balance1 = await allTokens.tokens[1].balanceOf(deployer);
        const expectedBalances = [balance0, balance1].map((currentBalance, index) => currentBalance.sub(initialBalances[index].mul(bptOut).div(fp(100))));
        
        await pool.joinAllGivenOut({
          bptOut: bptOut,
          from: deployer,
          recipient: lp
        })

        const lpBalanceAfter = await pool.balanceOf(lp.address);
        expect(lpBalanceAfter).to.be.equal(lpBalanceBefore.add(bptOut));

        const currentBalance0 = await allTokens.tokens[0].balanceOf(deployer);
        const currentBalance1 = await allTokens.tokens[1].balanceOf(deployer);
        
        expect(currentBalance0).to.be.equal(expectedBalances[0]);
        expect(currentBalance1).to.be.equal(expectedBalances[1]);
      });   
      
      it('joinExactTokensForBptOut', async() => {        
        const currentBalances = await pool.getBalances();

        const amountsIn = [fp(1.01), fp(1)];
        const expectedBalances = currentBalances.map((currentBalance, index) => currentBalance.add(amountsIn[index]));

        await pool.joinGivenIn({
          recipient: lp.address,
          chainId: chainId,
          amountsIn: amountsIn,
          swapTokenIn: allTokens.tokens[0],
          signer: signer
        });

        const updatedBalances = await pool.getBalances();
        
        expect(updatedBalances[0]).to.be.equal(expectedBalances[0]);
        expect(updatedBalances[1]).to.be.equal(expectedBalances[1]);
      });
      
      it('exitBptInForExactTokensOut', async() => {
        const currentBalances = await pool.getBalances();

        const amountsOut = [fp(1.1), fp(1)];
        const expectedBalances = currentBalances.map((currentBalance, index) => currentBalance.sub(amountsOut[index]));

        await pool.exitGivenOut({
          from: lp,
          recipient: lp.address,
          chainId: chainId,
          amountsOut: amountsOut,
          swapTokenIn: allTokens.tokens[1],
          signer: signer
        });

        const updatedBalances = await pool.getBalances();
        
        expect(updatedBalances[0]).to.be.equal(expectedBalances[0]);
        expect(updatedBalances[1]).to.be.equal(expectedBalances[1]);
      });

      it('multiExitGivenIn', async() => {        
        const bptIn = fp(10);
        const lpBalanceBefore = await pool.balanceOf(lp.address);

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
    
  context('Swap', () => {
    
    it('Swap given in', async () => {

      const amountIn = fp(0.5);
      const currentBalances = await pool.getBalances();
      const inIndex = 0;
      const outIndex = inIndex == 0? 1 : 0;

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

    it('Swap given out', async () => {

      const amountOut = fp(0.5);
      const currentBalances = await pool.getBalances();
      const inIndex = 0;
      const outIndex = inIndex == 0? 1 : 0;

      const expectedBalanceIn = currentBalances[outIndex].sub(amountOut);

      await pool.swapGivenIn({
        chainId: chainId,
        in: inIndex,
        out: outIndex,
        amount: amountOut,
        signer: signer,
        from: deployer,
        recipient: lp.address
      });
      
      const updatedBalances = await pool.getBalances();
      expect(updatedBalances[outIndex]).to.be.equal(expectedBalanceIn)

    });
  });

  context('Detailed Swap', () => {
    
    it('Swap given in', async () => {

      const startBlock = await ethers.provider.getBlockNumber();
      const startBlockTimestamp = (await ethers.provider.getBlock(startBlock)).timestamp;
      
      const currentBalances = await pool.getBalances();

      const inIndex = 0;
      const outIndex = inIndex == 0? 1 : 0;

      const amountIn = fp(0.5);

      await allTokens.mint({ to: trader, amount: fp(1000) });
      await allTokens.approve({to: vault, amount: fp(1000), from: trader});

      const amountInPerOut = await pool.getAmountInPerOut(inIndex)

      expect(amountInPerOut).to.be.eq("1000000000000000000")

      const expectedAmountOut = amountIn
      
      const startTime = startBlockTimestamp
      const timeBasedSlippage = 0.0001
      const originBasedSlippage = 0.0005

      let swapInput: SwapSafeguardPool = {
        chainId: chainId,
        in: inIndex,
        out: outIndex,
        amount: amountIn,
        recipient: trader.address,
        from: trader,
        deadline: startBlockTimestamp + 100000,
        maxSwapAmount: fp(0.5),
        quoteAmountInPerOut:amountInPerOut,
        maxBalanceChangeTolerance: fp(0.075),
        quoteBalanceIn: (currentBalances[inIndex]).sub(BigNumber.from('1000000000000')),
        quoteBalanceOut: currentBalances[outIndex].sub(BigNumber.from('4000000000000')),
        balanceBasedSlippage: fp(0.0002),
        startTime: startTime,
        timeBasedSlippage: fp(timeBasedSlippage),
        signer: signer,
        expectedOrigin: ZERO_ADDRESS,
        originBasedSlippage: fp(originBasedSlippage),
      }
      
      const expectedPoolBalanceIn = currentBalances[inIndex].add(amountIn);
      
      const startUserBalanceIn = await allTokens.tokens[inIndex].balanceOf(trader);
      const startUserBalanceOut = await allTokens.tokens[outIndex].balanceOf(trader);
      
      await pool.swapGivenIn(swapInput) // swap execution

      const endPoolBalances = await pool.getBalances();
      
      const endUserBalanceIn = await allTokens.tokens[inIndex].balanceOf(trader);
      const endUserBalanceOut = await allTokens.tokens[outIndex].balanceOf(trader);

      const endBlock = await ethers.provider.getBlockNumber();
      const endBlockTimestamp: number = (await ethers.provider.getBlock(endBlock)).timestamp;

      var penalty = 1
      penalty += timeBasedSlippage * (endBlockTimestamp - startBlockTimestamp)
      penalty += originBasedSlippage
      
      const reducedAmountOut = expectedAmountOut.mul(fp(1)).div(fp(penalty))

      expect(endPoolBalances[inIndex]).to.be.eq(expectedPoolBalanceIn)
      expect(endUserBalanceIn).to.be.eq(startUserBalanceIn.sub(amountIn))
      expect((((startUserBalanceOut.add(reducedAmountOut)).mul(fp(1)).div(endUserBalanceOut)).sub(fp(1))).abs()).to.be.lessThan(tolerance)
    });

    it('Swap given out', async () => {

      const startBlock = await ethers.provider.getBlockNumber();
      const startBlockTimestamp = (await ethers.provider.getBlock(startBlock)).timestamp;
      
      const currentBalances = await pool.getBalances();

      const inIndex = 0;
      const outIndex = inIndex == 0? 1 : 0;

      const amountOut = fp(0.5);

      await allTokens.mint({ to: trader, amount: fp(1000) });
      await allTokens.approve({to: vault, amount: fp(1000), from: trader});

      const amountInPerOut = await pool.getAmountInPerOut(inIndex)

      expect(amountInPerOut).to.be.eq("1000000000000000000")

      const expectedAmountIn = amountOut

      const startTime = startBlockTimestamp
      const timeBasedSlippage = 0.0001
      const originBasedSlippage = 0.0005

      let swapInput: SwapSafeguardPool = {
        chainId: chainId,
        in: inIndex,
        out: outIndex,
        amount: amountOut,
        recipient: trader.address,
        from: trader,
        deadline: startBlockTimestamp + 100000,
        maxSwapAmount: fp(0.5),
        quoteAmountInPerOut:amountInPerOut,
        maxBalanceChangeTolerance: fp(0.075),
        quoteBalanceIn: (currentBalances[inIndex]).sub(BigNumber.from('1000000000000')),
        quoteBalanceOut: currentBalances[outIndex].sub(BigNumber.from('4000000000000')),
        balanceBasedSlippage: fp(0.0002),
        startTime: startTime,
        timeBasedSlippage: fp(timeBasedSlippage),
        signer: signer,
        expectedOrigin: ZERO_ADDRESS,
        originBasedSlippage: fp(originBasedSlippage),
      }
      
      const expectedPoolBalanceOut = currentBalances[outIndex].sub(amountOut);
      
      const startUserBalanceIn = await allTokens.tokens[inIndex].balanceOf(trader);
      const startUserBalanceOut = await allTokens.tokens[outIndex].balanceOf(trader);
      
      await pool.swapGivenOut(swapInput) // swap execution

      const endPoolBalances = await pool.getBalances();
      
      const endUserBalanceIn = await allTokens.tokens[inIndex].balanceOf(trader);
      const endUserBalanceOut = await allTokens.tokens[outIndex].balanceOf(trader);

      const endBlock = await ethers.provider.getBlockNumber();
      const endBlockTimestamp: number = (await ethers.provider.getBlock(endBlock)).timestamp;

      var penalty = 1
      penalty += timeBasedSlippage * (endBlockTimestamp - startBlockTimestamp)
      penalty += originBasedSlippage
      
      const increasedAmountIn = expectedAmountIn.mul(fp(penalty)).div(fp(1))

      expect(endPoolBalances[outIndex]).to.be.eq(expectedPoolBalanceOut)
      expect((((startUserBalanceIn.sub(increasedAmountIn)).mul(fp(1)).div(endUserBalanceIn)).sub(fp(1))).abs()).to.be.lessThan(tolerance)
      expect(endUserBalanceOut).to.be.eq(startUserBalanceOut.add(amountOut))

    });
  });

  context('Enable allowlist', () => {
    it('JoinAllGivenOut', async() => {
      const action = await actionId(pool.instance, 'setMustAllowlistLPs');
      await pool.vault.authorizer.connect(deployer).grantPermissions([action], deployer.address, [pool.address]);
      await pool.instance.setMustAllowlistLPs(true);
      
      const bptOut = fp(10);
      const lpBalanceBefore = await pool.balanceOf(lp.address);

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
  
  describe('Protocol Fees', () => {

    context('Management Fees', () => {

      it ('Management Fees', async () => {
        
        const yearlyFees = 3 / 100

        const bptIn = fp(1);

        const action = await actionId(pool.instance, 'setManagementFees');
        await pool.vault.authorizer.connect(deployer).grantPermissions([action], deployer.address, [pool.address]);
        await pool.setManagementFees(deployer, fp(yearlyFees))
        let block = await ethers.provider.getBlockNumber();
        const maagementFeesInitTimestmap = (await ethers.provider.getBlock(block)).timestamp;

        const exitResult = await pool.multiExitGivenIn({
          bptIn: bptIn,
          from: lp,
          recipient: lp
        });

        const collector = (await pool.vault.getFeesCollector()).address

        expectEvent.notEmitted(exitResult.receipt, 'Transfer');

        const totalSupply = await pool.totalSupply();

        block = await ethers.provider.getBlockNumber();
        let currentTimestamp = (await ethers.provider.getBlock(block)).timestamp;
        await advanceToTimestamp(currentTimestamp + 365 * DAY);

        const exitResultBis = await pool.multiExitGivenIn({
          bptIn: bptIn,
          from: lp,
          recipient: lp
        });

        block = await ethers.provider.getBlockNumber();
        currentTimestamp = (await ethers.provider.getBlock(block)).timestamp;

        const expected = fp(
          calcAccumulatedManagementFees(
            (currentTimestamp - maagementFeesInitTimestmap) * SECOND,
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
          expect(((BigNumber.from(firstEvent.data).mul(fp(1)).div(expected)).sub(fp(1))).abs()).to.be.lessThan(tolerance) // to
        } catch(e) {
          throw e;
        }

      });
    });

  });

});
