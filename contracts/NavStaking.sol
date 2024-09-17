// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./StakingBase.sol";
import "./NavFinance.sol" as NavToken;

contract NavStaking is StakingBase {
    constructor(
        uint80 _timeUnit,
        address _defaultAdmin,
        uint256 _rewardRatioNumerator,
        uint256 _rewardRatioDenominator,
        address _stakingToken
    )
        StakingBase(
            _timeUnit,
            _defaultAdmin,
            _rewardRatioNumerator,
            _rewardRatioDenominator,
            _stakingToken,
            _stakingToken
        )
    {}

    function _mintRewards(address _staker, uint256 _rewards) internal override {
        NavToken.NavFinance tokenContract = NavToken.NavFinance(
            address(getRewardToken())
        );
        tokenContract.mint(_staker, _rewards);
    }

    // Optionally expose the reward token through a getter if it's needed.
    function getRewardToken() public view returns (address) {
        return rewardToken;
    }
}
