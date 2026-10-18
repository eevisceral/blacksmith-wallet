// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC1967Proxy} from "./ERC1967Proxy.sol";

/// @title AccountFactory
/// @notice Permissionless CREATE2 factory for Kernel 0.2.4 ECDSA accounts.
///         No owner, no allowlist, no upgrade. Implementation and validator
///         are constants (same addresses on Ethereum and Base). Anyone may
///         create index-0 for any owner; a second call is a no-op.
contract AccountFactory {
    error DeployFailed();
    error MissingKernel();
    error ZeroOwner();

    address public constant IMPLEMENTATION = 0xd3082872F8B06073A021b4602e022d5A070d7cfC;
    address public constant VALIDATOR = 0xd9AB5096a832b9ce79914329DAEE236f8Eea0390;

    event AccountCreated(address indexed account, address indexed owner, uint256 index);

    function createAccount(address owner, uint256 index) external returns (address account) {
        if (owner == address(0)) revert ZeroOwner();
        if (IMPLEMENTATION.code.length == 0 || VALIDATOR.code.length == 0) revert MissingKernel();
        account = getAccountAddress(owner, index);
        if (account.code.length > 0) return account;

        bytes memory initcode = abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(IMPLEMENTATION, _init(owner)));
        bytes32 salt = _salt(owner, index);
        address deployed;
        assembly ("memory-safe") {
            deployed := create2(0, add(initcode, 0x20), mload(initcode), salt)
        }
        if (deployed == address(0) || deployed != account || deployed.code.length == 0) revert DeployFailed();
        emit AccountCreated(account, owner, index);
    }

    function getAccountAddress(address owner, uint256 index) public view returns (address) {
        if (owner == address(0)) revert ZeroOwner();
        bytes32 salt = _salt(owner, index);
        bytes32 initHash = keccak256(abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(IMPLEMENTATION, _init(owner))));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initHash)))));
    }

    function _salt(address owner, uint256 index) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(owner, index));
    }

    /// @dev initialize(IKernelValidator, bytes) — selector 0xd1f57894, owner as 20 raw bytes.
    function _init(address owner) private pure returns (bytes memory) {
        return abi.encodeWithSelector(bytes4(0xd1f57894), VALIDATOR, abi.encodePacked(owner));
    }
}
