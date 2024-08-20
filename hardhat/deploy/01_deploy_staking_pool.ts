import { ethers } from "hardhat";

async function main() {
  const StakingPool = await ethers.getContractFactory("StakingPool");
  const stakingPool = await StakingPool.deploy();
  await stakingPool.deployed();
  console.log("StakingPool deployed to:", stakingPool.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});