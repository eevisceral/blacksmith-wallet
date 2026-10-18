// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AccountFactory} from "../src/AccountFactory.sol";
import {VersionHost} from "../src/VersionHost.sol";

/// @notice Deploy the permissionless AccountFactory, HTML data-contracts, then
///         an immutable VersionHost via Nick's CREATE2 factory.
/// @dev Same salt+initcode → same address on Ethereum and Base. Simulate locally;
///      pass `--broadcast` only when the operator intends that chain.
///      Do not broadcast to live networks from this repo's default flow.
contract Deploy is Script {
    uint256 internal constant MAX_RUNTIME = 24576;
    bytes32 internal constant SALT_NS = keccak256("blacksmith-v1-wallet");
    address internal constant PUBLISHED_FACTORY = 0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf;
    address internal constant PUBLISHED_HOST = 0x885affd4766d70512e35470E82453a9D8aA1D48C;
    bytes32 internal constant PUBLISHED_KECCAK = 0x2d1a9bea0c0af53232f229e8d0f6b13fe1cc1d317a714dd7071158913c3fdd40;
    address internal constant NICK_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant KERNEL_IMPL = 0xd3082872F8B06073A021b4602e022d5A070d7cfC;
    address internal constant ECDSA_VALIDATOR = 0xd9AB5096a832b9ce79914329DAEE236f8Eea0390;
    address internal constant ENTRY_POINT = 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789;

    function chunkInitcode(bytes memory data) public pure returns (bytes memory) {
        require(data.length <= MAX_RUNTIME, "chunk too large");
        require(data.length == 0 || data[0] != 0xef, "EIP-3541");
        return bytes.concat(hex"61", bytes2(uint16(data.length)), hex"80600A5F395FF3", data);
    }

    function predict(bytes32 salt, bytes memory initcode) public pure returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_FACTORY, salt, keccak256(initcode)))))
        );
    }

    function chunkSalt(uint256 i, bytes memory data) public pure returns (bytes32) {
        return keccak256(abi.encode(SALT_NS, uint256(0), i, keccak256(data)));
    }

    function hostSalt(address[] memory chunks) public pure returns (bytes32) {
        return keccak256(abi.encode(SALT_NS, uint256(1), chunks));
    }

    function factorySalt() public pure returns (bytes32) {
        return keccak256(abi.encode(SALT_NS, uint256(2)));
    }

    function factoryInitcode() public pure returns (bytes memory) {
        return type(AccountFactory).creationCode;
    }

    function predictFactory() public pure returns (address) {
        return predict(factorySalt(), factoryInitcode());
    }

    function deployCreate2(bytes32 salt, bytes memory initcode) public returns (address addr) {
        addr = predict(salt, initcode);
        if (addr.code.length > 0) return addr;
        require(CREATE2_FACTORY.code.length > 0, "no CREATE2 factory");
        (bool ok,) = CREATE2_FACTORY.call(abi.encodePacked(salt, initcode));
        require(ok && addr.code.length > 0, "create2 failed");
    }

    /// @notice Plain CREATE for unit tests (no factory). Production `run()` uses CREATE2.
    function deployChunk(bytes memory data) public returns (address addr) {
        bytes memory initcode = chunkInitcode(data);
        assembly {
            addr := create(0, add(initcode, 0x20), mload(initcode))
        }
        require(addr != address(0), "create failed");
    }

    function splitPage(bytes memory raw) public pure returns (bytes[] memory parts) {
        uint256 n = raw.length == 0 ? 0 : (raw.length + MAX_RUNTIME - 1) / MAX_RUNTIME;
        require(n > 0 && n <= 16, "bad split");
        parts = new bytes[](n);
        for (uint256 i; i < n; ++i) {
            uint256 start = i * MAX_RUNTIME;
            uint256 len = raw.length - start;
            if (len > MAX_RUNTIME) len = MAX_RUNTIME;
            bytes memory part = new bytes(len);
            assembly {
                mcopy(add(part, 0x20), add(add(raw, 0x20), start), len)
            }
            require(part[0] != 0xef, "EIP-3541");
            parts[i] = part;
        }
    }

    function predictHost(bytes memory raw) public pure returns (address host, address[] memory chunks) {
        bytes[] memory parts = splitPage(raw);
        chunks = new address[](parts.length);
        for (uint256 i; i < parts.length; ++i) {
            chunks[i] = predict(chunkSalt(i, parts[i]), chunkInitcode(parts[i]));
        }
        bytes memory hostInit = abi.encodePacked(type(VersionHost).creationCode, abi.encode(chunks));
        host = predict(hostSalt(chunks), hostInit);
    }

    function predictFromDist() public view returns (address host, bytes32 pageKeccak, uint256 nChunks) {
        bytes memory raw = bytes(vm.readFile("../dist/index.html"));
        (host,) = predictHost(raw);
        pageKeccak = keccak256(raw);
        nChunks = splitPage(raw).length;
    }

    function create2Factory() public pure returns (address) {
        return CREATE2_FACTORY;
    }

    /// @notice Compiler-time pin: forge-std CREATE2_FACTORY is Nick's factory.
    function pinGuards() public pure {
        require(CREATE2_FACTORY == NICK_FACTORY, "nick factory");
    }

    /// @notice Target-chain pin: Kernel, EntryPoint, and Nick already have code.
    function chainGuards() public view {
        pinGuards();
        require(NICK_FACTORY.code.length > 0, "no CREATE2 factory");
        require(KERNEL_IMPL.code.length > 0, "no kernel impl");
        require(ECDSA_VALIDATOR.code.length > 0, "no validator");
        require(ENTRY_POINT.code.length > 0, "no entrypoint");
    }

    function run() external {
        string memory page = vm.readFile("../dist/index.html");
        bytes memory raw = bytes(page);
        bytes[] memory parts = splitPage(raw);
        require(keccak256(raw) == PUBLISHED_KECCAK, "page keccak");
        (address predictedEarly,) = predictHost(raw);
        require(predictedEarly == PUBLISHED_HOST, "host pin");
        require(block.chainid == 1 || block.chainid == 8453, "chain");
        chainGuards();

        vm.startBroadcast();
        address factory = deployCreate2(factorySalt(), factoryInitcode());
        require(factory == predictFactory() && factory == PUBLISHED_FACTORY, "factory pin");
        address[] memory chunkAddrs = new address[](parts.length);
        for (uint256 i; i < parts.length; ++i) {
            chunkAddrs[i] = deployCreate2(chunkSalt(i, parts[i]), chunkInitcode(parts[i]));
        }
        bytes memory hostInit = abi.encodePacked(type(VersionHost).creationCode, abi.encode(chunkAddrs));
        address predictedHost = predict(hostSalt(chunkAddrs), hostInit);
        VersionHost host = VersionHost(deployCreate2(hostSalt(chunkAddrs), hostInit));
        require(address(host) == predictedHost && address(host) == PUBLISHED_HOST, "host pin");
        require(keccak256(bytes(host.html())) == keccak256(raw), "host html");
        vm.stopBroadcast();

        console2.log("solc 0.8.24 via_ir optimizer_runs=1 evm=cancun bytecode_hash=none");
        console2.log("chainid", block.chainid);
        console2.log("AccountFactory", factory);
        for (uint256 i; i < parts.length; ++i) {
            console2.log("chunk", i, chunkAddrs[i]);
        }
        console2.log("VersionHost", address(host));
        console2.logBytes(abi.encode(chunkAddrs));
        console2.logBytes32(keccak256(bytes(host.html())));
    }
}
