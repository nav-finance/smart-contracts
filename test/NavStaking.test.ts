import { expect } from "chai";
import { MaxUint256, Signer, keccak256, parseEther, toUtf8Bytes } from "ethers";
import { ethers } from "hardhat";

describe("NavStaking Base", function () {
  let owner: Signer;
  let staker: Signer;
  let stakerTwo: Signer;
  let ownerAddress: string;
  let stakerAddress: string;
  let stakerTwoAddress: string;

  let navFinance: any;
  let navStaking: any;
  let navStakingAddress: string;
  let navFinanceAddress: string;

  const timeUnit = 60;
  const rewardRatioNumerator = 1;
  const rewardRatioDenominator = 20;
  const lockingPeriod = 1000;

  beforeEach(async function () {
    [owner, staker, stakerTwo] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    stakerAddress = await staker.getAddress();
    stakerTwoAddress = await stakerTwo.getAddress();

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
    await navFinance.mint(stakerTwoAddress, parseEther("1000"));
    // Approve staking contract
    await navFinance.connect(staker).approve(navStakingAddress, MaxUint256);
    await navFinance.connect(stakerTwo).approve(navStakingAddress, MaxUint256);
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
    await expect(navStaking.connect(staker).setRewardRatio(1, 2)).to.be.revertedWithCustomError(navStaking, "OwnableUnauthorized");
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      await navStaking.connect(staker).stake(parseEther("400"));
      await navStaking.connect(stakerTwo).stake(parseEther("200"));
      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);
    });

    it("should revert when withdrawing zero tokens", async function () {
      await expect(navStaking.connect(staker).withdraw(0)).to.be.revertedWith("Withdrawing 0 tokens");
    });

    it("should revert when withdrawing more than staked", async function () {
      await expect(navStaking.connect(staker).withdraw(parseEther("500"))).to.be.revertedWith("Withdrawing more than staked");
    });
  });

  describe("Claim Rewards", function () {
    beforeEach(async function () {
      await navStaking.connect(staker).stake(parseEther("400"));
    });

    it("should allow a user to claim rewards correctly", async function () {
      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);

      const rewardBalanceBefore = await navFinance.balanceOf(stakerAddress);
      await navStaking.connect(staker).claimRewards();
      const rewardBalanceAfter = await navFinance.balanceOf(stakerAddress);

      const expectedRewards = BigInt(((1000n * 400n * BigInt(rewardRatioNumerator)) / BigInt(timeUnit)) / BigInt(rewardRatioDenominator)) * BigInt(10 ** 18);
      expect(rewardBalanceAfter - rewardBalanceBefore).to.be.closeTo(expectedRewards, parseEther("1"));

      const [tokensStaked, availableRewards] = await navStaking.getStakeInfo(stakerAddress);
      expect(tokensStaked).to.equal(parseEther("400"));
      expect(availableRewards).to.equal(0);
    });

    it("should revert when claiming rewards with no rewards available", async function () {
      await expect(navStaking.connect(stakerTwo).claimRewards()).to.be.revertedWith("No rewards");

      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);

      await expect(navStaking.connect(stakerTwo).claimRewards()).to.be.revertedWith("No rewards");
    });
  });

  describe("Set Reward Ratio", function () {
    it("should allow admin to set reward ratio and update staking conditions correctly", async function () {
      await navStaking.connect(owner).setRewardRatio(3, 70);
      const [numerator, denominator] = await navStaking.getRewardRatio();
      expect(numerator).to.equal(3);
      expect(denominator).to.equal(70);
    });

    it("should revert when non-admin tries to set reward ratio", async function () {
      await expect(navStaking.connect(staker).setRewardRatio(1, 2)).to.be.revertedWithCustomError(navStaking, "OwnableUnauthorized");
    });

    it("should revert when denominator is zero", async function () {
      await expect(navStaking.connect(owner).setRewardRatio(1, 0)).to.be.revertedWith("divide by 0");
    });
  });

  describe("Set Time Unit", function () {
    it("should allow admin to set time unit correctly", async function () {
      await navStaking.connect(owner).setStakingTimeUnit(100);
      const newTimeUnit = await navStaking.getTimeUnit();
      expect(newTimeUnit).to.equal(100);
    });

    it("should revert when non-admin tries to set time unit", async function () {
      await expect(navStaking.connect(staker).setStakingTimeUnit(1)).to.be.revertedWithCustomError(navStaking, "OwnableUnauthorized");
    });
  });

  describe("Miscellaneous", function () {
    it("should prevent setting time unit to zero", async function () {
      await expect(navStaking.connect(owner).setStakingTimeUnit(0)).to.be.revertedWith("time-unit can't be 0");
    });
  });

  describe("NavFinance Token Specifics", function () {
    it("should have the correct name and symbol", async function () {
      expect(await navFinance.name()).to.equal("Nav Finance");
      expect(await navFinance.symbol()).to.equal("NAV");
    });

    it("should allow minting by the owner", async function () {
      const initialBalance = await navFinance.balanceOf(ownerAddress);
      await navFinance.mint(ownerAddress, parseEther("1000"));
      const finalBalance = await navFinance.balanceOf(ownerAddress);
      expect(finalBalance - initialBalance).to.equal(parseEther("1000"));
    });

    it("should not allow minting by non-owners", async function () {
      try {
        await navFinance.connect(staker).mint(stakerAddress, parseEther("1000"));
        throw new Error("Expected to revert but did not");
      } catch (error) {
        expect(error).to.have.match(/AccessControlUnauthorizedAccount/);
      }
    });
  });

  describe("Pausing", function () {
    beforeEach(async function () {
      await navStaking.connect(owner).pause();
    });

    it("should allow admin to pause and unpause", async function () {
      await expect(navStaking.connect(staker).stake(parseEther("400"))).to.be.revertedWithCustomError(navStaking, "EnforcedPause");
      await navStaking.connect(owner).unpause();
      await navStaking.connect(staker).stake(parseEther("400"));
    });

    it("should revert when non-admin tries to pause", async function () {
      await expect(navStaking.connect(staker).pause()).to.be.revertedWithCustomError(navStaking, "OwnableUnauthorized");
    });

    it("should revert when non-admin tries to unpause", async function () {
      await expect(navStaking.connect(staker).unpause()).to.be.revertedWithCustomError(navStaking, "OwnableUnauthorized");
    });

    it("should revert when trying to stake while paused", async function () {
      await expect(navStaking.connect(staker).stake(parseEther("400"))).to.be.revertedWithCustomError(navStaking, "EnforcedPause");
    });

    it("should revert when trying to withdraw while paused", async function () {
      await expect(navStaking.connect(staker).withdraw(parseEther("400"))).to.be.revertedWithCustomError(navStaking, "EnforcedPause");
    });

    it("should revert when trying to claim rewards while paused", async function () {
      await expect(navStaking.connect(staker).claimRewards()).to.be.revertedWithCustomError(navStaking, "EnforcedPause");
    });

    it("should revert when trying to set reward ratio while paused", async function () {
      await expect(navStaking.connect(owner).setRewardRatio(3, 70)).to.be.revertedWithCustomError(navStaking, "EnforcedPause");
    });

    it("should revert when trying to set time unit while paused", async function () {
      await expect(navStaking.connect(owner).setStakingTimeUnit(100)).to.be.revertedWithCustomError(navStaking, "EnforcedPause");
    });

    it("should revert when trying to set reward ratio while paused", async function () {
      await expect(navStaking.connect(owner).setRewardRatio(3, 70)).to.be.revertedWithCustomError(navStaking, "EnforcedPause");
    });

    it("should revert when trying to set time unit while paused", async function () {
      await expect(navStaking.connect(owner).setStakingTimeUnit(100)).to.be.revertedWithCustomError(navStaking, "EnforcedPause");
    });
  });
});