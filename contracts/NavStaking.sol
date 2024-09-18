// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./StakingBase.sol";
import "./NavFinance.sol" as NavToken;
import "./Pausable.sol";

contract NavStaking is StakingBase, Pausable {
    bool private _paused;
    uint256 private _lockingPeriod; // Locking period in seconds
    mapping(address => uint256) private _stakeTimestamps;

    struct GetUserInfo {
        uint256 amount;
        uint256 pendingRewards;
        uint256 withdrawAvaliable;
        uint256 eulerPerBlock;
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _mintRewards(
        address _staker,
        uint256 _rewards
    ) internal override whenNotPaused {
        NavToken.NavFinance tokenContract = NavToken.NavFinance(
            address(getRewardToken())
        );
        tokenContract.mint(_staker, _rewards);
    }

    // Optionally expose the reward token through a getter if it's needed.
    function getRewardToken() public view returns (address) {
        return rewardToken;
    }

    function claimRewards() external override whenNotPaused {
        _claimRewards();
    }

    function stake(uint256 _amount) external payable override nonReentrant {
        _stakeTimestamps[msg.sender] = block.timestamp; // Record stake timestamp
        _stake(_amount);
    }

    function withdraw(
        uint256 _amount
    ) external override nonReentrant whenNotPaused {
        require(
            block.timestamp >= _stakeTimestamps[msg.sender] + _lockingPeriod,
            "Locking period not expired"
        );
        _withdraw(_amount);
    }
}
