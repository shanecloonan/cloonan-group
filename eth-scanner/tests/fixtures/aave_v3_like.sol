// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20V3 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Aave V3-shaped pool (`supply` + `_msgSender`). Fixture only — not a finding.
contract Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) public virtual {
        IERC20V3(asset).transferFrom(_msgSender(), address(this), amount);
        onBehalfOf; referralCode;
    }

    function withdraw(address asset, uint256 amount, address to) public virtual returns (uint256) {
        IERC20V3(asset).transfer(to, amount);
        return amount;
    }

    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) public virtual {
        IERC20V3(asset).transfer(onBehalfOf, amount);
        interestRateMode; referralCode;
    }

    function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) public virtual returns (uint256) {
        IERC20V3(asset).transferFrom(_msgSender(), address(this), amount);
        rateMode; onBehalfOf;
        return amount;
    }

    function flashLoan(address receiver, address[] calldata assets, uint256[] calldata amounts) public virtual {
        receiver; assets; amounts;
    }

    function _msgSender() internal view returns (address) {
        return msg.sender;
    }
}
