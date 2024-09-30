// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./StakingBase.sol";
import "./NavFinance.sol" as NavToken;
import "./Pausable.sol";

contract NavStaking is StakingBase, Pausable {
    bool private _paused ;
    uint256 private immutable _lockingPeriod;
    mapping(address => uint256) private _stakeTimestamps;

    struct GetUserInfo {
        uint256 amount;
        uint256 pendingRewards;
        uint256 withdrawAvaliable;
        uint256 rewardPerBlock;
        uint256 tvl;
    }

    constructor(
        uint80 _timeUnit,
        address _defaultAdmin,
        uint256 _rewardRatioNumerator,
        uint256 _rewardRatioDenominator,
        address _stakingToken,
        uint256 lockingPeriod // Add locking period parameter
    )
        StakingBase(
            _timeUnit,
            _defaultAdmin,
            _rewardRatioNumerator,
            _rewardRatioDenominator,
            _stakingToken,
            _stakingToken
        )
    {
        _lockingPeriod = lockingPeriod; // Initialize locking period
    }

    /**
     * @dev Pauses the contract, preventing any staking or reward claiming.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses the contract, allowing staking and reward claiming again.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Mints rewards for a staker.
     * @param _staker The address of the staker.
     * @param _rewards The amount of rewards to mint.
     */
    function _mintRewards(
        address _staker,
        uint256 _rewards
    ) internal override whenNotPaused {
        NavToken.NavFinance tokenContract = NavToken.NavFinance(
            address(getRewardToken())
        );
        tokenContract.mint(_staker, _rewards);
    }

    /**
     * @dev Returns the address of the reward token.
     * @return The address of the reward token.
     */
    function getRewardToken() public view returns (address) {
        return rewardToken;
    }

    /**
     * @dev Claims rewards for the caller.
     */
    function claimRewards() external override whenNotPaused {
        require(_availableRewards(msg.sender) > 0, "No rewards");
        _claimRewards();
    }

    /**
     * @dev Stakes a specified amount of tokens.
     * @param _amount The amount of tokens to stake.
     */
    function stake(uint256 _amount) external override nonReentrant whenNotPaused {
        _stakeTimestamps[msg.sender] = block.timestamp;
        _stake(_amount);
    }

    /**
     * @dev Withdraws a specified amount of tokens after the locking period.
     * @param _amount The amount of tokens to withdraw.
     */
    function withdraw(
        uint256 _amount
    ) external override nonReentrant whenNotPaused {
        require(
            block.timestamp >= _stakeTimestamps[msg.sender] + _lockingPeriod,
            "Locking period not expired"
        );
        _withdraw(_amount);
    }

    /**
     * @dev Sets the time unit for staking.
     * @param _timeUnit The new time unit to set.
     */
    function setStakingTimeUnit(uint80 _timeUnit) external override whenNotPaused onlyOwner {
        _setTimeUnit(_timeUnit);
    }

    /**
     * @dev Sets the reward ratio for staking.
     * @param _numerator The numerator of the reward ratio.
     * @param _denominator The denominator of the reward ratio.
     */
    function setRewardRatio(
        uint256 _numerator,
        uint256 _denominator
    ) external override onlyOwner whenNotPaused {
        _setRewardRatio(_numerator, _denominator);
    }
}
