import { DELEGATE_OWNER, ZERO_ADDRESS } from "@balancer-labs/v2-helpers/src/constants";
import { ethers } from "hardhat";
import { DAY } from "@balancer-labs/v2-helpers/src/time";
import * as dotenv from "dotenv";
dotenv.config({ path: __dirname+'/.env' });

// TODO: INSERT QUOTE SIGNER ADDRESS
const signerAddress = process.env.QUOTE_SIGNER;

// token0 and token1 must be ordered such that address(token0) < address(token1) 
const vaultAddress = "0xBA12222222228d8Ba445958a75a0704d566BF2C8"; // balancer's vault on polygon
const name = "Pool Safeguard";
const symbol = "Pool Safeguard";
const pauseWindowDuration = 270 * DAY // max pauseWindowDuration
const bufferPeriodDuration = 90 * DAY // max bufferPeriodDuration

const token0 = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174"; // USDC on polygon
const oracle0 = "0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7"; // chainlink USDC oracle on polygon
const isStable0 = true;
const isFlexibleOracle0 = true;

const token1 = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"; // WETH on polygon
const oracle1 = "0xF9680D99D6C9589e2a93a78A04A279e509205945"; // chainlink WETH oracle on polygon
const isStable1 = false;
const isFlexibleOracle1 = false;

const maxPerfDev = ethers.utils.parseEther('0.97'); // 3% deviation tolerance
const maxTargetDev = ethers.utils.parseEther('0.95'); // 5% deviation tolerance
const maxPriceDev = ethers.utils.parseEther('0.97'); // 3% deviation tolerance
const perfUpdateInterval = 1 * DAY;
const yearlyFees = ethers.utils.parseEther('0.01'); // 1% yearly fees
const mustAllowlistLPs = false;

const constructorArgs = [
  vaultAddress, // vault
  name, // name
  symbol, // symbol
  [token0,  token1], // tokens
  [ZERO_ADDRESS, ZERO_ADDRESS], // assetManagers
  pauseWindowDuration,
  bufferPeriodDuration,
  DELEGATE_OWNER, // owner
  [ // oracleParameters
      [
        oracle0, // oracle address
        isStable0, // is token stable
        isFlexibleOracle0 // can the oracle be pegged to 1
      ],
      [
        oracle1, // oracle address
        isStable1, // is token stable
        isFlexibleOracle1 // can the oracle be pegged to 1
      ]
  ],
  [ // safeguardParameters
    signerAddress, // signerAddress
    maxPerfDev, // maxPerfDev
    maxTargetDev, // maxTargetDev
    maxPriceDev, // maxPriceDev
    perfUpdateInterval, // perfUpdateInterval
    yearlyFees, // yearlyFees
    mustAllowlistLPs // mustAllowlistLPs
  ]
]

async function main() {

  const Pool = await ethers.getContractFactory("SafeguardPool");
  const pool = await Pool.deploy(...constructorArgs);

  await pool.deployed();
  
  console.log(`pool address: ${pool.address}`);
  const poolId = await pool.getPoolId();
  console.log(`poolId: ${poolId}`);
  
  if(isFlexibleOracle0 || isFlexibleOracle1) {
    console.log("Evaluating peg states");
    const tx = await pool.evaluateStablesPegStates();
    await tx.wait();
    console.log("Peg states evaluated");
  }

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
