// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Uniswap V2 pair — ERC-20 LP + reserve custody. Hybrid — stay pool.
/// Live pairs *call* `uniswapV2Call`; that callback name must not demote as router.
/// Fixture only — not a finding.
interface IUniswapV2Callee {
    function uniswapV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

contract UniswapV2Pair {
    string public name = "UNI-V2";
    string public symbol = "UNI-V2";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint112 public reserve0;
    uint112 public reserve1;
    address public token0;
    address public token1;

    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        from;
        return true;
    }

    function getReserves() public view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, 0);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external {
        IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, "");
        to;
        amount0Out;
        amount1Out;
    }

    function mint(address to) external returns (uint256) {
        balanceOf[to] += 1;
        return 1;
    }

    function burn(address to) external returns (uint256, uint256) {
        to;
        return (0, 0);
    }
}
