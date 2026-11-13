// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AccountFactory} from "../src/AccountFactory.sol";
import {ERC1967Proxy} from "../src/ERC1967Proxy.sol";
import {Deploy} from "../script/Deploy.s.sol";

contract MockKernel {
    error AlreadyInitialized();

    address public defaultValidator;

    function initialize(address validator, bytes calldata data) external payable {
        if (defaultValidator != address(0)) revert AlreadyInitialized();
        defaultValidator = validator;
        (bool ok,) = validator.call(abi.encodeWithSignature("enable(bytes)", data));
        require(ok, "enable");
    }

    function ping() external payable returns (bytes32) {
        return keccak256("pong");
    }

    receive() external payable {}
}

contract RevertingKernel {
    function initialize(address, bytes calldata) external pure {
        revert("no");
    }
}

contract MockValidator {
    mapping(address => address) public ecdsaValidatorStorage;

    function enable(bytes calldata data) external payable {
        ecdsaValidatorStorage[msg.sender] = address(bytes20(data[0:20]));
    }
}

contract AccountFactoryTest is Test {
    address internal constant OWNER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    Deploy internal pins;
    AccountFactory internal factory;

    function setUp() public {
        pins = new Deploy();
        vm.etch(pins.kernelImpl(), type(MockKernel).runtimeCode);
        vm.etch(pins.ecdsaValidator(), type(MockValidator).runtimeCode);
        factory = new AccountFactory();
    }

    function test_constantsMatchPinnedKernel() public view {
        assertEq(factory.IMPLEMENTATION(), pins.kernelImpl());
        assertEq(factory.VALIDATOR(), pins.ecdsaValidator());
    }

    function test_createAccountPredictableAndIdempotent() public {
        address predicted = factory.getAccountAddress(OWNER, 0);
        assertEq(predicted.code.length, 0);

        address a = factory.createAccount(OWNER, 0);
        assertEq(a, predicted);
        assertGt(a.code.length, 0);

        address impl = address(
            uint160(
                uint256(
                    vm.load(a, bytes32(uint256(0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc)))
                )
            )
        );
        assertEq(impl, pins.kernelImpl());
        assertEq(MockValidator(pins.ecdsaValidator()).ecdsaValidatorStorage(a), OWNER);

        address b = factory.createAccount(OWNER, 0);
        assertEq(b, a);
    }

    function test_differentOwnersDifferentAddresses() public {
        address other = address(0xBEEF);
        address a = factory.getAccountAddress(OWNER, 0);
        address b = factory.getAccountAddress(other, 0);
        assertTrue(a != b);
        factory.createAccount(OWNER, 0);
        factory.createAccount(other, 0);
        assertEq(MockValidator(pins.ecdsaValidator()).ecdsaValidatorStorage(a), OWNER);
        assertEq(MockValidator(pins.ecdsaValidator()).ecdsaValidatorStorage(b), other);
    }

    function test_indexSeparatesAccounts() public {
        address i0 = factory.getAccountAddress(OWNER, 0);
        address i1 = factory.getAccountAddress(OWNER, 1);
        assertTrue(i0 != i1);
        address a1 = factory.createAccount(OWNER, 1);
        assertEq(a1, i1);
        assertEq(MockValidator(pins.ecdsaValidator()).ecdsaValidatorStorage(a1), OWNER);
        assertTrue(factory.getAccountAddress(OWNER, 0).code.length == 0);
    }

    function test_createRevertsIfImplMissing() public {
        vm.etch(pins.kernelImpl(), "");
        vm.expectRevert(AccountFactory.MissingKernel.selector);
        factory.createAccount(OWNER, 0);
    }

    function test_createRevertsIfValidatorMissing() public {
        vm.etch(pins.ecdsaValidator(), "");
        vm.expectRevert(AccountFactory.MissingKernel.selector);
        factory.createAccount(OWNER, 0);
    }

    function test_callerIsNotOwner() public {
        address caller = address(0xCA11);
        vm.prank(caller);
        address a = factory.createAccount(OWNER, 0);
        assertEq(MockValidator(pins.ecdsaValidator()).ecdsaValidatorStorage(a), OWNER);
        assertTrue(a != caller);
    }

    function test_proxyForwardsCallAndValue() public {
        address a = factory.createAccount(OWNER, 0);
        vm.deal(address(this), 1 ether);
        bytes32 got = MockKernel(payable(a)).ping{value: 0.2 ether}();
        assertEq(got, keccak256("pong"));
        assertEq(a.balance, 0.2 ether);
        (bool ok,) = a.call{value: 0.1 ether}("");
        assertTrue(ok);
        assertEq(a.balance, 0.3 ether);
    }

    function test_reinitializeThroughProxyReverts() public {
        address a = factory.createAccount(OWNER, 0);
        address val = pins.ecdsaValidator();
        vm.expectRevert(MockKernel.AlreadyInitialized.selector);
        MockKernel(payable(a)).initialize(val, abi.encodePacked(address(0xBEEF)));
        assertEq(MockValidator(val).ecdsaValidatorStorage(a), OWNER);
    }

    function test_failedInitializeDeploysNothing() public {
        vm.etch(pins.kernelImpl(), type(RevertingKernel).runtimeCode);
        address predicted = factory.getAccountAddress(OWNER, 0);
        vm.expectRevert(AccountFactory.DeployFailed.selector);
        factory.createAccount(OWNER, 0);
        assertEq(predicted.code.length, 0);
    }

    function test_zeroOwnerReverts() public {
        vm.expectRevert(AccountFactory.ZeroOwner.selector);
        factory.getAccountAddress(address(0), 0);
        vm.expectRevert(AccountFactory.ZeroOwner.selector);
        factory.createAccount(address(0), 0);
    }

    function test_publishedFactoryAddress() public {
        _etchNick();
        assertEq(pins.predictFactory(), pins.publishedFactory());
    }

    function test_noOwnerOrSetImplementation() public {
        (bool okOwner,) = address(factory).call(abi.encodeWithSignature("owner()"));
        (bool okSet,) =
            address(factory).call(abi.encodeWithSignature("setImplementation(address,bool)", pins.kernelImpl(), false));
        assertTrue(!okOwner);
        assertTrue(!okSet);
    }

    function test_create2FactoryAddressIndependentOfChainid() public {
        _etchNick();
        Deploy deployer = new Deploy();
        bytes memory initcode = type(AccountFactory).creationCode;
        bytes32 salt = deployer.factorySalt();
        vm.chainId(1);
        address ethereum = deployer.predict(salt, initcode);
        vm.chainId(8453);
        address base = deployer.predict(salt, initcode);
        assertEq(ethereum, base);
        address live = deployer.deployCreate2(salt, initcode);
        assertEq(live, ethereum);
        assertGt(live.code.length, 0);
    }

    function _etchNick() internal {
        vm.etch(
            pins.nickFactory(),
            hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3"
        );
    }
}
