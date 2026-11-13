// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ToyERC20} from "../src/ToyERC20.sol";

contract ToyERC20Test is Test {
    ToyERC20 internal token;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    function setUp() public {
        token = new ToyERC20("Toy", "TOY", 18, 1000, ALICE);
    }

    function test_mintMatchesSupply() public view {
        assertEq(token.totalSupply(), 1000);
        assertEq(token.balanceOf(ALICE), 1000);
        assertEq(token.balanceOf(BOB), 0);
        assertEq(token.decimals(), 18);
    }

    function test_transferConservesSupply() public {
        vm.prank(ALICE);
        assertTrue(token.transfer(BOB, 400));
        assertEq(token.balanceOf(ALICE), 600);
        assertEq(token.balanceOf(BOB), 400);
        assertEq(token.totalSupply(), 1000);
    }

    function test_selfTransferKeepsBalance() public {
        vm.prank(ALICE);
        assertTrue(token.transfer(ALICE, 1000));
        assertEq(token.balanceOf(ALICE), 1000);
        assertEq(token.totalSupply(), 1000);
    }

    function test_insufficientBalanceReverts() public {
        vm.prank(ALICE);
        vm.expectRevert();
        token.transfer(BOB, 1001);
        assertEq(token.balanceOf(ALICE), 1000);
        assertEq(token.balanceOf(BOB), 0);
    }
}
