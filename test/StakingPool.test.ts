import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { parseEther } from "ethers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("StakingPool", function () {
  async function deployStakingPoolFixture() {
    const [owner, addr1, addr2] = await ethers.getSigners();

    const NAVFinance = await ethers.getContractFactory("NavFinance");
    const stakingTokenImplementation = await NAVFinance.deploy();
    const stakingTokenProxy = await upgrades.deployProxy(NAVFinance, [owner.address, owner.address, owner.address], { initializer: 'initialize' });
    const stakingToken = await ethers.getContractAt("NavFinance", await stakingTokenProxy.getAddress());

    const StakingPool = await ethers.getContractFactory("StakingPool");
    const stakingPool = await StakingPool.deploy(await stakingToken.getAddress());

    // Mint tokens to addr1 and addr2 for testing
    await stakingToken.mint(addr1.address, parseEther("1000"));
    await stakingToken.mint(addr2.address, parseEther("1000"));

    return { stakingPool, stakingToken, owner, addr1, addr2 };
  }

  describe("Deployment", function () {
    it("Should set the correct staking token", async function () {
      const { stakingPool, stakingToken } = await loadFixture(deployStakingPoolFixture);
      expect(await stakingPool.stakingToken()).to.equal(await stakingToken.getAddress());
    });

    it("Should have zero pools initially", async function () {
      const { stakingPool } = await loadFixture(deployStakingPoolFixture);
      expect(await stakingPool.poolCount()).to.equal(0);
    });
  });

  describe("Pool Creation", function () {
    it("Should create a pool with valid parameters", async function () {
      const { stakingPool } = await loadFixture(deployStakingPoolFixture);
      await stakingPool.createPool(
        30 * 24 * 60 * 60,
        parseEther("1"),
        parseEther("10"),
        500,
        true
      );
      expect(await stakingPool.poolCount()).to.equal(1);
    });

    it("Should fail to create a pool with invalid parameters", async function () {
      const { stakingPool } = await loadFixture(deployStakingPoolFixture);
      await expect(
        stakingPool.createPool(0, parseEther("1"), parseEther("10"), 500, true)
      ).to.be.revertedWith("Lock-in period must be greater than 0");

      await expect(
        stakingPool.createPool(30 * 24 * 60 * 60, 0, parseEther("10"), 500, true)
      ).to.be.revertedWith("Minimum stake must be greater than 0");

      await expect(
        stakingPool.createPool(30 * 24 * 60 * 60, parseEther("10"), parseEther("1"), 500, true)
      ).to.be.revertedWith("Maximum stake must be greater than minimum stake");

      await expect(
        stakingPool.createPool(30 * 24 * 60 * 60, parseEther("1"), parseEther("10"), 0, true)
      ).to.be.revertedWith("Invalid reward rate");

      await expect(
        stakingPool.createPool(30 * 24 * 60 * 60, parseEther("1"), parseEther("10"), 10001, true)
      ).to.be.revertedWith("Invalid reward rate");
    });
  });

  describe("Staking", function () {
    async function deployPoolFixture() {
      const { stakingPool, stakingToken, owner, addr1, addr2 } = await loadFixture(deployStakingPoolFixture);
      await stakingPool.createPool(
        30 * 24 * 60 * 60,
        parseEther("1"),
        parseEther("10"),
        500,
        true
      );
      return { stakingPool, stakingToken, owner, addr1, addr2 };
    }

    it("Should allow staking within limits", async function () {
      const { stakingPool, stakingToken, addr1 } = await loadFixture(deployPoolFixture);
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("5"));
      await stakingPool.connect(addr1).stake(0, parseEther("5"));
      expect(await stakingPool.getUserStakeInPool(0, addr1.address)).to.equal(parseEther("5"));
    });

    it("Should fail to stake less than minimum", async function () {
      const { stakingPool, stakingToken, addr1 } = await loadFixture(deployPoolFixture);
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("0.5"));
      await expect(
        stakingPool.connect(addr1).stake(0, parseEther("0.5"))
      ).to.be.revertedWith("Stake amount out of bounds");
    });

    it("Should fail to stake more than maximum", async function () {
      const { stakingPool, stakingToken, addr1 } = await loadFixture(deployPoolFixture);
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("15"));
      await expect(
        stakingPool.connect(addr1).stake(0, parseEther("15"))
      ).to.be.revertedWith("Stake amount out of bounds");
    });

    it("Should allow multiple stakes from the same address", async function () {
      const { stakingPool, stakingToken, addr1 } = await loadFixture(deployPoolFixture);
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("8"));
      await stakingPool.connect(addr1).stake(0, parseEther("5"));
      await stakingPool.connect(addr1).stake(0, parseEther("3"));
      expect(await stakingPool.getUserStakeInPool(0, addr1.address)).to.equal(parseEther("8"));
    });

    it("Should fail if pool capacity is exceeded", async function () {
      const { stakingPool, stakingToken, addr1, addr2 } = await loadFixture(deployPoolFixture);
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("10"));
      await stakingPool.connect(addr1).stake(0, parseEther("10"));

      await stakingToken.connect(addr2).approve(await stakingPool.getAddress(), parseEther("1"));
      await expect(
        stakingPool.connect(addr2).stake(0, parseEther("1"))
      ).to.be.revertedWith("Pool capacity exceeded");
    });
  });

  describe("Withdrawal", function () {
    async function deployPoolFixture() {
      const { stakingPool, stakingToken, owner, addr1, addr2 } = await loadFixture(deployStakingPoolFixture);
      await stakingPool.createPool(
        30,
        parseEther("1"),
        parseEther("10"),
        500,
        true
      );
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("5"));
      await stakingPool.connect(addr1).stake(0, parseEther("5"));
      return { stakingPool, stakingToken, owner, addr1, addr2 };
    }

    it("Should allow withdrawal after lock-in period", async function () {
      const { stakingPool, addr1 } = await loadFixture(deployPoolFixture);
      await time.increase(31);
      await stakingPool.connect(addr1).withdraw(0);
      expect(await stakingPool.getUserStakeInPool(0, addr1.address)).to.equal(0);
    });

    it("Should fail to withdraw during lock-in period", async function () {
      const { stakingPool, addr1 } = await loadFixture(deployPoolFixture);
      await expect(
        stakingPool.connect(addr1).withdraw(0)
      ).to.be.revertedWith("Lock-in period not over");
    });

    it("Should allow emergency withdrawal", async function () {
      const { stakingPool, addr1 } = await loadFixture(deployPoolFixture);
      await stakingPool.connect(addr1).emergencyWithdraw(0);
      expect(await stakingPool.getUserStakeInPool(0, addr1.address)).to.equal(0);
    });

    it("Should fail to withdraw with no stake", async function () {
      const { stakingPool, addr2 } = await loadFixture(deployPoolFixture);
      await time.increase(31);
      await expect(
        stakingPool.connect(addr2).withdraw(0)
      ).to.be.revertedWith("No stake to withdraw");
    });
  });

  describe("Rewards", function () {
    async function deployPoolFixture() {
      const { stakingPool, stakingToken, owner, addr1, addr2 } = await loadFixture(deployStakingPoolFixture);
      await stakingPool.createPool(
        365 * 24 * 60 * 60,
        parseEther("1"),
        parseEther("1000"),
        1000,
        false
      );
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("100"));
      await stakingPool.connect(addr1).stake(0, parseEther("100"));
      return { stakingPool, stakingToken, owner, addr1, addr2 };
    }

    it("Should calculate correct non-compounding reward", async function () {
      const { stakingPool, addr1 } = await loadFixture(deployPoolFixture);
      await time.increase(365 * 24 * 60 * 60);
      const reward = await stakingPool.calculateReward(0, addr1.address);
      expect(reward).to.be.closeTo(parseEther("10"), parseEther("0.01"));
    });

    it("Should calculate correct compounding reward", async function () {
      const { stakingPool, stakingToken, addr1, addr2 } = await loadFixture(deployPoolFixture);
      await stakingPool.createPool(
        365 * 24 * 60 * 60,
        parseEther("1"),
        parseEther("1000"),
        1000,
        true
      );
      await stakingToken.connect(addr2).approve(await stakingPool.getAddress(), parseEther("100"));
      await stakingPool.connect(addr2).stake(1, parseEther("100"));

      await time.increase(365 * 24 * 60 * 60);
      const reward = await stakingPool.calculateReward(1, addr2.address);
      expect(reward).to.be.closeTo(parseEther("10.5"), parseEther("0.01"));
    });
  });

  describe("Analytics", function () {
    async function deployPoolFixture() {
      const { stakingPool, stakingToken, owner, addr1, addr2 } = await loadFixture(deployStakingPoolFixture);
      await stakingPool.createPool(
        30 * 24 * 60 * 60,
        parseEther("1"),
        parseEther("100"),
        500,
        true
      );
      await stakingToken.connect(addr1).approve(await stakingPool.getAddress(), parseEther("50"));
      await stakingPool.connect(addr1).stake(0, parseEther("50"));
      return { stakingPool, stakingToken, owner, addr1, addr2 };
    }

    it("Should return correct total staked in pool", async function () {
      const { stakingPool } = await loadFixture(deployPoolFixture);
      expect(await stakingPool.getTotalStakedInPool(0)).to.equal(parseEther("50"));
    });

    it("Should return correct user stake in pool", async function () {
      const { stakingPool, addr1 } = await loadFixture(deployPoolFixture);
      expect(await stakingPool.getUserStakeInPool(0, addr1.address)).to.equal(parseEther("50"));
    });

    it("Should return correct pool details", async function () {
      const { stakingPool } = await loadFixture(deployPoolFixture);
      const poolDetails = await stakingPool.getPoolDetails(0);
      expect(poolDetails.lockInPeriod).to.equal(30 * 24 * 60 * 60);
      expect(poolDetails.minStake).to.equal(parseEther("1"));
      expect(poolDetails.maxStake).to.equal(parseEther("100"));
      expect(poolDetails.totalStaked).to.equal(parseEther("50"));
      expect(poolDetails.rewardRate).to.equal(500);
      expect(poolDetails.owner).to.equal(await stakingPool.owner());
      expect(poolDetails.autoCompounding).to.be.true;
    });

    it("Should return correct pool count", async function () {
      const { stakingPool } = await loadFixture(deployPoolFixture);
      expect(await stakingPool.getPoolCount()).to.equal(1);
    });
  });
});