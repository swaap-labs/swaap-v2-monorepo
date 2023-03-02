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

let allTokens: TokenList;
let allOracles: Oracle[];
let lp: SignerWithAddress,
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
let maxPriceOffet: BigNumberish

describe('SafeguardPool', function () {

  before('setup signers', async () => {
    [, lp, owner, recipient, admin, signer, other, trader] = await ethers.getSigners();
  });

  describe('join pool', () => {
    let pool: SafeguardPool;

    const initialBalances = [fp(100), fp(15)];
    const initPrices = [1, 1000];

    sharedBeforeEach('deploy pool', async () => {

      allTokens = await TokenList.create(2, { sorted: true, varyDecimals: true });
    
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

      let chainId = (await ethers.getDefaultProvider().getNetwork()).chainId;

      await pool.joinGivenIn({
        receiver: lp.address,
        chainId: chainId,
        sellToken: allTokens.tokens[0].address,
        amountsIn: [fp(10), 0],
        maxSwapAmountIn: fp(10),
        variableAmount: fp(10),
        signer: signer
      });
    });

    context('Init join pool', () => {
      
      it('sets the lastPostJoinInvariant to the current invariant', async () => {        
        const currentBalances = await pool.getBalances();
        for(let i = 0; i < currentBalances.length; i++){
          expect(currentBalances[i]).to.be.equal(initialBalances[i]);
        }
      });
      
      it('joinExactTokensForBptOut', async() => {
        // let chainId = (await ethers.getDefaultProvider().getNetwork()).chainId;

        // await pool.joinGivenIn({
        //   receiver: lp.address,
        //   chainId: chainId,
        //   sellToken: allTokens.tokens[0].address,
        //   amountsIn: [fp(10), 0],
        //   maxSwapAmountIn: fp(10),
        //   variableAmount: fp(10),
        //   signer: signer
        // });
      });
    
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