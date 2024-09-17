import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, Signer, parseEther } from "ethers";

describe("StakingContract", function () {
  let owner: Signer;
  let stakerOne: Signer;
  let stakerTwo: Signer;
  let deployerAddress: string;
  let stakerOneAddress: string;
  let stakerTwoAddress: string;

  let navToken: Contract;
  let stakeContract: Contract;

  const timeUnit = 60;
  const rewardRatioNumerator = 3;
  const rewardRatioDenominator = 50;
  const initialTokens = parseEther("1000");

  beforeEach(async function () {
    [owner, stakerOne, stakerTwo] = await ethers.getSigners();
    deployerAddress = await owner.getAddress();
    stakerOneAddress = await stakerOne.getAddress();
    stakerTwoAddress = await stakerTwo.getAddress();

    // Deploy NavFinance Token
    const NavFinance = await ethers.getContractFactory("NavFinance");
    navToken = await NavFinance.deploy();
    await navToken.deployed();

    // Deploy Staking Contract
    const Staking20Base = await ethers.getContractFactory("Staking20Base");
    stakeContract = await Staking20Base.deploy(
      timeUnit,
      deployerAddress,
      rewardRatioNumerator,
      rewardRatioDenominator,
      navToken.address,
      navToken.address
    );
    await stakeContract.deployed();

    // Transfer tokens to staking contract and stakers
    await navToken.transfer(stakeContract.address, initialTokens);
    await navToken.transfer(stakerOneAddress, initialTokens);
    await navToken.transfer(stakerTwoAddress, initialTokens);

    // Approve staking contract
    await navToken.connect(stakerOne).approve(stakeContract.address, ethers.constants.MaxUint256);
    await navToken.connect(stakerTwo).approve(stakeContract.address, ethers.constants.MaxUint256);
  });

  describe("Stake", function () {
    it("should allow a user to stake tokens and update balances correctly", async function () {
      await stakeContract.connect(stakerOne).stake(parseEther("400"));

      expect(await navToken.balanceOf(stakeContract.address)).to.equal(parseEther("400"));
      expect(await navToken.balanceOf(stakerOneAddress)).to.equal(parseEther("600"));

      const stakeInfo = await stakeContract.getStakeInfo(stakerOneAddress);
      expect(stakeInfo.tokensStaked).to.equal(parseEther("400"));
      expect(stakeInfo.availableRewards).to.equal(0);
    });

    it("should calculate rewards correctly after time passes", async function () {
      await stakeContract.connect(stakerOne).stake(parseEther("400"));

      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);

      const stakeInfo = await stakeContract.getStakeInfo(stakerOneAddress);
      const expectedRewards = ((1000 * 400 * rewardRatioNumerator) / timeUnit) / rewardRatioDenominator;
      expect(stakeInfo.availableRewards).to.equal(expectedRewards);
    });

    it("should revert when staking zero tokens", async function () {
      await expect(stakeContract.connect(stakerOne).stake(0)).to.be.revertedWith("Staking 0 tokens");
    });
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      await stakeContract.connect(stakerOne).stake(parseEther("400"));
      await stakeContract.connect(stakerTwo).stake(parseEther("200"));
    });

    it("should allow a user to withdraw staked tokens and update balances correctly", async function () {
      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);

      await stakeContract.connect(stakerOne).withdraw(parseEther("100"));

      expect(await navToken.balanceOf(stakeContract.address)).to.equal(parseEther("500"));
      expect(await navToken.balanceOf(stakerOneAddress)).to.equal(parseEther("700"));

      const stakeInfo = await stakeContract.getStakeInfo(stakerOneAddress);
      expect(stakeInfo.tokensStaked).to.equal(parseEther("300"));
    });

    it("should revert when withdrawing zero tokens", async function () {
      await expect(stakeContract.connect(stakerOne).withdraw(0)).to.be.revertedWith("Withdrawing 0 tokens");
    });

    it("should revert when withdrawing more than staked", async function () {
      await expect(stakeContract.connect(stakerOne).withdraw(parseEther("500"))).to.be.revertedWith("Withdrawing more than staked");
    });
  });

  describe("Claim Rewards", function () {
    beforeEach(async function () {
      await stakeContract.connect(stakerOne).stake(parseEther("400"));
    });

    it("should allow a user to claim rewards correctly", async function () {
      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);

      const rewardBalanceBefore = await navToken.balanceOf(stakerOneAddress);
      await stakeContract.connect(stakerOne).claimRewards();
      const rewardBalanceAfter = await navToken.balanceOf(stakerOneAddress);

      const expectedRewards = ((1000 * 400 * rewardRatioNumerator) / timeUnit) / rewardRatioDenominator;
      expect(rewardBalanceAfter.sub(rewardBalanceBefore)).to.equal(expectedRewards);

      const stakeInfo = await stakeContract.getStakeInfo(stakerOneAddress);
      expect(stakeInfo.availableRewards).to.equal(0);
    });

    it("should revert when claiming rewards with no rewards available", async function () {
      await expect(stakeContract.connect(stakerOne).claimRewards()).to.be.revertedWith("No rewards");

      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);
      await stakeContract.connect(stakerOne).claimRewards();

      await expect(stakeContract.connect(stakerOne).claimRewards()).to.be.revertedWith("No rewards");
    });
  });

  describe("Set Reward Ratio", function () {
    it("should allow admin to set reward ratio and update staking conditions correctly", async function () {
      await stakeContract.connect(owner).setRewardRatio(3, 70);
      const [numerator, denominator] = await stakeContract.getRewardRatio();
      expect(numerator).to.equal(3);
      expect(denominator).to.equal(70);
    });

    it("should revert when non-admin tries to set reward ratio", async function () {
      await expect(stakeContract.connect(stakerOne).setRewardRatio(1, 2)).to.be.revertedWith("Not authorized");
    });

    it("should revert when denominator is zero", async function () {
      await expect(stakeContract.connect(owner).setRewardRatio(1, 0)).to.be.revertedWith("divide by 0");
    });
  });

  describe("Set Time Unit", function () {
    it("should allow admin to set time unit correctly", async function () {
      await stakeContract.connect(owner).setTimeUnit(100);
      const newTimeUnit = await stakeContract.getTimeUnit();
      expect(newTimeUnit).to.equal(100);
    });

    it("should revert when non-admin tries to set time unit", async function () {
      await expect(stakeContract.connect(stakerOne).setTimeUnit(1)).to.be.revertedWith("Not authorized");
    });
  });

  describe("Miscellaneous", function () {
    it("should prevent setting time unit to zero", async function () {
      await expect(stakeContract.connect(owner).setTimeUnit(0)).to.be.revertedWith("time-unit can't be 0");
    });
  });
});