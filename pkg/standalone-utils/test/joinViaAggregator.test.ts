import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { expect } from 'chai';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { SafeguardPoolEncoder } from '@swaap-labs/v2-swaap-js/src/safeguard-pool/encoder';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { getPermitCallData } from './helpers/SignPermit';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

// load quotes for tests
const quotes = require('./quotes.json');

describe('joinViaAggregator', function () {

    const TRANSFER_TOPIC_0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const WITHDRAWAL_TOPIC_0 = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';

    let proxyJoinViaAggregator: Contract;
    // forked mainnet at block: 17963759
    const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const NATIVE_ADDRESS = ZERO_ADDRESS;
    const VAULT_ADDRESS = '0xd315a9c38ec871068fec378e4ce78af528c76293';
    const ZERO_EX_ADDRESS = '0xdef1c0ded9bec7f1a1670819833240f027b25eff';
    const PARASWAP_ADDRESS = '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57';
    const ONE_INCH_ADDRESS = '0x1111111254eeb25477b68fb85ed929f73a960582';
    const ODOS_ADDRESS = '0xcf5540fffcdc3d510b18bfca6d2b9987b0772559';
    
    // poolIds
    const USDC_WETH_POOL_ID = "0x5ee945d9bfa5ad48c64fc7acfed497d3546c0d03000200000000000000000000";
    const USDC_USDT_POOL_ID = "0xa441cf75bcfb5833cb1ba7c93a0721ae9b292789000200000000000000000001";

    // we impersonate circle contract to fund signer accounts with usdc and usdt quickly
    const BANK_ACCOUNT = '0x55fe002aeff02f77364de339a1292923a15844b8'; // '0x9B7A417Cde9D1e116958E4aaEF6c09928E0fe5BD'; // 0xbe0eb53f46cd790cd13851d5eff43d12404d33e8
    const SWAAP_DAO_MAINNET = '0xD6Ff6aBb93EF058A474769f0d05C7fEF440920F8';
    const AUTHORIZER = '0xCA19Ed3182E6e591207E959de633a14825Cc123c';
    const GRANT_ROLE_SIGNATURE = '0x2f2ff15d';

    let signer: SignerWithAddress;

    // define tokens contracts
    let weth: Contract;
    let usdt: Contract;
    let usdc: Contract;
    let usdcPermit: Contract;

    async function setupProxyAndApprovals() {
        // get signer from hardhat 
        [signer] = await ethers.getSigners();

        const ProxyJoinViaAggregator = await ethers.getContractFactory("ProxyJoinViaAggregator");
        proxyJoinViaAggregator = await ProxyJoinViaAggregator.connect(signer).deploy(
            VAULT_ADDRESS,
            WETH_ADDRESS,
            ZERO_EX_ADDRESS,
            PARASWAP_ADDRESS,
            ONE_INCH_ADDRESS,
            ODOS_ADDRESS
        );

        weth = await ethers.getContractAt('IWETH', WETH_ADDRESS);
        usdt = await ethers.getContractAt('IERC20', USDT_ADDRESS);
        usdc = await ethers.getContractAt('IERC20', USDC_ADDRESS);
        usdcPermit = await ethers.getContractAt('IERC20Permit', USDC_ADDRESS);

        // set approval for proxyJoinViaAggregator
        await weth.connect(signer).approve(proxyJoinViaAggregator.address, fp(1000));
        await usdt.connect(signer).approve(proxyJoinViaAggregator.address, fp(1000));
        await usdc.connect(signer).approve(proxyJoinViaAggregator.address, fp(1000));

        // transfer 0.5 eth to bank account
        await signer.sendTransaction({
            to: BANK_ACCOUNT,
            value: fp(0.5),
        });

        // transfer 0.5 eth to swaap dao
        await signer.sendTransaction({
            to: SWAAP_DAO_MAINNET,
            value: fp(0.5),
        });

        // transfering 10k of usdt and usdc to signer
        const bank = await ethers.getImpersonatedSigner(BANK_ACCOUNT);
        await usdt.connect(bank).transfer(signer.address, "10000000000");
        await usdc.connect(bank).transfer(signer.address, "10000000000");
    }

    async function ensureReceivedPoolTokens(poolId: string) {
        // pool id to pool address
        const poolAddress = poolId.slice(0, 42);
        // get lp pool token balance
        const poolToken = await ethers.getContractAt('IERC20', poolAddress);
        const lpPoolShares = await poolToken.balanceOf(signer.address);
        expect(lpPoolShares).to.be.gt(BigNumber.from(0));
    }


    before('deploy ProxyJoinViaAggregator', async () => {
        await loadFixture(setupProxyAndApprovals);
    });


    context('Pause / Unpause', async () => { 

        context('pause', async () => {

            it('should revert', async () => {
                await expect(proxyJoinViaAggregator.connect(signer).pause()).to.be.revertedWith("BAL#401");
            });

            it('should pause', async () => {
                const swaapDAO = await ethers.getImpersonatedSigner(SWAAP_DAO_MAINNET);
                
                const action = await actionId(proxyJoinViaAggregator, 'pause');
                
                const callInputs = ethers.utils.defaultAbiCoder.encode(
                    ['bytes32', 'address'],
                    [action, swaapDAO.address]
                );

                const callData = ethers.utils.solidityPack(
                    ['bytes4', 'bytes'],
                    [GRANT_ROLE_SIGNATURE, callInputs]
                );

                // calls grantRole(bytes32, address) on the authorizer contract
                await swaapDAO.sendTransaction({
                    to: AUTHORIZER,
                    data: callData
                });
            
                await proxyJoinViaAggregator.connect(swaapDAO).pause();
                expect(await proxyJoinViaAggregator.paused()).to.be.true;

                // try to join while paused
                const assets = [USDC_ADDRESS, WETH_ADDRESS];
                const maxAmountsIn = [1000e6, fp(1)];
                const bptAmountOut = fp(1);
                const userData = SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(bptAmountOut);
                const fromInternalBalance = false;

                const joinRequest = [
                    assets,
                    maxAmountsIn,
                    userData,
                    fromInternalBalance
                ];

                const quoteData1 = quotes["paraswap"]["WETH-USDC"];

                const quote1 = [
                    PARASWAP_ADDRESS,
                    ZERO_ADDRESS,
                    USDC_ADDRESS,
                    "1000000000000000000", // max sold tokens
                    "0", // min received tokens
                    quoteData1["spender"],
                    quoteData1["data"]
                ];

                const fillQuotes = [
                    quote1
                ];

                const deadline = BigNumber.from(ethers.constants.MaxUint256);

                const joiningTokens = [NATIVE_ADDRESS, USDC_ADDRESS];

                const joiningAmounts = [fp(2), 1500e6]; // 2 ETH and 1500 USDC

                const tx = proxyJoinViaAggregator.connect(signer).joinPoolViaAggregator(
                    USDC_WETH_POOL_ID,
                    joinRequest,
                    fillQuotes,
                    joiningTokens,
                    joiningAmounts,
                    "0",// minBptAmountOut,
                    deadline,
                    { value: joiningAmounts[0] }
                );

                await expect(tx).to.be.revertedWith("Pausable: paused");
            });
            
            it('should revert when not called by swaap dao', async () => {
                await expect(proxyJoinViaAggregator.connect(signer).pause()).to.be.revertedWith("BAL#401");
            });

        });

        context('unpause', async () => {
        
            it('should revert when not called by swaap dao', async () => {
                await expect(proxyJoinViaAggregator.connect(signer).unpause()).to.be.revertedWith("BAL#401");
            });
    
            it('should revert when not called by unapproved swaap dao', async () => {
                await expect(proxyJoinViaAggregator.connect(signer).unpause()).to.be.revertedWith("BAL#401");
            });

            it('should unpause', async () => {
                const swaapDAO = await ethers.getImpersonatedSigner(SWAAP_DAO_MAINNET);
                
                const action = await actionId(proxyJoinViaAggregator, 'unpause');
                
                const callInputs = ethers.utils.defaultAbiCoder.encode(
                    ['bytes32', 'address'],
                    [action, swaapDAO.address]
                );

                const callData = ethers.utils.solidityPack(
                    ['bytes4', 'bytes'],
                    [GRANT_ROLE_SIGNATURE, callInputs]
                );

                // calls grantRole(bytes32, address) on the authorizer contract
                await swaapDAO.sendTransaction({
                    to: AUTHORIZER,
                    data: callData
                });
            
                await proxyJoinViaAggregator.connect(swaapDAO).unpause();
                expect(await proxyJoinViaAggregator.paused()).to.be.false;

                // try to join while unpaused
                const assets = [USDC_ADDRESS, WETH_ADDRESS];

                const maxAmountsIn = [1000e6, fp(1)];
                const bptAmountOut = fp(1);
                const userData = SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(bptAmountOut);
                const fromInternalBalance = false;

                const joinRequest = [
                    assets,
                    maxAmountsIn,
                    userData,
                    fromInternalBalance
                ];

                const quoteData1 = quotes["paraswap"]["WETH-USDC"];

                const quote1 = [
                    PARASWAP_ADDRESS,
                    ZERO_ADDRESS,
                    USDC_ADDRESS,
                    "1000000000000000000", // max sold tokens
                    "0", // min received tokens
                    quoteData1["spender"],
                    quoteData1["data"]
                ];

                const fillQuotes = [
                    quote1
                ];

                const deadline = BigNumber.from(ethers.constants.MaxUint256);

                const joiningTokens = [NATIVE_ADDRESS, USDC_ADDRESS];

                const joiningAmounts = [fp(2), 1500e6]; // 2 ETH and 1500 USDC

                const tx = await proxyJoinViaAggregator.connect(signer).joinPoolViaAggregator(
                    USDC_WETH_POOL_ID,
                    joinRequest,
                    fillQuotes,
                    joiningTokens,
                    joiningAmounts,
                    "0",// minBptAmountOut,
                    deadline,
                    { value: joiningAmounts[0] }
                );
                
                await expect(tx).to.not.be.reverted;
            });
 
        
        });
        
    });

    context('joinViaAggregator with 2 tokens in the pool', async () => {


        beforeEach('deploy ProxyJoinViaAggregator', async () => {
            await loadFixture(setupProxyAndApprovals);
        });
    
        afterEach('ensure no tokens in proxy', async () => {
            await ensureNoTokensInProxy();
        });
    
        it('Revert when using unauthorized aggregator', async () => {

            const assets = [USDC_ADDRESS, WETH_ADDRESS];
            const maxAmountsIn = [1000e6, fp(1)];
            const bptAmountOut = fp(1);
            const userData = SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(bptAmountOut);
            const fromInternalBalance = false;

            const joinRequest = [
                assets,
                maxAmountsIn,
                userData,
                fromInternalBalance
            ];

            const quoteData1 = quotes["paraswap"]["WETH-USDC"];

            const quote1 = [
                VAULT_ADDRESS, // unauthorized aggregator
                ZERO_ADDRESS,
                USDC_ADDRESS,
                "1000000000000000000", // max sold tokens
                "0", // min received tokens
                quoteData1["spender"],
                quoteData1["data"]
            ];

            const fillQuotes = [
                quote1
            ];

            const deadline = BigNumber.from(ethers.constants.MaxUint256);

            const joiningTokens = [NATIVE_ADDRESS, USDC_ADDRESS];
            const joiningAmounts = [fp(2), 1500e6]; // 2 ETH and 1500 USDC

            expect(proxyJoinViaAggregator.connect(signer).joinPoolViaAggregator(
                USDC_WETH_POOL_ID,
                joinRequest,
                fillQuotes,
                joiningTokens,
                joiningAmounts,
                "0",// minBptAmountOut,
                deadline,
                { value: joiningAmounts[0] }
            )).to.be.revertedWith("SWAAP#32");

        });   

        it('joining with ETH and USDC', async () => {

            const assets = [USDC_ADDRESS, WETH_ADDRESS];
            const maxAmountsIn = [1000e6, fp(1)];
            const bptAmountOut = fp(1);
            const userData = SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(bptAmountOut);
            const fromInternalBalance = false;

            const joinRequest = [
                assets,
                maxAmountsIn,
                userData,
                fromInternalBalance
            ];

            const quoteData1 = quotes["paraswap"]["WETH-USDC"];

            const quote1 = [
                PARASWAP_ADDRESS,
                ZERO_ADDRESS,
                USDC_ADDRESS,
                "1000000000000000000", // max sold tokens
                "0", // min received tokens
                quoteData1["spender"],
                quoteData1["data"]
            ];

            const fillQuotes = [
                quote1
            ];

            const deadline = BigNumber.from(ethers.constants.MaxUint256);

            const joiningTokens = [NATIVE_ADDRESS, USDC_ADDRESS];
            const joiningAmounts = [fp(2), 1500e6]; // 2 ETH and 1500 USDC

            const tx = await proxyJoinViaAggregator.connect(signer).joinPoolViaAggregator(
                USDC_WETH_POOL_ID,
                joinRequest,
                fillQuotes,
                joiningTokens,
                joiningAmounts,
                "0",// minBptAmountOut,
                deadline,
                { value: joiningAmounts[0] }
            );
            
            // const receipt = await tx.wait();
            await ensureMaximizedJoin(tx, assets);

            // check transfer events for usdc and weth back to signer
            
            await ensureReceivedPoolTokens(USDC_WETH_POOL_ID);
        });
        
        it('joining with WETH and USDC', async () => {
            
            const assets = [USDC_ADDRESS, WETH_ADDRESS];
            const maxAmountsIn = [1000e6, fp(1)];
            const bptAmountOut = fp(1);
            const userData = SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(bptAmountOut);
            const fromInternalBalance = false;

            const joinRequest = [
                assets,
                maxAmountsIn,
                userData,
                fromInternalBalance
            ];
            
            const quoteData1 = quotes["paraswap"]["WETH-USDC"];

            const quote1 = [
                PARASWAP_ADDRESS,
                WETH_ADDRESS,
                USDC_ADDRESS,
                "1000000000000000000", // max sold tokens
                "0", // min received tokens
                quoteData1["spender"],
                quoteData1["data"]
            ];

            const fillQuotes = [
                quote1
            ];

            const deadline = BigNumber.from(ethers.constants.MaxUint256);

            const joiningTokens = [WETH_ADDRESS, USDC_ADDRESS];
            const joiningAmounts = [fp(2), 1500e6]; // 2 ETH and 1500 USDC

            // deposit ETH for WETh
            await weth.connect(signer).deposit({ value: joiningAmounts[0] });

            const tx = await proxyJoinViaAggregator.connect(signer).joinPoolViaAggregator(
                USDC_WETH_POOL_ID,
                joinRequest,
                fillQuotes,
                joiningTokens,
                joiningAmounts,
                "0",// minBptAmountOut,
                deadline
            );
            
            await ensureMaximizedJoin(tx, assets);
            await ensureReceivedPoolTokens(USDC_WETH_POOL_ID);
        });

        it('permit and joining with USDC', async () => {
            
            const assets = [USDC_ADDRESS, WETH_ADDRESS];
            const maxAmountsIn = [BigNumber.from("1000000000"), fp(1)];
            const bptAmountOut = fp(1);
            const userData = SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(bptAmountOut);
            const fromInternalBalance = false;

            const joinRequest = [
                assets,
                maxAmountsIn,
                userData,
                fromInternalBalance
            ];
            
            const quoteData1 = quotes["1inch"]["USDC-WETH"];

            const quote1 = [
                ONE_INCH_ADDRESS,
                USDC_ADDRESS,
                WETH_ADDRESS,
                "1000000000000000000", // max sold tokens
                "0", // min received tokens
                quoteData1["spender"],
                quoteData1["tx"]["data"]
            ];

            const fillQuotes = [
                quote1
            ];

            const deadline = BigNumber.from(ethers.constants.MaxUint256);

            const joiningTokens = [USDC_ADDRESS];
            const joiningAmounts = [2000000000];

            // Unapprove USDC
            await usdc.connect(signer).approve(proxyJoinViaAggregator.address, 0);

            const permitCallData = await getPermitCallData(
                "USD Coin",
                "2",
                1,
                signer,
                proxyJoinViaAggregator.address,
                ethers.constants.MaxUint256, // approve amount
                await usdcPermit.nonces(signer.address),
                ethers.constants.MaxUint256, // deadline
                // signature: string,
                usdc
            );

            const permit1 = [
                USDC_ADDRESS,
                permitCallData
            ];

            const permits = [permit1];

            const tx = await proxyJoinViaAggregator.connect(signer).permitJoinPoolViaAggregator(
                USDC_WETH_POOL_ID,
                joinRequest,
                fillQuotes,
                joiningTokens,
                joiningAmounts,
                permits,
                "0",// minBptAmountOut,
                deadline
            );

            await ensureMaximizedJoin(tx, assets);
            await ensureReceivedPoolTokens(USDC_WETH_POOL_ID);
        });

    });

    context('joinViaAggregator with 1 token in the pool', async () => {

        beforeEach('deploy ProxyJoinViaAggregator', async () => {
            await loadFixture(setupProxyAndApprovals);
        });
    
        afterEach('ensure no tokens in proxy', async () => {
            await ensureNoTokensInProxy();
        });

        it('joining with ETH', async () => {

            const assets = [USDC_ADDRESS, WETH_ADDRESS];
            const maxAmountsIn = [BigNumber.from("1000000000"), fp(1)];
            const bptAmountOut = fp(1);
            const userData = SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(bptAmountOut);
            const fromInternalBalance = false;

            const joinRequest = [
                assets,
                maxAmountsIn,
                userData,
                fromInternalBalance
            ];
            
            const quoteData1 = quotes["paraswap"]["WETH-USDC"];

            const quote1 = [
                PARASWAP_ADDRESS,
                ZERO_ADDRESS,
                USDC_ADDRESS,
                "1000000000000000000", // max sold tokens
                "0", // min received tokens
                quoteData1["spender"],
                quoteData1["data"]
            ];

            const fillQuotes = [
                quote1
            ];

            const deadline = BigNumber.from(ethers.constants.MaxUint256);

            const joiningTokens = [NATIVE_ADDRESS];
            const joiningAmounts = [fp(2)];

            const tx = await proxyJoinViaAggregator.connect(signer).joinPoolViaAggregator(
                USDC_WETH_POOL_ID,
                joinRequest,
                fillQuotes,
                joiningTokens,
                joiningAmounts,
                "0",// minBptAmountOut,
                deadline,
                { value: joiningAmounts[0] }
            );

            await ensureMaximizedJoin(tx, assets);
            await ensureReceivedPoolTokens(USDC_WETH_POOL_ID);
        });
        
        it('joining with WETH', async () => {
            
            const assets = [USDC_ADDRESS, WETH_ADDRESS];
            const maxAmountsIn = [BigNumber.from("1000000000"), fp(1)];
            const bptAmountOut = fp(1);
            const userData = SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(bptAmountOut);
            const fromInternalBalance = false;

            const joinRequest = [
                assets,
                maxAmountsIn,
                userData,
                fromInternalBalance
            ];
            
            const quoteData1 = quotes["paraswap"]["WETH-USDC"];

            const quote1 = [
                PARASWAP_ADDRESS,
                WETH_ADDRESS,
                USDC_ADDRESS,
                "1000000000000000000", // max sold tokens
                "0", // min received tokens
                quoteData1["spender"],
                quoteData1["data"]
            ];

            const fillQuotes = [
                quote1
            ];

            const deadline = BigNumber.from(ethers.constants.MaxUint256);

            const joiningTokens = [WETH_ADDRESS];
            const joiningAmounts = [fp(2)];

            // deposit ETH for WETh
            await weth.connect(signer).deposit({ value: joiningAmounts[0] });

            const tx = await proxyJoinViaAggregator.connect(signer).joinPoolViaAggregator(
                USDC_WETH_POOL_ID,
                joinRequest,
                fillQuotes,
                joiningTokens,
                joiningAmounts,
                "0",// minBptAmountOut,
                deadline
            );

            await ensureMaximizedJoin(tx, assets);
            await ensureReceivedPoolTokens(USDC_WETH_POOL_ID);
        });

        it('permit and joining with USDC', async () => {
            
            const assets = [USDC_ADDRESS, WETH_ADDRESS];
            const maxAmountsIn = [BigNumber.from("1000000000"), fp(1)];
            const bptAmountOut = fp(1);
            const userData = SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(bptAmountOut);
            const fromInternalBalance = false;

            const joinRequest = [
                assets,
                maxAmountsIn,
                userData,
                fromInternalBalance
            ];
            
            const quoteData1 = quotes["1inch"]["USDC-WETH"];

            const quote1 = [
                ONE_INCH_ADDRESS,
                USDC_ADDRESS,
                WETH_ADDRESS,
                "1000000000000000000", // max sold tokens
                "0", // min received tokens
                quoteData1["spender"],
                quoteData1["tx"]["data"]
            ];

            const fillQuotes = [
                quote1
            ];

            const deadline = BigNumber.from(ethers.constants.MaxUint256);

            const joiningTokens = [USDC_ADDRESS];
            const joiningAmounts = [2000000000];

            // Unapprove USDC
            await usdc.connect(signer).approve(proxyJoinViaAggregator.address, 0);

            const permitCallData = await getPermitCallData(
                "USD Coin",
                "2",
                1,
                signer,
                proxyJoinViaAggregator.address,
                ethers.constants.MaxUint256, // approve amount
                await usdcPermit.nonces(signer.address),
                ethers.constants.MaxUint256, // deadline
                // signature: string,
                usdc
            );

            const permit1 = [
                USDC_ADDRESS,
                permitCallData
            ];

            const permits = [permit1];

            const tx = await proxyJoinViaAggregator.connect(signer).permitJoinPoolViaAggregator(
                USDC_WETH_POOL_ID,
                joinRequest,
                fillQuotes,
                joiningTokens,
                joiningAmounts,
                permits,
                "0",// minBptAmountOut,
                deadline
            );

            await ensureMaximizedJoin(tx, assets);
            await ensureReceivedPoolTokens(USDC_WETH_POOL_ID);
        });

    });

    context('joinViaAggregator with no tokens in the pool', async () => {

        beforeEach('deploy ProxyJoinViaAggregator', async () => {
            await loadFixture(setupProxyAndApprovals);
        });
    
        afterEach('ensure no tokens in proxy', async () => {
            await ensureNoTokensInProxy();
        });

        it('joining with ETH', async () => {
                        
            const assets = [USDC_ADDRESS, USDT_ADDRESS];
            const maxAmountsIn = [BigNumber.from("1000000000"), fp(1)];
            const bptAmountOut = fp(1);
            const userData = SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(bptAmountOut);
            const fromInternalBalance = false;

            const joinRequest = [
                assets,
                maxAmountsIn,
                userData,
                fromInternalBalance
            ];
            
            const quoteData1 = quotes["paraswap"]["WETH-USDC"];
            const quoteData2 = quotes["1inch"]["WETH-USDT"];

            const quote1 = [
                PARASWAP_ADDRESS,
                ZERO_ADDRESS,
                USDC_ADDRESS,
                fp(1), // max sold tokens
                "0", // min received tokens
                quoteData1["spender"],
                quoteData1["data"]
            ];

            const quote2 = [
                ONE_INCH_ADDRESS,
                ZERO_ADDRESS,
                USDT_ADDRESS,
                fp(1), // max sold tokens
                "0", // min received tokens
                quoteData2["spender"],
                quoteData2["tx"]["data"]
            ];

            const fillQuotes = [
                quote1,
                quote2
            ];

            const deadline = BigNumber.from(ethers.constants.MaxUint256);

            const joiningTokens = [NATIVE_ADDRESS];
            const joiningAmounts = [fp(2)];

            const tx = await proxyJoinViaAggregator.connect(signer).joinPoolViaAggregator(
                USDC_USDT_POOL_ID,
                joinRequest,
                fillQuotes,
                joiningTokens,
                joiningAmounts,
                "0",// minBptAmountOut,
                deadline,
                { value: joiningAmounts[0] }
            );

            await ensureMaximizedJoin(tx, assets);
            await ensureReceivedPoolTokens(USDC_USDT_POOL_ID);
        });
        
        it('joining with WETH', async () => {
                        
            const assets = [USDC_ADDRESS, USDT_ADDRESS];
            const maxAmountsIn = [BigNumber.from("1000000000"), fp(1)];
            const bptAmountOut = fp(1);
            const userData = SafeguardPoolEncoder.joinAllTokensInForExactBPTOut(bptAmountOut);
            const fromInternalBalance = false;

            const joinRequest = [
                assets,
                maxAmountsIn,
                userData,
                fromInternalBalance
            ];
            
            const quoteData1 = quotes["paraswap"]["WETH-USDC"];
            const quoteData2 = quotes["1inch"]["WETH-USDT"];

            const quote1 = [
                PARASWAP_ADDRESS,
                WETH_ADDRESS,
                USDC_ADDRESS,
                fp(1), // max sold tokens
                "0", // min received tokens
                quoteData1["spender"],
                quoteData1["data"]
            ];

            const quote2 = [
                ONE_INCH_ADDRESS,
                ZERO_ADDRESS,
                USDT_ADDRESS,
                fp(1), // max sold tokens
                "0", // min received tokens
                quoteData2["spender"],
                quoteData2["tx"]["data"]
            ];

            const fillQuotes = [
                quote1,
                quote2
            ];

            const deadline = BigNumber.from(ethers.constants.MaxUint256);

            const joiningTokens = [WETH_ADDRESS];
            const joiningAmounts = [fp(2)];

            // deposit ETH for WETh
            await weth.connect(signer).deposit({ value: joiningAmounts[0] });

            const tx = await proxyJoinViaAggregator.connect(signer).joinPoolViaAggregator(
                USDC_USDT_POOL_ID,
                joinRequest,
                fillQuotes,
                joiningTokens,
                joiningAmounts,
                "0",// minBptAmountOut,
                deadline
            );

            await ensureMaximizedJoin(tx, assets);
            await ensureReceivedPoolTokens(USDC_USDT_POOL_ID);
        });

    });

    async function ensureNoTokensInProxy() {
        // expect eth balance to be 0
        expect(await ethers.provider.getBalance(proxyJoinViaAggregator.address)).to.be.equal(BigNumber.from(0));
        // expect token balances to be 0
        expect(await weth.balanceOf(proxyJoinViaAggregator.address)).to.be.equal(BigNumber.from(0));
        expect(await usdt.balanceOf(proxyJoinViaAggregator.address)).to.be.equal(BigNumber.from(0));
        expect(await usdc.balanceOf(proxyJoinViaAggregator.address)).to.be.equal(BigNumber.from(0));
    }

    // we expect to have one of the joining assets to be maximized when joining the pool
    // therefore we expect to have a transfer event from the proxy to the user with low amount
    // or a missing transfer event since there are no leftover tokens to be transfered to the user
    async function ensureMaximizedJoin(tx: any, assets: string[]) {
        const receipt = await tx.wait();

        let atLeastOneTokenDepleted = false;

        for(let asset of assets) {

            const transferEvents = receipt.events?.filter((event: any) => 
                // case where ERC20 was left behind after joining a pool containing it
                (
                    event.topics.length == 3
                    && event.topics[0].toLowerCase() == TRANSFER_TOPIC_0.toLowerCase() // verify transfer event
                    && event.address.toLowerCase() == asset.toLowerCase() // verify token address
                    && ("0x" + event.topics[1].slice(26)).toLowerCase() == proxyJoinViaAggregator.address.toLowerCase() // verify from address
                    && ("0x" + event.topics[2].slice(26)).toLowerCase() == signer.address.toLowerCase() // verify to address
                )
                ||
                // case where ETH was left behind after joining a pool containing WETH
                (
                    asset.toLowerCase() == WETH_ADDRESS.toLowerCase()
                    && event.topics.length == 2
                    && event.topics[0].toLowerCase() == WITHDRAWAL_TOPIC_0.toLowerCase() // verify withdrawal event
                    && event.address.toLowerCase() == WETH_ADDRESS.toLowerCase() // verify token address
                    && ("0x" + event.topics[1].slice(26)).toLowerCase() == proxyJoinViaAggregator.address.toLowerCase() // verify to address
                )
            );

            // no leftover sent to the user
            if(transferEvents.length == 0) {
                atLeastOneTokenDepleted = true;
                break;
            }

            // verify if small leftover sent to the user
            const amount = BigNumber.from(transferEvents[0].data);

            if(amount.lte(100)) {
                atLeastOneTokenDepleted = true;
                break;
            }
        };

        expect(atLeastOneTokenDepleted).to.be.true;

    }

});