import { expect } from "chai";
import { MaxUint256, Signer, keccak256, parseEther, toUtf8Bytes } from "ethers";
import { ethers } from "hardhat";

describe("StakingContract Edge Cases", function () {
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

  it("should not allow staking after time unit set to zero", async function () {
    // Attempt to set time unit to zero
    await expect(navStaking.connect(owner).setStakingTimeUnit(0)).to.be.revertedWith("time-unit can't be 0");
  });

  it("should handle multiple stake and withdraw operations correctly", async function () {
    await navStaking.connect(staker).stake(parseEther("200"));
    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine", []);

    await navStaking.connect(staker).stake(parseEther("300"));
    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine", []);

    const [tokensStaked, availableRewards] = await navStaking.getStakeInfo(stakerAddress);
    expect(tokensStaked).to.equal(parseEther("500"));

    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine", []);

    await navStaking.connect(staker).withdraw(parseEther("200"));
    const [tokensStakedAfterWithdraw, availableRewardsAfterWithdraw] = await navStaking.getStakeInfo(stakerAddress);
    expect(tokensStakedAfterWithdraw).to.equal(parseEther("300"));
  });
});