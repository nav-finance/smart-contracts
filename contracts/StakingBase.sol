// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @author thirdweb

import "@thirdweb-dev/contracts/extension/ContractMetadata.sol";
import "@thirdweb-dev/contracts/extension/Multicall.sol";
import "@thirdweb-dev/contracts/extension/Ownable.sol";
import "./Staking.sol";

import "@thirdweb-dev/contracts/eip/interface/IERC20.sol";
import "@thirdweb-dev/contracts/eip/interface/IERC20Metadata.sol";

import {CurrencyTransferLib} from "@thirdweb-dev/contracts/lib/CurrencyTransferLib.sol";

/**
 *
 *  EXTENSION: Staking20
 *
 *  The `Staking20Base` smart contract implements Token staking mechanism.
 *  Allows users to stake their ERC-20 Tokens and earn rewards in form of another ERC-20 tokens.
 *
 *  Following features and implementation setup must be noted:
 *
 *      - ERC-20 Tokens from only one contract can be staked.
 *
 *      - Contract admin can choose to give out rewards by either transferring or minting the rewardToken,
 *        which is ideally a different ERC20 token. See {_mintRewards}.
 *
 *      - To implement custom logic for staking, reward calculation, etc. corresponding functions can be
 *        overridden from the extension `Staking20`.
 *
 *      - Ownership of the contract, with the ability to restrict certain functions to
 *        only be called by the contract's owner.
 *
 *      - Multicall capability to perform multiple actions atomically.
 *
 */

/// note: This contract is provided as a base contract.
//        This is to support a variety of use-cases that can be build on top of this base.
//
//        Additional functionality such as deposit functions, reward-minting, etc.
//        must be implemented by the deployer of this contract, as needed for their use-case.

contract StakingBase is ContractMetadata, Multicall, Ownable, Staking {
    /// @dev ERC20 Reward Token address. See {_mintRewards} below.
    address public immutable rewardToken;

    /// @dev Total amount of reward tokens in the contract.
    uint256 private rewardTokenBalance;

    constructor(
        uint80 _timeUnit,
        address _defaultAdmin,
        uint256 _rewardRatioNumerator,
        uint256 _rewardRatioDenominator,
        address _stakingToken,
        address _rewardToken
    )
        Staking(
            _stakingToken,
            IERC20Metadata(_stakingToken).decimals(),
            IERC20Metadata(_rewardToken).decimals()
        )
    {
        _setupOwner(_defaultAdmin);
        _setStakingCondition(
            _timeUnit,
            _rewardRatioNumerator,
            _rewardRatioDenominator
        );
        rewardToken = _rewardToken;
    }

    /// @dev Admin deposits reward tokens.
    function depositRewardTokens(
        uint256 _amount
    ) external payable virtual nonReentrant {
        _depositRewardTokens(_amount); // override this for custom logic.
    }

    /// @dev Admin can withdraw excess reward tokens.
    function withdrawRewardTokens(
        uint256 _amount
    ) external virtual nonReentrant {
        _withdrawRewardTokens(_amount); // override this for custom logic.
    }

    /// @notice View total rewards available in the staking contract.
    function getRewardTokenBalance()
        external
        view
        virtual
        override
        returns (uint256)
    {
        return rewardTokenBalance;
    }

    /*//////////////////////////////////////////////////////////////
                        Minting logic
    //////////////////////////////////////////////////////////////*/

    /**
     *  @dev    Mint ERC20 rewards to the staker. Override for custom logic.
     *
     *  @param _staker    Address for which to calculated rewards.
     *  @param _rewards   Amount of tokens to be given out as reward.
     *
     */
    function _mintRewards(
        address _staker,
        uint256 _rewards
    ) internal virtual override {
        require(_rewards <= rewardTokenBalance, "Not enough reward tokens");
        rewardTokenBalance -= _rewards;
        CurrencyTransferLib.transferCurrency(
            rewardToken,
            address(this),
            _staker,
            _rewards
        );
    }

    /*//////////////////////////////////////////////////////////////
                        Other Internal functions
    //////////////////////////////////////////////////////////////*/

    /// @dev Admin deposits reward tokens -- override for custom logic.
    function _depositRewardTokens(uint256 _amount) internal virtual {
        require(msg.sender == owner(), "Not authorized");

        uint256 balanceBefore = IERC20(rewardToken).balanceOf(address(this));
        CurrencyTransferLib.transferCurrency(
            rewardToken,
            msg.sender,
            address(this),
            _amount
        );
        uint256 actualAmount = IERC20(rewardToken).balanceOf(address(this)) -
            balanceBefore;

        rewardTokenBalance += actualAmount;
    }

    /// @dev Admin can withdraw excess reward tokens -- override for custom logic.
    function _withdrawRewardTokens(uint256 _amount) internal virtual {
        require(msg.sender == owner(), "Not authorized");

        // to prevent locking of direct-transferred tokens
        rewardTokenBalance = _amount > rewardTokenBalance
            ? 0
            : rewardTokenBalance - _amount;

        CurrencyTransferLib.transferCurrency(
            rewardToken,
            address(this),
            msg.sender,
            _amount
        );

        address _stakingToken = stakingToken;
        require(
            IERC20(_stakingToken).balanceOf(address(this)) >=
                stakingTokenBalance,
            "Staking token balance reduced."
        );
    }

    /// @dev Returns whether staking restrictions can be set in given execution context.
    function _canSetStakeConditions()
        internal
        view
        virtual
        override
        returns (bool)
    {
        return msg.sender == owner();
    }

    /// @dev Returns whether contract metadata can be set in the given execution context.
    function _canSetContractURI()
        internal
        view
        virtual
        override
        returns (bool)
    {
        return msg.sender == owner();
    }

    /// @dev Returns whether owner can be set in the given execution context.
    function _canSetOwner() internal view virtual override returns (bool) {
        return msg.sender == owner();
    }
}
