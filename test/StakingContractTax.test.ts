import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, MaxUint256, Signer, parseEther } from "ethers";

describe("StakingContract", function () {
  let owner: Signer;
  let stakerOne: Signer;
  let stakerTwo: Signer;
  let ownerAddress: string;
  let stakerOneAddress: string;
  let stakerTwoAddress: string;
  let stakeContract: any;
  let navToken: any;
  let stakeContractAddress: string;
  let navTokenAddress: string;

  const timeUnit = 60;
  const rewardRatioNumerator = 3;
  const rewardRatioDenominator = 50;
  const initialRewardTokens = parseEther("100");
  const initialStakeTokens = parseEther("1000");

  beforeEach(async function () {
    [owner, stakerOne, stakerTwo] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    stakerOneAddress = await stakerOne.getAddress();
    stakerTwoAddress = await stakerTwo.getAddress();

    // Deploy NavFinance Token
    const NavFinance = await ethers.getContractFactory("NavFinance");
    navToken = await NavFinance.deploy(ownerAddress, ownerAddress);
    navTokenAddress = await navToken.getAddress();

    // Deploy Staking Contract
    const StakingBase = await ethers.getContractFactory("StakingBase");
    stakeContract = await StakingBase.deploy(
      timeUnit,
      ownerAddress,
      rewardRatioNumerator,
      rewardRatioDenominator,
      navTokenAddress,
      navTokenAddress
    );

    stakeContractAddress = await stakeContract.getAddress();

    // Transfer reward tokens to staking contract
    await navToken.transfer(stakeContractAddress, initialRewardTokens);

    // Mint stake tokens to stakers
    await navToken.transfer(stakerOneAddress, initialStakeTokens);
    await navToken.transfer(stakerTwoAddress, initialStakeTokens);

    // Approve staking contract
    await navToken.connect(stakerOne).approve(stakeContractAddress, MaxUint256);
    await navToken.connect(stakerTwo).approve(stakeContractAddress, MaxUint256);
  });

  it("should handle staking correctly", async function () {
    const stakeAmount = parseEther("100");
    await stakeContract.connect(stakerOne).stake(stakeAmount);

    expect(await navToken.balanceOf(stakeContractAddress)).to.equal(initialRewardTokens + stakeAmount);
    expect(await navToken.balanceOf(stakerOneAddress)).to.equal(initialStakeTokens - stakeAmount);

    const stakeInfo = await stakeContract.getStakeInfo(stakerOneAddress);
    expect(stakeInfo.tokensStaked).to.equal(stakeAmount);
  });

  it("should handle withdrawals correctly", async function () {
    const stakeAmount = parseEther("100");
    const withdrawAmount = parseEther("50");

    await stakeContract.connect(stakerOne).stake(stakeAmount);
    await stakeContract.connect(stakerOne).withdraw(withdrawAmount);

    expect(await navToken.balanceOf(stakeContractAddress)).to.equal(initialRewardTokens + stakeAmount - withdrawAmount);
    expect(await navToken.balanceOf(stakerOneAddress)).to.equal(initialStakeTokens - stakeAmount + withdrawAmount);

    const stakeInfo = await stakeContract.getStakeInfo(stakerOneAddress);
    expect(stakeInfo.tokensStaked).to.equal(stakeAmount - withdrawAmount);
  });
});