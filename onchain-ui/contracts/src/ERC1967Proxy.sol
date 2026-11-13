// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ERC1967Proxy
/// @notice Minimal EIP-1967 proxy. Constructor stores `implementation` and
///         delegatecalls `data` (Kernel `initialize`) in the same creation.
///         Used only as AccountFactory CREATE2 initcode — not a standalone host.
contract ERC1967Proxy {
    uint256 private constant _IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory data) payable {
        require(implementation.code.length > 0, "impl");
        assembly ("memory-safe") {
            sstore(_IMPL_SLOT, implementation)
        }
        if (data.length > 0) {
            (bool ok, bytes memory ret) = implementation.delegatecall(data);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }

    fallback() external payable {
        _delegate();
    }

    receive() external payable {
        _delegate();
    }

    function _delegate() private {
        assembly ("memory-safe") {
            let impl := sload(_IMPL_SLOT)
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
