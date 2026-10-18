// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Fork playground only — not part of the VersionHost freeze.
contract ToyERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(string memory n, string memory s, uint8 d, uint256 supply, address to) {
        name = n;
        symbol = s;
        decimals = d;
        totalSupply = supply;
        balanceOf[to] = supply;
        emit Transfer(address(0), to, supply);
    }

    function transfer(address to, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        emit Transfer(msg.sender, to, v);
        return true;
    }
}
