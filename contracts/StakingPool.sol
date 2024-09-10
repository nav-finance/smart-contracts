// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IERC20Extended is IERC20 {
    function name() external view returns (string memory);
}

contract StakingPool is ReentrancyGuard, Ownable {
    using Math for uint256;

    struct Pool {
        uint256 lockInPeriod;
        uint256 minStake;
        uint256 maxStake;
        uint256 totalStaked;
        uint256 rewardRate;
        bool autoCompounding;
        uint256 createdAt;
        uint256 earlyWithdrawalPenalty;
        uint256 lateWithdrawalBonus;
        uint256 lastUpdateTime;
        uint256 capacity; // Add this new field
    }

    struct PoolDetails {
        uint256 lockInPeriod;
        uint256 minStake;
        uint256 maxStake;
        uint256 totalStaked;
        uint256 rewardRate;
        bool autoCompounding;
        uint256 createdAt;
        uint256 earlyWithdrawalPenalty;
        uint256 lateWithdrawalBonus;
    }

    mapping(uint256 => Pool) public pools;
    mapping(uint256 => mapping(address => uint256)) public stakes;
    mapping(uint256 => mapping(address => uint256)) public stakeTimestamps;
    mapping(uint256 => mapping(address => uint256)) public lastStakeTime;
    uint256 public poolCount;

    IERC20 public stakingToken;
    bool public emergencyWithdrawEnabled;

    uint256 public constant COOLDOWN_PERIOD = 1 days;
    uint256 public constant REWARD_PRECISION = 1e18;

    event PoolCreated(uint256 indexed poolId);
    event Staked(uint256 indexed poolId, address indexed user, uint256 amount);
    event Withdrawn(
        uint256 indexed poolId,
        address indexed user,
        uint256 amount,
        uint256 reward
    );
    event EmergencyWithdrawn(
        uint256 indexed poolId,
        address indexed user,
        uint256 amount
    );
    event RewardRateChanged(uint256 indexed poolId, uint256 newRewardRate);
    event EmergencyWithdrawToggled(bool enabled);
    event PoolUpdated(uint256 indexed poolId, uint256 rewards);

    constructor(address _stakingToken) Ownable(msg.sender) {
        require(_stakingToken != address(0), "Invalid staking token address");

        try IERC20Extended(_stakingToken).name() returns (string memory) {
            stakingToken = IERC20(_stakingToken);
        } catch {
            revert("Staking token must be a valid ERC20 token");
        }
    }

    function createPool(
        uint256 _lockInPeriod,
        uint256 _minStake,
        uint256 _maxStake,
        uint256 _rewardRate,
        bool _autoCompounding,
        uint256 _earlyWithdrawalPenalty,
        uint256 _lateWithdrawalBonus,
        uint256 _capacity // Add this new parameter
    ) external onlyOwner {
        require(_lockInPeriod > 0, "Lock-in period must be greater than 0");
        require(_minStake > 0, "Minimum stake must be greater than 0");
        require(
            _maxStake > _minStake,
            "Maximum stake must be greater than minimum stake"
        );
        require(
            _rewardRate >= 0 && _rewardRate <= 10000,
            "Invalid reward rate"
        );
        require(
            _earlyWithdrawalPenalty <= 10000,
            "Invalid early withdrawal penalty"
        );
        require(_lateWithdrawalBonus <= 10000, "Invalid late withdrawal bonus");
        require(_capacity > 0, "Capacity must be greater than 0");

        pools[poolCount] = Pool({
            lockInPeriod: _lockInPeriod,
            minStake: _minStake,
            maxStake: _maxStake,
            totalStaked: 0,
            rewardRate: _rewardRate,
            autoCompounding: _autoCompounding,
            createdAt: block.timestamp,
            earlyWithdrawalPenalty: _earlyWithdrawalPenalty,
            lateWithdrawalBonus: _lateWithdrawalBonus,
            lastUpdateTime: block.timestamp,
            capacity: _capacity // Set the capacity
        });

        emit PoolCreated(poolCount);
        poolCount++;
    }

    function changeRewardRate(
        uint256 poolId,
        uint256 newRewardRate
    ) external onlyOwner {
        require(poolId < poolCount, "Invalid pool ID");
        require(
            newRewardRate >= 0 && newRewardRate <= 10000,
            "Invalid reward rate"
        );

        updatePool(poolId);
        pools[poolId].rewardRate = newRewardRate;
        emit RewardRateChanged(poolId, newRewardRate);
    }

    function toggleEmergencyWithdraw() external onlyOwner {
        emergencyWithdrawEnabled = !emergencyWithdrawEnabled;
        emit EmergencyWithdrawToggled(emergencyWithdrawEnabled);
    }

    function stake(uint256 poolId, uint256 amount) external nonReentrant {
        require(poolId < poolCount, "Invalid pool ID");
        Pool storage pool = pools[poolId];
        require(
            amount >= pool.minStake && amount <= pool.maxStake,
            "Stake amount out of bounds"
        );
        require(
            block.timestamp >=
                lastStakeTime[poolId][msg.sender] + COOLDOWN_PERIOD,
            "Cooldown period not over"
        );
        require(
            pool.totalStaked + amount <= pool.capacity,
            "Pool capacity exceeded"
        );

        updatePool(poolId);

        uint256 newTotalStaked = pool.totalStaked + amount;
        require(
            newTotalStaked <= pool.maxStake * 1000,
            "Pool capacity exceeded"
        );

        uint256 balanceBefore = stakingToken.balanceOf(address(this));
        require(
            stakingToken.transferFrom(msg.sender, address(this), amount),
            "Token transfer failed"
        );
        uint256 balanceAfter = stakingToken.balanceOf(address(this));
        require(
            balanceAfter - balanceBefore == amount,
            "Incorrect transfer amount"
        );

        stakes[poolId][msg.sender] += amount;
        stakeTimestamps[poolId][msg.sender] = block.timestamp;
        lastStakeTime[poolId][msg.sender] = block.timestamp;
        pool.totalStaked = newTotalStaked;
        emit Staked(poolId, msg.sender, amount);
    }

    function withdraw(uint256 poolId) external nonReentrant {
        require(poolId < poolCount, "Invalid pool ID");
        updatePool(poolId);
        Pool storage pool = pools[poolId];
        uint256 userStake = stakes[poolId][msg.sender];
        require(userStake > 0, "No stake to withdraw");

        uint256 stakeTime = block.timestamp -
            stakeTimestamps[poolId][msg.sender];
        uint256 reward = calculateReward(poolId, msg.sender);
        uint256 totalAmount = userStake + reward;

        if (stakeTime < pool.lockInPeriod) {
            uint256 penalty = (totalAmount * pool.earlyWithdrawalPenalty) /
                10000;
            totalAmount -= penalty;
        } else if (stakeTime > pool.lockInPeriod) {
            uint256 bonus = (reward * pool.lateWithdrawalBonus) / 10000;
            totalAmount += bonus;
        }

        // Update state before external calls
        stakes[poolId][msg.sender] = 0;
        pool.totalStaked -= userStake;

        // Ensure no rewards are left in the pool after this user withdraws
        if (pool.totalStaked == 0) {
            pool.lastUpdateTime = block.timestamp; // Reset the reward calculation time
        }

        require(
            stakingToken.transfer(msg.sender, totalAmount),
            "Token transfer failed"
        );

        emit Withdrawn(poolId, msg.sender, userStake, totalAmount - userStake);
    }

    function emergencyWithdraw(uint256 poolId) external nonReentrant {
        require(emergencyWithdrawEnabled, "Emergency withdraw is not enabled");
        require(poolId < poolCount, "Invalid pool ID");
        uint256 userStake = stakes[poolId][msg.sender];
        require(userStake > 0, "No stake to withdraw");

        updatePool(poolId);

        // Update state before external calls
        stakes[poolId][msg.sender] = 0;
        pools[poolId].totalStaked -= userStake;

        uint256 penalty = (userStake * pools[poolId].earlyWithdrawalPenalty) /
            10000;
        uint256 amountToWithdraw = userStake - penalty;

        require(
            stakingToken.transfer(msg.sender, amountToWithdraw),
            "Token transfer failed"
        );

        emit EmergencyWithdrawn(poolId, msg.sender, amountToWithdraw);
    }

    function updatePool(uint256 poolId) internal {
        Pool storage pool = pools[poolId];
        if (block.timestamp <= pool.lastUpdateTime) {
            return;
        }
        if (pool.totalStaked == 0) {
            pool.lastUpdateTime = block.timestamp;
            return;
        }

        uint256 timeElapsed = block.timestamp - pool.lastUpdateTime;
        uint256 rewards = (pool.totalStaked * pool.rewardRate * timeElapsed) /
            (365 days * 10000);
        // Use rewards to update pool state or emit an event
        pool.totalStaked += rewards; // Add rewards to the pool
        pool.lastUpdateTime = block.timestamp;

        emit PoolUpdated(poolId, rewards);
    }

    function calculateReward(
        uint256 poolId,
        address user
    ) public view returns (uint256) {
        Pool storage pool = pools[poolId];
        uint256 userStake = stakes[poolId][user];
        uint256 stakingDuration = block.timestamp -
            stakeTimestamps[poolId][user];
        uint256 rewardRate = pool.rewardRate;

        if (pool.autoCompounding) {
            uint256 periods = stakingDuration / (1 days);
            uint256 dailyRate = rewardRate / 365 / 100;
            uint256 compoundedStake = userStake;
            for (uint256 i = 0; i < periods; i++) {
                compoundedStake +=
                    (compoundedStake * dailyRate) /
                    REWARD_PRECISION;
            }
            return compoundedStake - userStake;
        } else {
            return
                (userStake * rewardRate * stakingDuration) / (365 days * 100);
        }
    }

    function expApprox(uint256 x) internal pure returns (uint256) {
        if (x == 0) return REWARD_PRECISION;
        if (x == REWARD_PRECISION) return 2718281828459045235;

        uint256 result = (REWARD_PRECISION + x / 2) *
            (REWARD_PRECISION + x / 2);
        result = result + (x * x) / 3;
        return result;
    }

    function getPoolDetails(
        uint256 poolId
    ) external view returns (PoolDetails memory) {
        require(poolId < poolCount, "Invalid pool ID");
        Pool storage pool = pools[poolId];

        return
            PoolDetails({
                lockInPeriod: pool.lockInPeriod,
                minStake: pool.minStake,
                maxStake: pool.maxStake,
                totalStaked: pool.totalStaked,
                rewardRate: pool.rewardRate,
                autoCompounding: pool.autoCompounding,
                createdAt: pool.createdAt,
                earlyWithdrawalPenalty: pool.earlyWithdrawalPenalty,
                lateWithdrawalBonus: pool.lateWithdrawalBonus
            });
    }

    function getPoolCount() external view returns (uint256) {
        return poolCount;
    }

    function getUserStakeInPool(
        uint256 poolId,
        address user
    ) external view returns (uint256) {
        require(poolId < poolCount, "Invalid pool ID");
        return stakes[poolId][user];
    }
}
