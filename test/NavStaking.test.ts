import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, MaxUint256, Signer, keccak256, parseEther, parseUnits, toUtf8Bytes } from "ethers";

describe("NavStaking Base", function () {
  let owner: Signer;
  let staker: Signer;
  let ownerAddress: string;
  let stakerAddress: string;

  let navFinance: any;
  let navStaking: any;
  let navStakingAddress: string;
  let navFinanceAddress: string;

  const timeUnit = 60;
  const rewardRatioNumerator = 1;
  const rewardRatioDenominator = 20;
  const lockingPeriod = 1000;

  beforeEach(async function () {
    [owner, staker] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    stakerAddress = await staker.getAddress();

    // Deploy NavFinance
    const NavFinance = await ethers.getContractFactory("NavFinance");
    navFinance = await NavFinance.deploy(ownerAddress, ownerAddress);
    navFinanceAddress = await navFinance.getAddress();

    // Deploy NavStaking
    const NavStaking = await ethers.getContractFactory("NavStaking");
    navStaking = await NavStaking.deploy(
      timeUnit,
      ownerAddress,
      rewardRatioNumerator,
      rewardRatioDenominator,
      navFinanceAddress,
      lockingPeriod
    );
    navStakingAddress = await navStaking.getAddress();

    // Grant MINTER_ROLE to NavStaking
    const MINTER_ROLE = keccak256(toUtf8Bytes("MINTER_ROLE"));
    await navFinance.grantRole(MINTER_ROLE, navStakingAddress);

    // Mint staking tokens to staker
    await navFinance.mint(stakerAddress, parseEther("1000"));

    // Approve staking contract
    await navFinance.connect(staker).approve(navStakingAddress, MaxUint256);
  });

  it("should allow staking and minting rewards correctly", async function () {
    const stakerDeposit = parseEther("400");
    await navStaking.connect(staker).stake(stakerDeposit);

    const initialNavStakingBalance = await navFinance.balanceOf(navStakingAddress);

    expect(await navFinance.balanceOf(navStakingAddress)).to.equal(stakerDeposit, "Incorrect balance of NavStaking contract after staking");
    expect(await navFinance.balanceOf(stakerAddress)).to.equal(parseEther("1000") - stakerDeposit, "Incorrect balance of staker after staking");

    const [tokensStaked, availableRewards] = await navStaking.getStakeInfo(stakerAddress);
    expect(tokensStaked).to.not.be.undefined;
    expect(availableRewards).to.not.be.undefined;

    expect(tokensStaked).to.equal(stakerDeposit, "Incorrect amount of tokens staked");
    expect(availableRewards).to.equal(0, "Available rewards should be 0 immediately after staking");

    // Increase time
    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine", []);

    const [afterTokensStaked, afterAvailableRewards] = await navStaking.getStakeInfo(stakerAddress);
    const rewards = afterAvailableRewards;

    await navStaking.connect(staker).claimRewards();

    expect(await navFinance.balanceOf(stakerAddress)).to.be.closeTo(parseEther("600") + rewards, parseEther("0.5"), "Balance of staker after claiming rewards should be close to expected value");
    expect(await navFinance.balanceOf(navStakingAddress)).to.eq(initialNavStakingBalance, "NavStaking contract balance should remain unchanged during operations");

    const [finalTokensStaked, finalAvailableRewards] = await navStaking.getStakeInfo(stakerAddress);
    expect(finalAvailableRewards).to.equal(0, "Available rewards should be 0 after claiming");
  });

  it("should revert staking zero tokens", async function () {
    await expect(navStaking.connect(staker).stake(0)).to.be.revertedWith("Staking 0 tokens");
  });

  it("should allow withdrawing staked tokens", async function () {
    await navStaking.connect(staker).stake(parseEther("400"));

    // Increase time
    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine", []);

    const [stakedTokens, availableRewards] = await navStaking.getStakeInfo(stakerAddress);

    await navStaking.connect(staker).withdraw(parseEther("100"));
    await navStaking.connect(staker).claimRewards();

    const [finalTokensStaked, finalAvailableRewards] = await navStaking.getStakeInfo(stakerAddress);
    expect(finalTokensStaked).to.equal(parseEther("300"), "Incorrect amount of tokens staked after withdrawal");
    expect(finalAvailableRewards).to.equal(0, "Available rewards should be 0 after claiming");


    expect(await navFinance.balanceOf(navStakingAddress)).to.equal(parseEther("300"), "Incorrect balance of NavStaking contract after withdrawal");
    expect(await navFinance.balanceOf(stakerAddress)).to.be.closeTo(parseEther("700") + availableRewards, parseEther("1"), "Incorrect balance of staker after withdrawal");
  });

  it("should revert withdrawing more than staked only after period ends", async function () {
    await navStaking.connect(staker).stake(parseEther("400"));

    await expect(navStaking.connect(staker).withdraw(parseEther("500"))).to.be.revertedWith("Locking period not expired");

    // Increase time
    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine", []);

    await expect(navStaking.connect(staker).withdraw(parseEther("500"))).to.be.revertedWith("Withdrawing more than staked");
  });

  it("should allow admin to set reward ratio", async function () {
    await navStaking.connect(owner).setRewardRatio(3, 70);
    const [numerator, denominator] = await navStaking.getRewardRatio();
    expect(numerator).to.equal(3, "Incorrect reward ratio numerator");
    expect(denominator).to.equal(70, "Incorrect reward ratio denominator");
  });

  it("should revert when non-admin tries to set reward ratio", async function () {
    await expect(navStaking.connect(staker).setRewardRatio(1, 2)).to.be.revertedWith("Not authorized");
  });
});