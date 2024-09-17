import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, Signer, parseEther } from "ethers";

describe("StakingContract Edge Cases", function () {
  let owner: Signer;
  let staker: Signer;
  let ownerAddress: string;
  let stakerAddress: string;

  let navToken: Contract;
  let stakeContract: Contract;

  const timeUnit = 60;
  const rewardRatioNumerator = 3;
  const rewardRatioDenominator = 50;
  const initialRewardTokens = parseEther("100");
  const initialStakeTokens = parseEther("1000");

  beforeEach(async function () {
    [owner, staker] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    stakerAddress = await staker.getAddress();

    // Deploy NavFinance Token
    const NavFinance = await ethers.getContractFactory("NavFinance");
    navToken = await NavFinance.deploy(ownerAddress);
    await navToken.deployed();

    // Mint initial tokens to owner
    await navToken.mint(ownerAddress, initialRewardTokens.add(initialStakeTokens));

    // Deploy Staking Contract
    const Staking20Base = await ethers.getContractFactory("Staking20Base");
    stakeContract = await Staking20Base.deploy(
      timeUnit,
      ownerAddress,
      rewardRatioNumerator,
      rewardRatioDenominator,
      navToken.address,
      navToken.address
    );
    await stakeContract.deployed();

    // Transfer reward tokens to staking contract
    await navToken.transfer(stakeContract.address, initialRewardTokens);

    // Transfer stake tokens to staker
    await navToken.transfer(stakerAddress, initialStakeTokens);

    // Approve staking contract
    await navToken.connect(staker).approve(stakeContract.address, ethers.constants.MaxUint256);
  });

  it("should not allow staking after time unit set to zero", async function () {
    // Attempt to set time unit to zero
    await expect(stakeContract.connect(owner).setTimeUnit(0)).to.be.revertedWith("time-unit can't be 0");
  });

  it("should handle multiple stake and withdraw operations correctly", async function () {
    await stakeContract.connect(staker).stake(parseEther("200"));
    await ethers.provider.send("evm_increaseTime", [500]);
    await ethers.provider.send("evm_mine", []);

    await stakeContract.connect(staker).stake(parseEther("300"));
    await ethers.provider.send("evm_increaseTime", [500]);
    await ethers.provider.send("evm_mine", []);

    const stakeInfo = await stakeContract.getStakeInfo(stakerAddress);
    expect(stakeInfo.tokensStaked).to.equal(parseEther("500"));

    await stakeContract.connect(staker).withdraw(parseEther("200"));
    const updatedStakeInfo = await stakeContract.getStakeInfo(stakerAddress);
    expect(updatedStakeInfo.tokensStaked).to.equal(parseEther("300"));
  });

  it("should prevent reentrancy attacks", async function () {
    // Assuming ReentrancyGuard is implemented
    // Deploy malicious contract and attempt reentrancy
    const ReentrancyAttack = await ethers.getContractFactory("ReentrancyAttack");
    const attackContract = await ReentrancyAttack.deploy(stakeContract.address);
    await attackContract.deployed();

    // Stake tokens from attack contract
    await navToken.transfer(attackContract.address, parseEther("100"));
    await navToken.connect(attackContract).approve(stakeContract.address, ethers.constants.MaxUint256);
    await attackContract.attackStake(parseEther("100"));

    // Attempt to perform reentrancy
    await expect(attackContract.attackWithdraw(parseEther("100"))).to.be.revertedWith("ReentrancyGuard: reentrant call");
  });
});