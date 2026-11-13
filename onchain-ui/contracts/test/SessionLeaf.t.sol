// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

/// @notice Locks the SessionKeyValidator Permission abi.encode used as a merkle leaf.
contract SessionLeafTest is Test {
    enum Operation {
        Call,
        DelegateCall
    }

    enum ParamCondition {
        EQUAL,
        GREATER_THAN,
        LESS_THAN,
        GREATER_THAN_OR_EQUAL,
        LESS_THAN_OR_EQUAL,
        NOT_EQUAL
    }

    struct ParamRule {
        uint256 offset;
        ParamCondition condition;
        bytes32 param;
    }

    struct ExecutionRule {
        uint48 validAfter;
        uint48 interval;
        uint48 runs;
    }

    struct Permission {
        uint32 index;
        address target;
        bytes4 sig;
        uint256 valueLimit;
        ParamRule[] rules;
        ExecutionRule executionRule;
        Operation operation;
    }

    function _perm() internal pure returns (Permission memory p) {
        p.index = 0;
        p.target = address(0x1111111111111111111111111111111111111111);
        p.sig = 0xa9059cbb;
        p.valueLimit = 1000;
        p.executionRule = ExecutionRule(0, 0, 0);
        p.operation = Operation.Call;
    }

    function test_leafEncoding() public pure {
        Permission memory p = _perm();
        bytes memory enc = abi.encode(p);
        assertEq(keccak256(enc), 0xd4254abddf801fed6a9eafe0ed21295eea9cb69a686bb4a4976f6f22f15bdd61);
    }

    function test_batchTailEncoding() public pure {
        Permission memory a = _perm();
        Permission memory b = _perm();
        b.index = 1;
        b.sig = 0x095ea7b3;
        Permission[] memory ps = new Permission[](2);
        ps[0] = a;
        ps[1] = b;
        bytes32[][] memory proofs = new bytes32[][](2);
        proofs[0] = new bytes32[](1);
        proofs[0][0] = bytes32(uint256(0xabc));
        proofs[1] = new bytes32[](1);
        proofs[1][0] = bytes32(uint256(0xdef));
        bytes memory tail = abi.encode(ps, proofs);
        assertEq(keccak256(tail), 0x0c912ba9af8b4e5c1ec1b0d815bcdb5fc8722ccee9c069ace957e1e540783574);
    }
}
