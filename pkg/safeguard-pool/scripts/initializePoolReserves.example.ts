import { ethers } from "hardhat";
import { SafeguardPoolEncoder } from "@swaap-labs/v2-swaap-js"
import * as dotenv from "dotenv";
import { BigNumber } from "@balancer-labs/v2-helpers/src/numbers";
dotenv.config({ path: __dirname+'/.env' });

const vaultAddress = "0xd315a9c38ec871068fec378e4ce78af528c76293"; // swaap v2 vault on polygon
// TODO: add poolId
const poolId = process.env.POOL_ID;

// token0 and token1 must be ordered such that address(token0) < address(token1) 
const token0 = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174"; // USDC on polygon
const joinAmountToken0 = ethers.utils.parseUnits('0.1', 6);

const token1 = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"; // WETH on polygon
const joinAmountToken1 = ethers.utils.parseUnits('0.00005', 18);

async function main() {
  
  const [sender] = await ethers.getSigners();
  
  // Checking required approvals to vault
  console.log("Checking spend allowances to the vault");

  const token0Contract = await ethers.getContractAt("ERC20", token0);
  const allowance0: BigNumber = await token0Contract.allowance(sender.address, vaultAddress);
  
  if(allowance0.lt(joinAmountToken0)) { // approving token0
    console.log("Approving token0 to the vault");
    const tx = await token0Contract.approve(vaultAddress, joinAmountToken0);
    await tx.wait();
  }

  const token1Contract = await ethers.getContractAt("ERC20", token1);
  const allowance1: BigNumber = await token1Contract.allowance(sender.address, vaultAddress);
  
  if(allowance1.lt(joinAmountToken1)) { // approving token1
    console.log("Approving token1 to the vault");
    const tx = await token1Contract.approve(vaultAddress, joinAmountToken1);
    await tx.wait();
  }

  // Safeguard init encoded data
  const userData = SafeguardPoolEncoder.joinInit([joinAmountToken0, joinAmountToken1]); 

  const vault = await ethers.getContractAt("IVault", vaultAddress);

  console.log(`Initializing pool: ${poolId}`);

  const tx = await vault.joinPool(
    poolId,
    sender.address, // recipient
    sender.address, // sender
    [
      [token0, token1], // token addresses
      [joinAmountToken0, joinAmountToken1], // max join amounts
      userData, // init userData
      false // use internal balance
    ]
  );

  await tx.wait();
  console.log("Pool initialized");

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
