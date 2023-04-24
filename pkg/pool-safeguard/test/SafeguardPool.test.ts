import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Oracle from '@balancer-labs/v2-helpers/src/models/oracles/Oracle';
import OraclesDeployer from '@balancer-labs/v2-helpers/src/models/oracles/OraclesDeployer';
import SafeguardPool from '@balancer-labs/v2-helpers/src/models/pools/safeguard/SafeguardPool';
import { RawSafeguardPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/safeguard/types';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { SafeguardPoolJoinKind, SwapKind } from '@balancer-labs/balancer-js';
import { BigNumberish, fp, fpDiv, fpMul, FP_100_PCT } from '@balancer-labs/v2-helpers/src/numbers';
import { range } from 'lodash';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { DAY } from '@balancer-labs/v2-helpers/src/time';
import '@balancer-labs/v2-common/setupTests'
import VaultDeployer from '@balancer-labs/v2-helpers/src/models/vault/VaultDeployer';
import { SwapSafeguardPool } from '@balancer-labs/v2-helpers/src/models/pools/safeguard/types'

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

    maxPerfDev = fp(0.1);
    maxTargetDev = fp(0.2);
    maxPriceDev = fp(0.03);
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

  describe('join/exit pool', () => {
      
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
        
        console.log((await pool.joinAllGivenOut({
          bptOut: bptOut,
          from: deployer,
          recipient: lp
        })).receipt.gasUsed);

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
    
    context('Swaps', () => {
      
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
        expect(endUserBalanceOut).to.be.eq(startUserBalanceOut.add(reducedAmountOut))

    });
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
    expect(endUserBalanceIn).to.be.eq(startUserBalanceIn.sub(increasedAmountIn))
    expect(endUserBalanceOut).to.be.eq(startUserBalanceOut.add(amountOut))

});

  context('Enable allowlist', () => {
    it('JoinAllGivenOut', async() => {
      const action = await actionId(pool.instance, 'setAllowlistBoolean');
      await pool.vault.authorizer.connect(deployer).grantPermissions([action], deployer.address, [pool.address]);
      await pool.instance.setAllowlistBoolean(true);
      
      const bptOut = fp(10);
      const lpBalanceBefore = await pool.balanceOf(lp.address);

      console.log((await pool.joinAllGivenOut({
        bptOut: bptOut,
        from: deployer,
        recipient: lp,
        chainId: chainId,
        signer: signer
      })).receipt.gasUsed);

      const lpBalanceAfter = await pool.balanceOf(lp.address);
      expect(lpBalanceAfter).to.be.equal(lpBalanceBefore.add(bptOut));
    });
  });
  
//   describe('weights and scaling factors', () => {
//     for (const numTokens of range(2, MAX_TOKENS + 1)) {
//       context(`with ${numTokens} tokens`, () => {
//         let pool: WeightedPool;
//         let tokens: TokenList;

//         sharedBeforeEach('deploy pool', async () => {
//           tokens = allTokens.subset(numTokens);

//           pool = await WeightedPool.create({
//             poolType: WeightedPoolType.WEIGHTED_POOL,
//             tokens,
//             weights: WEIGHTS.slice(0, numTokens),
//             swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
//           });
//         });

//         it('sets token weights', async () => {
//           const normalizedWeights = await pool.getNormalizedWeights();

//           expect(normalizedWeights).to.deep.equal(pool.normalizedWeights);
//         });

//         it('sets scaling factors', async () => {
//           const poolScalingFactors = await pool.getScalingFactors();
//           const tokenScalingFactors = tokens.map((token) => fp(10 ** (18 - token.decimals)));

//           expect(poolScalingFactors).to.deep.equal(tokenScalingFactors);
//         });
//       });
//     }
//   });

//   describe('permissioned actions', () => {
//     let pool: Contract;

//     sharedBeforeEach('deploy pool', async () => {
//       const vault = await Vault.create();

//       pool = await deploy('MockWeightedPool', {
//         args: [
//           {
//             name: '',
//             symbol: '',
//             tokens: allTokens.subset(2).addresses,
//             normalizedWeights: [fp(0.5), fp(0.5)],
//             rateProviders: new Array(2).fill(ZERO_ADDRESS),
//             assetManagers: new Array(2).fill(ZERO_ADDRESS),
//             swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
//           },

//           vault.address,
//           vault.getFeesProvider().address,
//           0,
//           0,
//           ZERO_ADDRESS,
//         ],
//       });
//     });

//     function itIsOwnerOnly(method: string) {
//       it(`${method} requires the caller to be the owner`, async () => {
//         expect(await pool.isOwnerOnlyAction(await actionId(pool, method))).to.be.true;
//       });
//     }

//     function itIsNotOwnerOnly(method: string) {
//       it(`${method} doesn't require the caller to be the owner`, async () => {
//         expect(await pool.isOwnerOnlyAction(await actionId(pool, method))).to.be.false;
//       });
//     }

//     const poolArtifact = getArtifact('v2-pool-weighted/WeightedPool');
//     const nonViewFunctions = poolArtifact.abi
//       .filter(
//         (elem) =>
//           elem.type === 'function' && (elem.stateMutability === 'payable' || elem.stateMutability === 'nonpayable')
//       )
//       .map((fn) => fn.name);

//     const expectedOwnerOnlyFunctions = ['setSwapFeePercentage'];

//     const expectedNotOwnerOnlyFunctions = nonViewFunctions.filter((fn) => !expectedOwnerOnlyFunctions.includes(fn));

//     describe('owner only actions', () => {
//       for (const expectedOwnerOnlyFunction of expectedOwnerOnlyFunctions) {
//         itIsOwnerOnly(expectedOwnerOnlyFunction);
//       }
//     });

//     describe('non owner only actions', () => {
//       for (const expectedNotOwnerOnlyFunction of expectedNotOwnerOnlyFunctions) {
//         itIsNotOwnerOnly(expectedNotOwnerOnlyFunction);
//       }
//     });
//   });

//   describe('protocol fees', () => {
//     const swapFeePercentage = fp(0.1); // 10 %
//     const protocolFeePercentage = fp(0.5); // 50 %
//     const numTokens = 2;

//     let tokens: TokenList;
//     let pool: WeightedPool;
//     let vaultContract: Contract;

//     sharedBeforeEach('deploy pool', async () => {
//       tokens = allTokens.subset(numTokens);
//       const vault = await Vault.create();
//       vaultContract = vault.instance;

//       await vault.setSwapFeePercentage(protocolFeePercentage);

//       pool = await WeightedPool.create({
//         poolType: WeightedPoolType.WEIGHTED_POOL,
//         tokens,
//         weights: WEIGHTS.slice(0, numTokens),
//         swapFeePercentage: swapFeePercentage,
//         vault,
//       });
//     });

//     context('once initialized', () => {
//       sharedBeforeEach('initialize pool', async () => {
//         // Init pool with equal balances so that each BPT accounts for approximately one underlying token.
//         const equalBalances = Array(numTokens).fill(fp(100));

//         await allTokens.mint({ to: lp.address, amount: fp(1000) });
//         await allTokens.approve({ from: lp, to: pool.vault.address });

//         await pool.init({ from: lp, recipient: lp.address, initialBalances: equalBalances });
//       });

//       context('with protocol fees', () => {
//         let unmintedBPT: BigNumber;

//         sharedBeforeEach('swap bpt in', async () => {
//           const amount = fp(20);
//           const tokenIn = tokens.first;
//           const tokenOut = tokens.second;

//           const originalInvariant = await pool.instance.getInvariant();

//           const singleSwap = {
//             poolId: await pool.getPoolId(),
//             kind: SwapKind.GivenIn,
//             assetIn: tokenIn.address,
//             assetOut: tokenOut.address,
//             amount: amount,
//             userData: '0x',
//           };

//           const funds: FundManagement = {
//             sender: lp.address,
//             recipient: lp.address,
//             fromInternalBalance: false,
//             toInternalBalance: false,
//           };

//           await vaultContract.connect(lp).swap(singleSwap, funds, 0, MAX_UINT256);

//           const postInvariant = await pool.instance.getInvariant();
//           const swapFeesPercentage = FP_100_PCT.sub(fpDiv(originalInvariant, postInvariant));
//           const protocolOwnershipPercentage = fpMul(swapFeesPercentage, protocolFeePercentage);

//           unmintedBPT = fpMul(
//             await pool.totalSupply(),
//             fpDiv(protocolOwnershipPercentage, FP_100_PCT.sub(protocolOwnershipPercentage))
//           );
//         });

//         it('the actual supply takes into account unminted protocol fees', async () => {
//           const totalSupply = await pool.totalSupply();
//           const expectedActualSupply = totalSupply.add(unmintedBPT);

//           expect(await pool.getActualSupply()).to.almostEqual(expectedActualSupply, 1e-6);
//         });

//         function itReactsToProtocolFeePercentageChangesCorrectly(feeType: number) {
//           it('due protocol fees are minted on protocol fee cache update', async () => {
//             await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
//             const receipt = await (await pool.updateProtocolFeePercentageCache()).wait();

//             const event = expectEvent.inReceipt(receipt, 'Transfer', {
//               from: ZERO_ADDRESS,
//               to: (await pool.vault.getFeesCollector()).address,
//             });

//             expect(event.args.value).to.be.almostEqual(unmintedBPT, 1e-6);
//           });

//           it('repeated protocol fee cache updates do not mint any more fees', async () => {
//             await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
//             await pool.updateProtocolFeePercentageCache();

//             await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(4));
//             const receipt = await (await pool.updateProtocolFeePercentageCache()).wait();

//             expectEvent.notEmitted(receipt, 'Transfer');
//           });

//           context('when paused', () => {
//             sharedBeforeEach('pause pool', async () => {
//               await pool.pause();
//             });

//             it('reverts on protocol fee cache updated', async () => {
//               await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
//               await expect(pool.updateProtocolFeePercentageCache()).to.be.revertedWith('PAUSED');
//             });
//           });
//         }

//         context('on swap protocol fee change', () => {
//           itReactsToProtocolFeePercentageChangesCorrectly(ProtocolFee.SWAP);
//         });

//         context('on yield protocol fee change', () => {
//           itReactsToProtocolFeePercentageChangesCorrectly(ProtocolFee.YIELD);
//         });

//         context('on aum protocol fee change', () => {
//           itReactsToProtocolFeePercentageChangesCorrectly(ProtocolFee.AUM);
//         });
//       });
//     });
//   });
});
