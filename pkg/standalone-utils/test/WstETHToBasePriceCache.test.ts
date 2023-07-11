import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { expect } from 'chai';
import { expectRelativeErrorBN } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

describe('WstETHToBasePriceAdapter', function () {
    
    // calculated by hand at blocknumber 17635689
    const expectedPrice = BigNumber.from(fp(2121.90044498));

    // tolerance of 1e-6
    const tolerance = BigNumber.from(1e9);

    // mainnet addresses
    const STETH_CL_AGGREGATOR = '0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8';
    const STETH_ADDRESS = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';

    const description = "wstETH / USD";
    let wstETHToBasePriceAdapter: Contract;
    let aggregatorV3: Contract;

    before('deploy WstETHToBasePriceAdapter', async () => {
        const WstETHToBasePriceAdapter = await ethers.getContractFactory('WstETHToBasePriceCache');
            
        wstETHToBasePriceAdapter = await WstETHToBasePriceAdapter.deploy(
            STETH_CL_AGGREGATOR,
            STETH_ADDRESS,
            description
        );

        aggregatorV3 = await ethers.getContractAt('AggregatorV3Interface', STETH_CL_AGGREGATOR);
    });

    it('should give wstETH / usd price correctly', async () => {

        const roundData = await wstETHToBasePriceAdapter.latestRoundData();

        const actualPrice = roundData[1];
        
        expectRelativeErrorBN(actualPrice, expectedPrice, tolerance);

        const clRoundData = await aggregatorV3.latestRoundData();

        expect(roundData[0]).to.equal(clRoundData.roundId);
        expect(roundData[2]).to.equal(clRoundData.startedAt);
        expect(roundData[3]).to.equal(clRoundData.updatedAt);
        expect(roundData[4]).to.equal(clRoundData.answeredInRound);
    });


    it('should revert if update time is not up to date', async () => {
        // advance time by 2 months
        await ethers.provider.send("evm_increaseTime", [60 * 3600 * 24]);
        // mine a block to update timestamp of the last block
        await ethers.provider.send("evm_mine", []);

        await expect(wstETHToBasePriceAdapter.latestRoundData()).to.be.revertedWith("SWAAP#23");
    });

    it('should revert when paused', async () => {
        await wstETHToBasePriceAdapter.pause();
        await expect(wstETHToBasePriceAdapter.latestRoundData()).to.be.revertedWith("SWAAP#31");
    });

});