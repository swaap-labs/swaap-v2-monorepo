import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import { DAY } from "@balancer-labs/v2-helpers/src/time";
dotenv.config({ path: __dirname+'/.env' });

const factoryAddress = "0x03C01Acae3D0173a93d819efDc832C7C4F153B06"; // Safeguard factory on polygon

const name = "Swaap USDC-WETH Safeguard";
const symbol = "s-USDC-WETH-Sa";

const token0 = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174"; // USDC on polygon
const oracle0 = "0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7"; // chainlink USDC oracle on polygon
const maxTimeOut0 = 1 * DAY;
const isStable0 = true;
const isFlexibleOracle0 = true;

const token1 = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"; // WETH on polygon
const maxTimeOut1 = 1 * DAY;
const oracle1 = "0xF9680D99D6C9589e2a93a78A04A279e509205945"; // chainlink WETH oracle on polygon
const isStable1 = false;
const isFlexibleOracle1 = false;

const signer = process.env.QUOTE_SIGNER;
const maxPerfDev = ethers.utils.parseEther('0.97'); // 3% deviation tolerance
const maxTargetDev = ethers.utils.parseEther('0.90'); // 10% deviation tolerance
const maxPriceDev = ethers.utils.parseEther('0.99'); // 1% deviation tolerance
const perfUpdateInterval = 1 * DAY;
const yearlyFees = ethers.utils.parseEther('0'); // 0% yearly fees
const mustAllowlistLPs = false;

const setPegStates = true;

const tokens = [token0, token1];

const oracleParams = [
  [
    oracle0,
    maxTimeOut0,
    isStable0,
    isFlexibleOracle0
  ],
  [
    oracle1,
    maxTimeOut1,
    isStable1,
    isFlexibleOracle1
  ]
];

const safeguardParameters = [
  signer,
  maxPerfDev,
  maxTargetDev,
  maxPriceDev,
  perfUpdateInterval,
  yearlyFees,
  mustAllowlistLPs
]

async function main() {

  const factory = await ethers.getContractAt("SafeguardFactory", factoryAddress);
  
  const salt = ethers.utils.randomBytes(32);

  const tx = await factory.create(
    [
      name,
      symbol,
      tokens,
      oracleParams,
      safeguardParameters,
      setPegStates
    ],
    salt
  );
  
  const receipt = await tx.wait();
  const eventPoolCreated = receipt.events?.filter((x: any) => x.event == "PoolCreated")[0];
  console.log(`pool address: ${eventPoolCreated.args.pool}`);
  
  // print pool id
  const pool = await ethers.getContractAt("SafeguardPool", eventPoolCreated.args.pool);
  const poolId = await pool.getPoolId();
  console.log(`pool id: ${poolId}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
