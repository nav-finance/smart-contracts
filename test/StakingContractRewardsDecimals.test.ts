import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, Signer, parseEther } from "ethers";

describe("StakingContract with NAV Finance Token", function () {
  let owner: Signer;
  let staker: Signer;
  let ownerAddress: string;
  let stakerAddress: string;

  let navToken: Contract;
  let stakingContract: Contract;

  const timeUnit = 60;
  const rewardRatioNumerator = 1;
  const rewardRatioDenominator = 2;
  const initialSupply = parseEther("1000000");
  const stakingAmount = parseEther("400");

  beforeEach(async function () {
    [owner, staker] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    stakerAddress = await staker.getAddress();

    // Deploy NAV Finance Token
    const NAVToken = await ethers.getContractFactory("NavFinance");
    navToken = await NAVToken.deploy(ownerAddress, stakerAddress);
    await navToken.deployed();

    // Deploy Staking Contract
    const StakingBase = await ethers.getContractFactory("StakingBase");
    stakingContract = await StakingBase.deploy(
      timeUnit,
      ownerAddress,
      rewardRatioNumerator,
      rewardRatioDenominator,
      navToken.address,
      navToken.address
    );
    await stakingContract.deployed();

    // Transfer tokens to staking contract for rewards
    await navToken.transfer(stakingContract.address, parseEther("100000"));

    // Transfer tokens to staker
    await navToken.transfer(stakerAddress, parseEther("1000"));

    // Approve staking contract
    await navToken.connect(staker).approve(stakingContract.address, ethers.constants.MaxUint256);
  });

  it("should correctly handle staking and rewards", async function () {
    await stakingContract.connect(staker).stake(stakingAmount);
    await ethers.provider.send("evm_increaseTime", [60]);
    await ethers.provider.send("evm_mine", []);

    const initialBalance = await navToken.balanceOf(stakerAddress);
    await stakingContract.connect(staker).claimRewards();
    const finalBalance = await navToken.balanceOf(stakerAddress);

    const rewardBalance = finalBalance.sub(initialBalance);
    const expectedRewards = stakingAmount.mul(rewardRatioNumerator).div(rewardRatioDenominator);
    expect(rewardBalance).to.equal(expectedRewards);
  });
});