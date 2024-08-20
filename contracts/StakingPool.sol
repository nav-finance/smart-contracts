// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract StakingPool is ReentrancyGuard {
    using Math for uint256;

    struct Pool {
        uint256 lockInPeriod;
        uint256 minStake;
        uint256 maxStake;
        uint256 totalStaked;
        uint256 rewardRate; // in basis points (e.g., 500 = 5%)
        address owner;
        bool autoCompounding;
        uint256 createdAt;
    }

    mapping(uint256 => Pool) public pools;
    mapping(uint256 => mapping(address => uint256)) public stakes; // poolId => user => amount
    uint256 public poolCount;

    IERC20 public stakingToken;

    event PoolCreated(uint256 indexed poolId, address indexed owner);
    event Staked(uint256 indexed poolId, address indexed user, uint256 amount);
    event Withdrawn(
        uint256 indexed poolId,
        address indexed user,
        uint256 amount
    );
    event EmergencyWithdrawn(
        uint256 indexed poolId,
        address indexed user,
        uint256 amount
    );

    modifier onlyOwner(uint256 poolId) {
        require(msg.sender == pools[poolId].owner, "Not the pool owner");
        _;
    }

    constructor(address _stakingToken) {
        require(_stakingToken != address(0), "Invalid staking token address");
        stakingToken = IERC20(_stakingToken);
    }

    function createPool(
        uint256 _lockInPeriod,
        uint256 _minStake,
        uint256 _maxStake,
        uint256 _rewardRate,
        bool _autoCompounding
    ) external {
        require(_lockInPeriod > 0, "Lock-in period must be greater than 0");
        require(_minStake > 0, "Minimum stake must be greater than 0");
        require(
            _maxStake > _minStake,
            "Maximum stake must be greater than minimum stake"
        );
        require(_rewardRate > 0 && _rewardRate <= 10000, "Invalid reward rate");

        pools[poolCount] = Pool(
            _lockInPeriod,
            _minStake,
            _maxStake,
            0,
            _rewardRate,
            msg.sender,
            _autoCompounding,
            block.timestamp
        );
        emit PoolCreated(poolCount, msg.sender);
        poolCount++;
    }

    function stake(uint256 poolId, uint256 amount) external nonReentrant {
        require(poolId < poolCount, "Invalid pool ID");
        Pool storage pool = pools[poolId];
        require(
            amount >= pool.minStake && amount <= pool.maxStake,
            "Stake amount out of bounds"
        );

        uint256 newTotalStaked = pool.totalStaked + amount;
        require(
            newTotalStaked <= pool.maxStake * 1000,
            "Pool capacity exceeded"
        );

        require(
            stakingToken.transferFrom(msg.sender, address(this), amount),
            "Token transfer failed"
        );

        stakes[poolId][msg.sender] += amount;
        pool.totalStaked = newTotalStaked;
        emit Staked(poolId, msg.sender, amount);
    }

    function withdraw(uint256 poolId) external nonReentrant {
        require(poolId < poolCount, "Invalid pool ID");
        Pool storage pool = pools[poolId];
        uint256 userStake = stakes[poolId][msg.sender];
        require(userStake > 0, "No stake to withdraw");
        require(
            block.timestamp >= pool.createdAt + pool.lockInPeriod,
            "Lock-in period not over"
        );

        uint256 reward = calculateReward(poolId, msg.sender);
        uint256 totalAmount = userStake + reward;

        stakes[poolId][msg.sender] = 0;
        pool.totalStaked = pool.totalStaked - userStake;

        require(
            stakingToken.transfer(msg.sender, totalAmount),
            "Token transfer failed"
        );
        emit Withdrawn(poolId, msg.sender, totalAmount);
    }

    function emergencyWithdraw(uint256 poolId) external nonReentrant {
        require(poolId < poolCount, "Invalid pool ID");
        uint256 userStake = stakes[poolId][msg.sender];
        require(userStake > 0, "No stake to withdraw");

        stakes[poolId][msg.sender] = 0;
        pools[poolId].totalStaked = pools[poolId].totalStaked - userStake;

        require(
            stakingToken.transfer(msg.sender, userStake),
            "Token transfer failed"
        );
        emit EmergencyWithdrawn(poolId, msg.sender, userStake);
    }

    function calculateReward(
        uint256 poolId,
        address user
    ) public view returns (uint256) {
        Pool storage pool = pools[poolId];
        uint256 userStake = stakes[poolId][user];
        uint256 stakingDuration = block.timestamp - pool.createdAt;
        uint256 rewardRate = pool.rewardRate;

        if (pool.autoCompounding) {
            uint256 exponent = (rewardRate * stakingDuration) /
                (365 days * 10000);
            uint256 compoundedStake = (userStake * expApprox(exponent)) / 1e18;
            return compoundedStake - userStake;
        } else {
            return
                (userStake * rewardRate * stakingDuration) / (365 days * 10000);
        }
    }

    function expApprox(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 1e18;
        if (x == 1e18) return 2718281828459045235;

        uint256 result = (1e18 + x / 2) * (1e18 + x / 2);
        result = result + (x * x) / 3;
        return result;
    }

    // Analytics functions
    function getTotalStakedInPool(
        uint256 poolId
    ) external view returns (uint256) {
        require(poolId < poolCount, "Invalid pool ID");
        return pools[poolId].totalStaked;
    }

    function getUserStakeInPool(
        uint256 poolId,
        address user
    ) external view returns (uint256) {
        require(poolId < poolCount, "Invalid pool ID");
        return stakes[poolId][user];
    }

    function getPoolDetails(
        uint256 poolId
    ) external view returns (Pool memory) {
        require(poolId < poolCount, "Invalid pool ID");
        return pools[poolId];
    }

    function getPoolCount() external view returns (uint256) {
        return poolCount;
    }
}
