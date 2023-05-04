import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Oracle from '@balancer-labs/v2-helpers/src/models/oracles/Oracle';
import OraclesDeployer from '@balancer-labs/v2-helpers/src/models/oracles/OraclesDeployer';
import SafeguardPool from '@balancer-labs/v2-helpers/src/models/pools/safeguard/SafeguardPool';
import { RawSafeguardPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/safeguard/types';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumberish, fp, bn, bnSum } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT112, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { DAY, MINUTE } from '@balancer-labs/v2-helpers/src/time';
import '@balancer-labs/v2-common/setupTests'
import VaultDeployer from '@balancer-labs/v2-helpers/src/models/vault/VaultDeployer';

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
const PREMINTED_BPT = MAX_UINT112.div(2);

const initialBalances = [fp(15), fp(15)];
const initPrices = [1, 1];

describe('SafeguardPool', function () {

  before('setup signers and tokens', async () => {
    [deployer, lp, owner, recipient, admin, signer, other, trader] = await ethers.getSigners();
    tokens = await TokenList.create(2, { sorted: true, varyDecimals: false });
  });

  let pool: SafeguardPool;

  sharedBeforeEach('deploy pool', async () => {
    vault = await VaultDeployer.deploy({mocked: false});
  
    await tokens.mint({ to: deployer, amount: fp(1000) });
    await tokens.approve({to: vault, amount: fp(1000), from: deployer});


    oracles = [
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

    maxPerfDev = fp(0.99);
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

  describe('Post-init', () => {

    sharedBeforeEach('init pool', async () => {
      await pool.init({ initialBalances, recipient: lp });
    });

    describe('Swap Safeguards', () => {

      context('validateSwap', () => {

        it ('valid', async () => {
          const kind = 0;
          const isTokenInToken0 = true;
          const [balanceTokenIn, balanceTokenOut, amountInPerOut] = await pool.getBalanceAndPrice(isTokenInToken0);
          const amountOut = balanceTokenIn.div(20)
          const amountIn = amountOut.mul(amountInPerOut).div(fp(1))
          const maxSwapAmount = amountIn
          await expect(
            pool.validateSwap(
              kind,
              isTokenInToken0,
              balanceTokenIn,
              balanceTokenOut,
              amountIn,
              amountOut,
              amountInPerOut,
              maxSwapAmount
            )
          ).not.to.be.reverted
        });

        it ('exceeded swap amount in', async () => {
          const kind = 0;
          const isTokenInToken0 = true;
          const [balanceTokenIn, balanceTokenOut, amountInPerOut] = await pool.getBalanceAndPrice(isTokenInToken0);
          const amountOut = balanceTokenIn.div(20)
          const amountIn = amountOut.mul(amountInPerOut).div(fp(1))
          const maxSwapAmount = amountIn.sub(1) // sub 1 wei
          await expect(
            pool.validateSwap(
              kind,
              isTokenInToken0,
              balanceTokenIn,
              balanceTokenOut,
              amountIn,
              amountOut,
              amountInPerOut,
              maxSwapAmount
            )
          ).to.be.revertedWith("error: exceeded swap amount in")
        });

        it ('exceeded swap amount out', async () => {
          const kind = 1;
          const isTokenInToken0 = true;
          const [balanceTokenIn, balanceTokenOut, amountInPerOut] = await pool.getBalanceAndPrice(isTokenInToken0);
          const amountOut = balanceTokenOut.div(20)
          const amountIn = amountOut.mul(amountInPerOut).div(fp(1))
          const maxSwapAmount = amountOut.sub(1) // sub 1 wei
          await expect(
            pool.validateSwap(
              kind,
              isTokenInToken0,
              balanceTokenIn,
              balanceTokenOut,
              amountIn,
              amountOut,
              amountInPerOut,
              maxSwapAmount
            )
          ).to.be.reverted.revertedWith("error: exceeded swap amount out")
        });

        it ('unfair price: index 0', async () => {
          const kind = 0;
          const isTokenInToken0 = true;
          let [balanceTokenIn, balanceTokenOut, amountInPerOut] = await pool.getBalanceAndPrice(isTokenInToken0);
          amountInPerOut = amountInPerOut.div(2) // double actual price 
          const amountOut = balanceTokenOut.div(20)
          const amountIn = amountOut.mul(amountInPerOut).div(fp(1))
          const maxSwapAmount = amountIn
          await expect(
            pool.validateSwap(
              kind,
              isTokenInToken0,
              balanceTokenIn,
              balanceTokenOut,
              amountIn,
              amountOut,
              amountInPerOut,
              maxSwapAmount
            )
          ).to.be.revertedWith("error: unfair price")
        });

        it ('unfair price: index 1', async () => {
          const kind = 1;
          const isTokenInToken0 = true;
          let [balanceTokenIn, balanceTokenOut, amountInPerOut] = await pool.getBalanceAndPrice(isTokenInToken0);
          amountInPerOut = amountInPerOut.div(2) // double actual price 
          const amountOut = balanceTokenOut.div(20)
          const amountIn = amountOut.mul(amountInPerOut).div(fp(1))
          const maxSwapAmount = amountOut
          await expect(
            pool.validateSwap(
              kind,
              isTokenInToken0,
              balanceTokenIn,
              balanceTokenOut,
              amountIn,
              amountOut,
              amountInPerOut,
              maxSwapAmount
            )
          ).to.be.revertedWith("error: unfair price")
        });

        it ('min balance out is not met: index 0', async () => {
          const kind = 0;
          const isTokenInToken0 = true;
          const [balanceTokenIn, balanceTokenOut, amountInPerOut] = await pool.getBalanceAndPrice(isTokenInToken0);
          const amountOut = balanceTokenOut // 100% of the pool is too large of an amount
          const amountIn = amountOut.mul(amountInPerOut).div(fp(1))
          const maxSwapAmount = amountIn
          await expect(
            pool.validateSwap(
              kind,
              isTokenInToken0,
              balanceTokenIn,
              balanceTokenOut,
              amountIn,
              amountOut,
              amountInPerOut,
              maxSwapAmount
            )
          ).to.be.reverted.revertedWith("error: min balance out is not met")
        });

        it ('min balance out is not met: index 1', async () => {
          const kind = 1;
          const isTokenInToken0 = true;
          const [balanceTokenIn, balanceTokenOut, amountInPerOut] = await pool.getBalanceAndPrice(isTokenInToken0);
          const amountOut = balanceTokenOut // 100% of the pool is too large of an amount
          const amountIn = amountOut.mul(amountInPerOut).div(fp(1))
          const maxSwapAmount = amountOut
          await expect(
            pool.validateSwap(
              kind,
              isTokenInToken0,
              balanceTokenIn,
              balanceTokenOut,
              amountIn,
              amountOut,
              amountInPerOut,
              maxSwapAmount
            )
          ).to.be.reverted.revertedWith("error: min balance out is not met")
        });

        it ('low performance', async () => {
          
          const isTokenInToken0 = true;
          const [_, balanceTokenOut, amountInPerOut] = await pool.getBalanceAndPrice(isTokenInToken0);
          const amountOut = balanceTokenOut.div(10)
          const amountIn = amountOut.mul(amountInPerOut).div(fp(1))
          
          const inIndex = isTokenInToken0? 0 : 1;
          const outIndex = inIndex == 0? 1 : 0;
      
          await pool.swapGivenIn({
            chainId: chainId,
            in: inIndex,
            out: outIndex,
            amount: amountIn,
            signer: signer,
            from: deployer,
            recipient: lp.address
          }); // token out is now in shortage

          const pumpFactor = 10
          const latestPrice = await oracles[outIndex].latestAnswer()
          oracles[outIndex].setPrice(latestPrice.mul(pumpFactor)) // pumping token-in-shortage price

          const kind = 1;
          const [newBalanceTokenIn, newBalanceTokenOut, newAmountInPerOut] = await pool.getBalanceAndPrice(isTokenInToken0);
          const newAmountOut = amountIn.mul(fp(1)).div(newAmountInPerOut)
          const maxSwapAmount = newAmountOut

          await expect(
            pool.validateSwap(
              kind,
              isTokenInToken0,
              newBalanceTokenIn,
              newBalanceTokenOut,
              amountIn,
              newAmountOut,
              newAmountInPerOut,
              maxSwapAmount
            )
          ).to.be.reverted.revertedWith("error: low performance")
        });

      });

      context('Signature Safeguards', () => {
                
        let signatureSGUserData: [string, string, BigNumberish, BigNumberish];
        let signatureSGUserDataWrongSigner: [string, string, BigNumberish, BigNumberish];
        let signatureSGKind: number;
        let signatureSGInIndex: number;
        let signatureSGSender: SignerWithAddress;
        let signatureSGReceiver: SignerWithAddress;
        let signatureSGExpectedOrigin: SignerWithAddress;
        const amount = fp(1)
        const deadline = bn(123456789101112)

        sharedBeforeEach('validateSwapSignature', async () => {
          signatureSGKind = 0;
          signatureSGSender = deployer
          signatureSGReceiver = trader
          signatureSGExpectedOrigin = lp
          signatureSGInIndex = 0;
          const outIndex = signatureSGInIndex == 0? 1 : 0;
          signatureSGUserData = await pool.buildSwapDecodedUserData(
            signatureSGKind,
            {
              chainId: chainId,
              in: signatureSGInIndex,
              out: outIndex,
              amount: amount,
              signer: signer,
              from: signatureSGSender,
              recipient: signatureSGReceiver.address,
              deadline: deadline,
              expectedOrigin: signatureSGExpectedOrigin.address
            }
          )
          signatureSGUserDataWrongSigner = await pool.buildSwapDecodedUserData(
            signatureSGKind,
            {
              chainId: chainId,
              in: signatureSGInIndex,
              out: outIndex,
              amount: amount,
              signer: trader,
              from: signatureSGSender,
              recipient: signatureSGReceiver.address,
              deadline: deadline,
              expectedOrigin: signatureSGExpectedOrigin.address
            }
          )

        })
      
        it ('fails on empty signatureSGUserData', async () => {
          const signatureSGKind = 0;
          const isTokenInToken0 = true
          const signatureSGSender = deployer.address
          const signatureSGReceiver = trader.address
          const signatureSGUserData = "0x"
          await expect(
            pool.swapSignatureSafeguard(
              signatureSGKind,
              isTokenInToken0,
              signatureSGSender,
              signatureSGReceiver,
              signatureSGUserData
            )
          ).to.be.reverted
        });

        it ('fails on wrong signatureSGKind', async () => {
          await expect(
            pool.validateSwapSignature(
              signatureSGKind + 1,
              signatureSGInIndex == 0,
              signatureSGSender.address,
              signatureSGReceiver.address,
              signatureSGUserData[0],
              signatureSGUserData[1],
              signatureSGUserData[2],
              signatureSGUserData[3],
            )
          ).to.be.revertedWith("BAL#000");
        });

        it ('fails on wrong inIs0', async () => {
          await expect(
            pool.validateSwapSignature(
              signatureSGKind,
              signatureSGInIndex == 1,
              signatureSGSender.address,
              signatureSGReceiver.address,
              signatureSGUserData[0],
              signatureSGUserData[1],
              signatureSGUserData[2],
              signatureSGUserData[3],
            )
          ).to.be.revertedWith("BAL#000");
        });

        it ('fails on wrong signatureSGSender', async () => {
          await expect(
            pool.validateSwapSignature(
              signatureSGKind,
              signatureSGInIndex == 0,
              ZERO_ADDRESS,
              signatureSGReceiver.address,
              signatureSGUserData[0],
              signatureSGUserData[1],
              signatureSGUserData[2],
              signatureSGUserData[3],
            )
          ).to.be.revertedWith("BAL#000");
        });

        it ('fails on wrong recipient', async () => {
          await expect(
            pool.validateSwapSignature(
              signatureSGKind,
              signatureSGInIndex == 0,
              signatureSGSender.address,
              ZERO_ADDRESS,
              signatureSGUserData[0],
              signatureSGUserData[1],
              signatureSGUserData[2],
              signatureSGUserData[3],
            )
          ).to.be.revertedWith("BAL#000");
        });

        it ('fails on wrong quoteIndex', async () => {
          await expect(
            pool.validateSwapSignature(
              signatureSGKind,
              signatureSGInIndex == 0,
              signatureSGSender.address,
              signatureSGReceiver.address,
              signatureSGUserData[0],
              signatureSGUserData[1],
              bnSum([signatureSGUserData[2], 1]),
              signatureSGUserData[3],
            )
          ).to.be.revertedWith("BAL#000");
        });
      
        it ('fails on wrong deadline', async () => {
          await expect(
            pool.validateSwapSignature(
              signatureSGKind,
              signatureSGInIndex == 0,
              signatureSGSender.address,
              signatureSGReceiver.address,
              signatureSGUserData[0],
              signatureSGUserData[1],
              signatureSGUserData[2],
              bnSum([signatureSGUserData[3], 1]),
            )
          ).to.be.revertedWith("BAL#000");
        });

        it ('fails on replay', async () => {
          let isQuoteUsed = await pool.isQuoteUsed(signatureSGUserData[2])
          expect(isQuoteUsed).to.be.false
          await validSignature()
          isQuoteUsed = await pool.isQuoteUsed(signatureSGUserData[2])
          expect(isQuoteUsed).to.be.true
          await expect(
            validSignature()
          ).to.be.revertedWith("error: quote already used")
        });

        it ('fails on wrong signer', async () => {
          await expect(
            pool.validateSwapSignature(
              signatureSGKind,
              signatureSGInIndex == 0,
              signatureSGSender.address,
              signatureSGReceiver.address,
              signatureSGUserDataWrongSigner[0],
              signatureSGUserDataWrongSigner[1],
              signatureSGUserDataWrongSigner[2],
              signatureSGUserDataWrongSigner[3],
            )
          ).to.be.revertedWith("BAL#000");
        });

        it ('fails on wrong amount', async () => {
          let signatureSGUserDataWrongData: [string, string, BigNumberish, BigNumberish] = [...signatureSGUserData]
          signatureSGUserDataWrongData[0] = signatureSGUserDataWrongData[0].replace(
            amount.toHexString().slice(2).padStart(64, '0'), 
            amount.add(1).toHexString().slice(2).padStart(64, '0')
          )
          await expect(
            pool.validateSwapSignature(
              signatureSGKind,
              signatureSGInIndex == 0,
              signatureSGSender.address,
              signatureSGReceiver.address,
              signatureSGUserDataWrongData[0],
              signatureSGUserDataWrongData[1],
              signatureSGUserDataWrongData[2],
              signatureSGUserDataWrongData[3],
            )
          ).to.be.revertedWith("BAL#000");
        });

        it ('fails on expected origin', async () => {
          let signatureSGUserDataWrongData: [string, string, BigNumberish, BigNumberish] = [...signatureSGUserData]
          signatureSGUserDataWrongData[0] = signatureSGUserDataWrongData[0].replace(
            signatureSGExpectedOrigin.address.toLowerCase().slice(2).padStart(64, '0'), 
            deployer.address.toLowerCase().slice(2).padStart(64, '0')
          )
          await expect(
            pool.validateSwapSignature(
              signatureSGKind,
              signatureSGInIndex == 0,
              signatureSGSender.address,
              signatureSGReceiver.address,
              signatureSGUserDataWrongData[0],
              signatureSGUserDataWrongData[1],
              signatureSGUserDataWrongData[2],
              signatureSGUserDataWrongData[3],
            )
          ).to.be.revertedWith("BAL#000");
        });

        it ('valid ', async () => {
          await expect(
            validSignature()
          ).not.to.be.reverted;
        });

        async function validSignature() {
          await pool.validateSwapSignature(
            signatureSGKind,
            signatureSGInIndex == 0,
            signatureSGSender.address,
            signatureSGReceiver.address,
            signatureSGUserData[0],
            signatureSGUserData[1],
            signatureSGUserData[2],
            signatureSGUserData[3],
          )
        }
      
      });

      context('isLPAllowed', () => {
        
        it('valid', async () => {

          const block = await ethers.provider.getBlockNumber();
          const blockTimestamp = (await ethers.provider.getBlock(block)).timestamp;

          const deadline = bn(blockTimestamp + 1 * MINUTE)
          const sender = deployer.address
          const joinData = "0x0123"
          const userData = await pool.getALlowListUserData(chainId, sender, deadline, signer, joinData);
          const actualJoinData = await pool.isLPAllowed(
            sender,
            userData
          )
          expect(actualJoinData).to.eq(joinData)
        });

        it('fails on too large deadline', async () => {

          const block = await ethers.provider.getBlockNumber();

          const deadline = MAX_UINT112
          const sender = deployer.address
          const joinData = "0x0123"
          const userData = await pool.getALlowListUserData(chainId, sender, deadline, signer, joinData);
          await expect(
            pool.isLPAllowed(
              sender,
              userData
            )
          ).to.be.revertedWith("BAL#440")
        });

        it('fails on expired deadline', async () => {

          const block = await ethers.provider.getBlockNumber();
          const blockTimestamp = (await ethers.provider.getBlock(block)).timestamp;

          const deadline = bn(blockTimestamp - 3600)
          const sender = deployer.address
          const joinData = "0x0123"
          const userData = await pool.getALlowListUserData(chainId, sender, deadline, signer, joinData);
          await expect(
            pool.isLPAllowed(
              sender,
              userData
            )
          ).to.be.revertedWith("BAL#440")
        });

        it('fails on wrong signer', async () => {

          const block = await ethers.provider.getBlockNumber();
          const blockTimestamp = (await ethers.provider.getBlock(block)).timestamp;

          const deadline = bn(blockTimestamp + 1 * MINUTE)
          const sender = deployer.address
          const joinData = "0x0123"
          const userData = await pool.getALlowListUserData(chainId, sender, deadline, trader, joinData);
          await expect(
            pool.isLPAllowed(
              sender,
              userData
            )
          ).to.be.revertedWith("BAL#699")
        });

        it('fails on wrong sender', async () => {

          const block = await ethers.provider.getBlockNumber();
          const blockTimestamp = (await ethers.provider.getBlock(block)).timestamp;

          const deadline = bn(blockTimestamp + 1 * MINUTE)
          const sender = deployer.address
          const joinData = "0x0123"
          const userData = await pool.getALlowListUserData(chainId, sender, deadline, signer, joinData);
          await expect(
            pool.isLPAllowed(
              trader.address,
              userData
            )
          ).to.be.revertedWith("BAL#699")
        });

      });

    });
  
  });

});
