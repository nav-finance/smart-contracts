import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { formatEther, parseEther } from "ethers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("StakingPool", function () {
  async function deployStakingPoolFixture() {
    const [owner, addr1, addr2] = await ethers.getSigners();

    const NAVFinance = await ethers.getContractFactory("NavFinance");
    const stakingToken = await upgrades.deployProxy(NAVFinance, [owner.address, owner.address, owner.address], { initializer: 'initialize' });

    const StakingPool = await ethers.getContractFactory("StakingPool");
    const stakingPool = await StakingPool.deploy(await stakingToken.getAddress());

    await stakingToken.mint(addr1.address, parseEther("1000"));
    await stakingToken.mint(addr2.address, parseEther("1000"));

    return { stakingPool, stakingToken, owner, addr1, addr2 };
  }

  xdescribe("Deployment", function () {
    it("Should set the correct staking token", async function () {
      const { stakingPool, stakingToken } = await loadFixture(deployStakingPoolFixture);
      expect(await stakingPool.stakingToken()).to.equal(await stakingToken.getAddress());
    });

    it("Should have zero pools initially", async function () {
      const { stakingPool } = await loadFixture(deployStakingPoolFixture);
      expect(await stakingPool.getPoolCount()).to.equal(0);
    });

    it("Should fail to deploy with a non-ERC20 address", async function () {
      const [owner] = await ethers.getSigners();
      const StakingPool = await ethers.getContractFactory("StakingPool");
      await expect(StakingPool.deploy(ethers.ZeroAddress)).to.be.revertedWith("Invalid staking token address");
    });
  });

  xdescribe("Pool Creation", function () {
    it("Should create a pool with valid parameters", async function () {
      const { stakingPool } = await loadFixture(deployStakingPoolFixture);
      await stakingPool.createPool(
        30 * 24 * 60 * 60,
        parseEther("1"),
        parseEther("10"),
        500,
        true,
        1000,
        500,
        parseEther("10")
      );
      expect(await stakingPool.getPoolCount()).to.equal(1);
      const poolDetails = await stakingPool.getPoolDetails(0);
      expect(poolDetails.lockInPeriod).to.equal(30 * 24 * 60 * 60);
      expect(poolDetails.minStake).to.equal(parseEther("1"));
      expect(poolDetails.maxStake).to.equal(parseEther("10"));
      expect(poolDetails.rewardRate).to.equal(500);
      expect(poolDetails.autoCompounding).to.be.true;
      expect(poolDetails.earlyWithdrawalPenalty).to.equal(1000);
      expect(poolDetails.lateWithdrawalBonus).to.equal(500);
    });

    it("Should fail to create a pool with invalid parameters", async function () {
      const { stakingPool } = await loadFixture(deployStakingPoolFixture);
      await expect(stakingPool.createPool(0, parseEther("1"), parseEther("10"), 500, true, 1000, 500, parseEther("10")))
        .to.be.revertedWith("Lock-in period must be greater than 0");
      await expect(stakingPool.createPool(30 * 24 * 60 * 60, 0, parseEther("10"), 500, true, 1000, 500, parseEther("10")))
        .to.be.revertedWith("Minimum stake must be greater than 0");
      await expect(stakingPool.createPool(30 * 24 * 60 * 60, parseEther("10"), parseEther("1"), 500, true, 1000, 500, parseEther("10")))
        .to.be.revertedWith("Maximum stake must be greater than minimum stake");
      await expect(stakingPool.createPool(30 * 24 * 60 * 60, parseEther("1"), parseEther("10"), 10001, true, 1000, 500, parseEther("10")))
        .to.be.revertedWith("Invalid reward rate");
    });
  });

  xdescribe("Staking", function () {
    async function deployPoolFixture() {
      const { stakingPool, stakingToken, owner, addr1, addr2 } = await loadFixture(deployStakingPoolFixture);
      await stakingPool.createPool(
        30 * 24 * 60 * 60,
        parseEther("1"),
        parseEther("10"),
        500,
        true,
        1000,
        500,
        parseEther("10")
      );
      const stakingPoolAddress = await stakingPool.getAddress();
      await stakingToken.connect(owner).mint(stakingPoolAddress, parseEther("1000"));
      return { stakingPool, stakingToken, owner, addr1, addr2 };
    }

    it("Should allow staking within limits", async function () {
      const { stakingPool, stakingToken, addr1 } = await loadFixture(deployPoolFixture);
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("5"));
      await stakingPool.connect(addr1).stake(0, parseEther("5"));
      const poolDetails = await stakingPool.getPoolDetails(0);
      expect(poolDetails.totalStaked).to.equal(parseEther("5"));
    });

    it("Should fail to stake less than minimum", async function () {
      const { stakingPool, stakingToken, addr1 } = await loadFixture(deployPoolFixture);
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("0.5"));
      await expect(stakingPool.connect(addr1).stake(0, parseEther("0.5")))
        .to.be.revertedWith("Stake amount out of bounds");
    });

    it("Should fail to stake more than maximum", async function () {
      const { stakingPool, stakingToken, addr1 } = await loadFixture(deployPoolFixture);
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("15"));
      await expect(stakingPool.connect(addr1).stake(0, parseEther("15")))
        .to.be.revertedWith("Stake amount out of bounds");
    });

    it("Should allow multiple stakes from the same address and account for rewards", async function () {
      const { stakingPool, stakingToken, addr1 } = await loadFixture(deployPoolFixture);
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("8"));
      await stakingPool.connect(addr1).stake(0, parseEther("5"));
      await time.increase(24 * 60 * 60 + 1);
      await stakingPool.connect(addr1).stake(0, parseEther("3"));
      const poolDetails = await stakingPool.getPoolDetails(0);
      expect(poolDetails.totalStaked).to.be.gt(parseEther("8"));
    });

    it("Should fail if pool capacity is exceeded", async function () {
      const { stakingPool, stakingToken, addr1, addr2 } = await loadFixture(deployPoolFixture);
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("10"));
      await stakingPool.connect(addr1).stake(0, parseEther("10"));

      await stakingToken.connect(addr2).approve(await stakingPool.getAddress(), parseEther("1"));
      await expect(stakingPool.connect(addr2).stake(0, parseEther("1")))
        .to.be.revertedWith("Pool capacity exceeded");
    });
  });

  describe("Withdrawal", function () {
    async function deployPoolFixture() {
      const { stakingPool, stakingToken, owner, addr1, addr2 } = await loadFixture(deployStakingPoolFixture);
      await stakingPool.createPool(
        30,
        parseEther("1"),
        parseEther("100"),
        1,
        true,
        1000,
        500,
        parseEther("1000")
      );
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("50"));
      await stakingPool.connect(addr1).stake(0, parseEther("1"));
      return { stakingPool, stakingToken, owner, addr1, addr2 };
    }

    xit("Should allow withdrawal after lock-in period with reasonable rewards", async function () {
      const { stakingPool, stakingToken, addr1 } = await loadFixture(deployPoolFixture);
      await time.increase(31);
      const initialBalance = await stakingToken.balanceOf(addr1.address);
      await stakingPool.connect(addr1).withdraw(0);
      const finalBalance = await stakingToken.balanceOf(addr1.address);
      expect(finalBalance).to.be.closeTo(initialBalance + BigInt(parseEther("1")), 0);
      const poolDetails = await stakingPool.getPoolDetails(0);
      expect(poolDetails.totalStaked).to.equal(0);
    });

    xit("Should apply early withdrawal penalty", async function () {
      const { stakingPool, stakingToken, addr1 } = await loadFixture(deployPoolFixture);
      const initialBalance = await stakingToken.balanceOf(addr1.address);
      await stakingPool.connect(addr1).withdraw(0);
      const finalBalance = await stakingToken.balanceOf(addr1.address);
      const expectedBalance = initialBalance + BigInt(parseEther("45"));
      expect(finalBalance).to.be.closeTo(expectedBalance, parseEther("0.1"));
    });

    xit("Should apply late withdrawal bonus", async function () {
      const { stakingPool, stakingToken, addr1 } = await loadFixture(deployPoolFixture);
      await time.increase(60);
      const initialBalance = await stakingToken.balanceOf(addr1.address);
      await stakingPool.connect(addr1).withdraw(0);
      const finalBalance = await stakingToken.balanceOf(addr1.address);
      expect(finalBalance).to.be.gt(initialBalance + BigInt(parseEther("50")));
    });

    xit("Should allow emergency withdrawal", async function () {
      const { stakingPool, stakingToken, owner, addr1 } = await loadFixture(deployPoolFixture);
      await stakingPool.connect(owner).toggleEmergencyWithdraw();
      const initialBalance = await stakingToken.balanceOf(addr1.address);
      await stakingPool.connect(addr1).emergencyWithdraw(0);
      const finalBalance = await stakingToken.balanceOf(addr1.address);
      expect(finalBalance).to.be.gt(initialBalance);
      const poolDetails = await stakingPool.getPoolDetails(0);
      expect(poolDetails.totalStaked).to.equal(0);
    });

    xit("Should fail to withdraw with no stake", async function () {
      const { stakingPool, addr2 } = await loadFixture(deployPoolFixture);
      await time.increase(31);
      await expect(stakingPool.connect(addr2).withdraw(0))
        .to.be.revertedWith("No stake to withdraw");
    });
  });

  describe("Rewards", function () {
    async function deployPoolFixture() {
      const { stakingPool, stakingToken, owner, addr1, addr2 } = await loadFixture(deployStakingPoolFixture);
      await stakingPool.createPool(
        365 * 24 * 60 * 60,
        parseEther("1"),
        parseEther("1000"),
        500,
        false,
        1000,
        500,
        parseEther("1000")
      );
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("100"));
      await stakingPool.connect(addr1).stake(0, parseEther("100"));
      return { stakingPool, stakingToken, owner, addr1, addr2 };
    }

    it("Should calculate correct non-compounding reward", async function () {
      const { stakingPool, addr1 } = await loadFixture(deployPoolFixture);
      await time.increase(365 * 24 * 60 * 60);
      const reward = await stakingPool.calculateReward(0, addr1.address);
      expect(reward).to.be.closeTo(parseEther("5"), parseEther("0.01"));
    });

    it("Should calculate correct compounding reward", async function () {
      const { stakingPool, stakingToken, addr1, addr2 } = await loadFixture(deployPoolFixture);
      await stakingPool.createPool(
        365 * 24 * 60 * 60,
        parseEther("1"),
        parseEther("1000"),
        500,
        true,
        1000,
        500,
        parseEther("1000")
      );
      await stakingToken.connect(addr2).approve(await stakingPool.getAddress(), parseEther("100"));
      await stakingPool.connect(addr2).stake(1, parseEther("100"));

      await time.increase(365 * 24 * 60 * 60);
      const reward = await stakingPool.calculateReward(1, addr2.address);
      expect(reward).to.be.closeTo(parseEther("5.13"), parseEther("0.01"));
    });
  });

  xdescribe("Analytics", function () {
    async function deployPoolFixture() {
      const { stakingPool, stakingToken, owner, addr1, addr2 } = await loadFixture(deployStakingPoolFixture);
      await stakingPool.createPool(
        365 * 24 * 60 * 60,
        parseEther("1"),
        parseEther("1000"),
        1000,
        false,
        1000,
        500,
        parseEther("1000")
      );
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("50"));
      await stakingPool.connect(addr1).stake(0, parseEther("50"));
      return { stakingPool, stakingToken, owner, addr1, addr2 };
    }

    it("Should return correct pool details", async function () {
      const { stakingPool } = await loadFixture(deployPoolFixture);
      const poolDetails = await stakingPool.getPoolDetails(0);
      expect(poolDetails.lockInPeriod).to.equal(30 * 24 * 60 * 60);
      expect(poolDetails.minStake).to.equal(parseEther("1"));
      expect(poolDetails.maxStake).to.equal(parseEther("100"));
      expect(poolDetails.totalStaked).to.equal(parseEther("50"));
      expect(poolDetails.rewardRate).to.equal(500);
      expect(poolDetails.autoCompounding).to.be.true;
      expect(poolDetails.earlyWithdrawalPenalty).to.equal(1000);
      expect(poolDetails.lateWithdrawalBonus).to.equal(500);
    });

    it("Should return correct pool count", async function () {
      const { stakingPool } = await loadFixture(deployPoolFixture);
      expect(await stakingPool.getPoolCount()).to.equal(1);
    });
  });
});