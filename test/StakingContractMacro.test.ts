import { expect } from "chai";
import { MaxUint256, Signer, keccak256, parseEther, toUtf8Bytes } from "ethers";
import { ethers } from "hardhat";
import { StakingBase } from "../typechain-types";

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
  let stakingBase: StakingBase;

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

    // Deploy StakingBase
    const StakingBase = await ethers.getContractFactory("StakingBase");
    stakingBase = await StakingBase.deploy(
      timeUnit,
      ownerAddress,
      rewardRatioNumerator,
      rewardRatioDenominator,
      navFinanceAddress,
      navFinanceAddress // Using NavFinance as both staking and reward token for simplicity
    );
  });



  describe("StakingBase", function () {
    describe("depositRewardTokens", function () {
      it("should allow admin to deposit reward tokens", async function () {
        const depositAmount = parseEther("100");
        await navFinance.mint(ownerAddress, depositAmount);
        await navFinance.connect(owner).approve(stakingBase.getAddress(), depositAmount);

        await expect(stakingBase.connect(owner).depositRewardTokens(depositAmount))
          .to.emit(navFinance, "Transfer")
          .withArgs(ownerAddress, await stakingBase.getAddress(), depositAmount);

        expect(await stakingBase.getRewardTokenBalance()).to.equal(depositAmount);
      });

      it("should revert when non-admin tries to deposit reward tokens", async function () {
        const depositAmount = parseEther("100");
        await expect(stakingBase.connect(staker).depositRewardTokens(depositAmount))
          .to.be.revertedWith("Not authorized");
      });
    });

    describe("withdrawRewardTokens", function () {
      beforeEach(async function () {
        const depositAmount = parseEther("100");
        await navFinance.mint(ownerAddress, depositAmount);
        await navFinance.connect(owner).approve(stakingBase.getAddress(), depositAmount);
        await stakingBase.connect(owner).depositRewardTokens(depositAmount);
      });

      it("should allow admin to withdraw reward tokens", async function () {
        const withdrawAmount = parseEther("50");
        await expect(stakingBase.connect(owner).withdrawRewardTokens(withdrawAmount))
          .to.emit(navFinance, "Transfer")
          .withArgs(await stakingBase.getAddress(), ownerAddress, withdrawAmount);

        expect(await stakingBase.getRewardTokenBalance()).to.equal(parseEther("50"));
      });

      it("should revert when non-admin tries to withdraw reward tokens", async function () {
        const withdrawAmount = parseEther("50");
        await expect(stakingBase.connect(staker).withdrawRewardTokens(withdrawAmount))
          .to.be.revertedWith("Not authorized");
      });

      it("should allow admin to withdraw all reward tokens", async function () {
        const withdrawAmount = parseEther("100");
        await stakingBase.connect(owner).withdrawRewardTokens(withdrawAmount);
        expect(await stakingBase.getRewardTokenBalance()).to.equal(0);
      });
    });

    describe("getRewardTokenBalance", function () {
      it("should return the correct reward token balance", async function () {
        expect(await stakingBase.getRewardTokenBalance()).to.equal(0);

        const depositAmount = parseEther("100");
        await navFinance.mint(ownerAddress, depositAmount);
        await navFinance.connect(owner).approve(stakingBase.getAddress(), depositAmount);
        await stakingBase.connect(owner).depositRewardTokens(depositAmount);

        expect(await stakingBase.getRewardTokenBalance()).to.equal(depositAmount);
      });
    });

    describe("setRewardRatio", function () {
      it("should allow admin to set reward ratio", async function () {
        await stakingBase.connect(owner).setRewardRatio(2, 100);
        const [numerator, denominator] = await stakingBase.getRewardRatio();
        expect(numerator).to.equal(2);
        expect(denominator).to.equal(100);
      });

      it("should revert when non-admin tries to set reward ratio", async function () {
        await expect(stakingBase.connect(staker).setRewardRatio(2, 100))
          .to.be.revertedWith("Not authorized");
      });
    });

    describe("setStakingTimeUnit", function () {
      it("should allow admin to set staking time unit", async function () {
        await stakingBase.connect(owner).setStakingTimeUnit(120);
        expect(await stakingBase.getTimeUnit()).to.equal(120);
      });

      it("should revert when non-admin tries to set staking time unit", async function () {
        await expect(stakingBase.connect(staker).setStakingTimeUnit(120))
          .to.be.revertedWith("Not authorized");
      });
    });
  });
});