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

const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
let maxTVLoffset: BigNumberish;
let maxBalOffset: BigNumberish;
let perfUpdateInterval: BigNumberish;
let maxQuoteOffset: BigNumberish;
let maxPriceOffet: BigNumberish;

const chainId = 31337;

describe('SafeguardPool', function () {

  before('setup signers and tokens', async () => {
    [deployer, lp, owner, recipient, admin, signer, other, trader] = await ethers.getSigners();
    let tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });
    await tokens.mint({ to: trader, amount: fp(100) });
    await tokens.approve({ to: trader, from: trader });
  });

  let pool: SafeguardPool;

  const initialBalances = [fp(15), fp(15)];
  const initPrices = [1, 1];

  sharedBeforeEach('deploy pool', async () => {
    vault = await VaultDeployer.deploy({mocked: false});

    allTokens = await TokenList.create(2, { sorted: true, varyDecimals: false });
  
    await allTokens.tokens[0].mint(deployer, fp(1000));
    await allTokens.tokens[1].mint(deployer, fp(1000));

    await allTokens.tokens[0].approve(vault, fp(1000), {from: deployer});
    await allTokens.tokens[1].approve(vault, fp(1000), {from: deployer});

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

    maxTVLoffset = fp(0.9);
    maxBalOffset = fp(0.9);
    perfUpdateInterval = 1 * DAY;
    maxQuoteOffset = fp(0.9);
    maxPriceOffet = fp(0.9)

    let poolConstructor: RawSafeguardPoolDeployment = {
      tokens: allTokens,
      vault: vault,
      oracles: allOracles,
      signer: signer,
      maxTVLoffset: maxTVLoffset,
      maxBalOffset: maxBalOffset,
      perfUpdateInterval: perfUpdateInterval,
      maxQuoteOffset: maxQuoteOffset,
      maxPriceOffet: maxPriceOffet
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

        console.log((await pool.joinAllGivenOut({
          bptOut: bptOut,
          from: deployer,
          recipient: lp
        })).receipt.gasUsed);

        const lpBalanceAfter = await pool.balanceOf(lp.address);
        expect(lpBalanceAfter).to.be.equal(lpBalanceBefore.add(bptOut));
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

        const currentBlock = await ethers.provider.getBlockNumber();
        const blockTimestamp = (await ethers.provider.getBlock(currentBlock)).timestamp;
        
        const currentBalances = await pool.getBalances();

        const inIndex = 0;
        const outIndex = inIndex == 0? 1 : 0;

        const amountIn = fp(0.5);

        let swapInput: SwapSafeguardPool = {
          chainId: chainId,
          in: inIndex,
          out: outIndex,
          amount: amountIn,
          recipient: lp.address,
          from: deployer,
          deadline: blockTimestamp + 100000,
          maxSwapAmount: fp(0.5),
          quoteAmountInPerOut: await pool.getAmountInPerOut(inIndex),
          maxBalanceChangeTolerance: fp(0.075),
          quoteBalanceIn: (currentBalances[inIndex]).sub(BigNumber.from('1000000000000')),
          quoteBalanceOut: currentBalances[outIndex].sub(BigNumber.from('4000000000000')),
          balanceBasedSlippage: fp(0.0002),
          startTime: blockTimestamp + 1000,
          timeBasedSlippage: fp(0.0001),
          signer: signer
        }

        const expectedBalanceIn = currentBalances[inIndex].add(amountIn);

        console.log((await pool.swapGivenIn(swapInput)).receipt.gasUsed);
    });
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
