import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, MaxUint256, Signer, keccak256, parseEther, toUtf8Bytes } from "ethers";

describe("StakingContract", function () {
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

  describe("Stake", function () {
    it("should allow a user to stake tokens and update balances correctly", async function () {
      await navStaking.connect(staker).stake(parseEther("400"));

      expect(await navFinance.balanceOf(navStakingAddress)).to.equal(parseEther("400"));
      expect(await navFinance.balanceOf(stakerAddress)).to.equal(parseEther("600"));

      const [tokensStaked, availableRewards] = await navStaking.getStakeInfo(stakerAddress);
      expect(tokensStaked).to.equal(parseEther("400"));
      expect(availableRewards).to.equal(0);
    });

    it("should calculate rewards correctly after time passes", async function () {
      await navStaking.connect(staker).stake(parseEther("400"));

      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);

      const [tokensStaked, availableRewards] = await navStaking.getStakeInfo(stakerAddress);
      const expectedRewards = BigInt(((BigInt(1000) * BigInt(400) * BigInt(rewardRatioNumerator)) / BigInt(timeUnit)) / BigInt(rewardRatioDenominator)) * BigInt(10 ** 18);
      expect(availableRewards).to.be.closeTo(expectedRewards, parseEther("0.5"));
    });

    it("should revert when staking zero tokens", async function () {
      await expect(navStaking.connect(staker).stake(0)).to.be.revertedWith("Staking 0 tokens");
    });
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      await navStaking.connect(staker).stake(parseEther("400"));
      await navStaking.connect(stakerTwo).stake(parseEther("200"));
    });

    it("should allow a user to withdraw staked tokens and update balances correctly", async function () {
      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);

      await navStaking.connect(staker).withdraw(parseEther("100"));

      expect(await navFinance.balanceOf(navStakingAddress)).to.equal(parseEther("500"));
      expect(await navFinance.balanceOf(stakerAddress)).to.equal(parseEther("700"));

      const [tokensStaked, availableRewards] = await navStaking.getStakeInfo(stakerAddress);
      expect(tokensStaked).to.equal(parseEther("300"));
    });

    it("should revert when withdrawing zero tokens", async function () {
      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);

      await expect(navStaking.connect(staker).withdraw(0)).to.be.revertedWith("Withdrawing 0 tokens");
    });

    it("should revert when withdrawing more than staked", async function () {
      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);

      await expect(navStaking.connect(staker).withdraw(parseEther("500"))).to.be.revertedWith("Withdrawing more than staked");
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
      await expect(navStaking.connect(staker).setRewardRatio(1, 2)).to.be.revertedWith("Not authorized");
    });

    it("should revert when denominator is zero", async function () {
      await expect(navStaking.connect(owner).setRewardRatio(1, 0)).to.be.revertedWith("divide by 0");
    });
  });

  describe("Set Time Unit", function () {
    it("should allow admin to set time unit correctly", async function () {
      await navStaking.connect(owner).setTimeUnit(100);
      const newTimeUnit = await navStaking.getTimeUnit();
      expect(newTimeUnit).to.equal(100);
    });

    it("should revert when non-admin tries to set time unit", async function () {
      await expect(navStaking.connect(staker).setTimeUnit(1)).to.be.revertedWith("Not authorized");
    });
  });

  describe("Miscellaneous", function () {
    it("should prevent setting time unit to zero", async function () {
      await expect(navStaking.connect(owner).setTimeUnit(0)).to.be.revertedWith("time-unit can't be 0");
    });
  });
});