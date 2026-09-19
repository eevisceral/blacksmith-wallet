// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VersionHost} from "../src/VersionHost.sol";
import {Deploy} from "../script/Deploy.s.sol";

contract VersionHostTest is Test {
    string internal constant FIXTURE = "<!doctype html><html><body>blacksmith-v1</body></html>";
    address internal constant PUBLISHED_HOST = 0x2a551c00ED1015266C30be02617Ec50EF52f27D1;
    bytes32 internal constant PUBLISHED_KECCAK = 0x19494a836b906d5948978721d6979dc7dad3a2eff02f9195874710eef3b5a797;
    address internal constant NICK_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    Deploy internal deployer;

    function setUp() public {
        deployer = new Deploy();
    }

    function test_htmlEqualsConcatOfChunkCode() public {
        bytes memory a = bytes("<html>");
        bytes memory b = bytes("chunk");
        address[] memory chunks = new address[](2);
        chunks[0] = deployer.deployChunk(a);
        chunks[1] = deployer.deployChunk(b);
        VersionHost host = new VersionHost(chunks);
        assertEq(bytes(host.html()), bytes.concat(a, b));
        assertEq(chunks[0].code, a);
        assertEq(chunks[1].code, b);
    }

    function test_revertEmptyDuplicateOrZero() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(VersionHost.InvalidData.selector);
        new VersionHost(empty);

        address[] memory tooMany = new address[](17);
        for (uint256 i; i < 17; ++i) {
            tooMany[i] = deployer.deployChunk(bytes(abi.encodePacked(uint8(i + 1))));
        }
        vm.expectRevert(VersionHost.InvalidData.selector);
        new VersionHost(tooMany);

        address[] memory missing = new address[](1);
        missing[0] = address(0xBEEF);
        vm.expectRevert(VersionHost.InvalidData.selector);
        new VersionHost(missing);

        address z = deployer.deployChunk(hex"");
        assertEq(z.code.length, 0);
        address[] memory emptyCode = new address[](1);
        emptyCode[0] = z;
        vm.expectRevert(VersionHost.InvalidData.selector);
        new VersionHost(emptyCode);

        address d = deployer.deployChunk(bytes("x"));
        address[] memory dup = new address[](2);
        dup[0] = d;
        dup[1] = d;
        vm.expectRevert(VersionHost.InvalidData.selector);
        new VersionHost(dup);
    }

    function test_htmlKeccakMatchesFixture() public {
        address[] memory chunks = new address[](1);
        chunks[0] = deployer.deployChunk(bytes(FIXTURE));
        VersionHost host = new VersionHost(chunks);
        assertEq(keccak256(bytes(host.html())), keccak256(bytes(FIXTURE)));
    }

    function test_request200HeadersBodyHash() public {
        address[] memory chunks = new address[](1);
        chunks[0] = deployer.deployChunk(bytes(FIXTURE));
        VersionHost host = new VersionHost(chunks);
        string[] memory resource;
        VersionHost.KeyValue[] memory params;
        (uint16 status, string memory body, VersionHost.KeyValue[] memory headers) = host.request(resource, params);
        assertEq(status, 200);
        assertEq(headers.length, 2);
        assertEq(headers[0].key, "Content-Type");
        assertEq(headers[0].value, "text/html");
        assertEq(headers[1].key, "Cache-Control");
        assertEq(headers[1].value, "public, max-age=31536000, immutable");
        assertEq(keccak256(bytes(body)), keccak256(bytes(host.html())));
        assertEq(host.resolveMode(), bytes32("5219"));
    }

    function testFuzz_smallChunks(uint8 nRaw, bytes32 seed) public {
        uint256 n = bound(nRaw, 1, 8);
        address[] memory chunks = new address[](n);
        bytes memory expected;
        for (uint256 i; i < n; ++i) {
            // EIP-3541 rejects runtime starting with 0xEF.
            bytes memory part = abi.encodePacked(bytes1(0x3c), seed, uint8(i), uint8(n));
            chunks[i] = deployer.deployChunk(part);
            expected = bytes.concat(expected, part);
        }
        VersionHost host = new VersionHost(chunks);
        assertEq(bytes(host.html()), expected);
    }

    function test_oversizeDeployChunkReverts() public {
        bytes memory huge = new bytes(24577);
        vm.expectRevert(bytes("chunk too large"));
        deployer.deployChunk(huge);
    }

    function test_eip3541PrefixReverts() public {
        vm.expectRevert(bytes("EIP-3541"));
        deployer.deployChunk(hex"ef00");
    }

    function test_requestIgnoresPathAndQuery() public {
        address[] memory chunks = new address[](1);
        chunks[0] = deployer.deployChunk(bytes(FIXTURE));
        VersionHost host = new VersionHost(chunks);
        string[] memory resource = new string[](2);
        resource[0] = "foo";
        resource[1] = "bar";
        VersionHost.KeyValue[] memory params = new VersionHost.KeyValue[](1);
        params[0] = VersionHost.KeyValue("q", "1");
        (uint16 status, string memory body,) = host.request(resource, params);
        assertEq(status, 200);
        assertEq(keccak256(bytes(body)), keccak256(bytes(FIXTURE)));
    }

    function test_create2PredictAndDeploy() public {
        _etchNickFactory();
        bytes memory part = bytes(FIXTURE);
        bytes memory initcode = deployer.chunkInitcode(part);
        bytes32 salt = deployer.chunkSalt(0, part);
        address predicted = deployer.predict(salt, initcode);
        address a = deployer.deployCreate2(salt, initcode);
        address b = deployer.deployCreate2(salt, initcode);
        assertEq(a, predicted);
        assertEq(a, b);
        assertEq(a.code, part);
    }

    function test_distHtmlRoundTrip() public {
        bytes memory raw = _requireDist();
        assertNotEq(uint8(raw[0]), 0xef);
        assertEq(keccak256(raw), PUBLISHED_KECCAK);
        (bytes[] memory parts,) = _split(raw);
        assertEq(parts.length, 6);
        address[] memory chunks = new address[](parts.length);
        for (uint256 i; i < parts.length; ++i) {
            chunks[i] = deployer.deployChunk(parts[i]);
        }
        VersionHost host = new VersionHost(chunks);
        assertEq(bytes(host.html()), raw);
        assertEq(keccak256(bytes(host.html())), PUBLISHED_KECCAK);
    }

    function test_create2PredictedHostMatchesPublishedPin() public {
        _etchNickFactory();
        bytes memory raw = _requireDist();
        (bytes[] memory parts, address[] memory predictedChunks) = _split(raw);
        assertEq(parts.length, 6);
        address[] memory chunks = new address[](parts.length);
        for (uint256 i; i < parts.length; ++i) {
            bytes memory initcode = deployer.chunkInitcode(parts[i]);
            bytes32 chunkSalt = deployer.chunkSalt(i, parts[i]);
            address chunkPredicted = deployer.predict(chunkSalt, initcode);
            assertEq(chunkPredicted, predictedChunks[i]);
            chunks[i] = deployer.deployCreate2(chunkSalt, initcode);
            assertEq(chunks[i], chunkPredicted);
        }
        bytes memory hostInit = abi.encodePacked(type(VersionHost).creationCode, abi.encode(chunks));
        bytes32 hostSalt = deployer.hostSalt(chunks);
        address hostPredicted = deployer.predict(hostSalt, hostInit);
        assertEq(hostPredicted, PUBLISHED_HOST);
        VersionHost host = VersionHost(deployer.deployCreate2(hostSalt, hostInit));
        assertEq(address(host), PUBLISHED_HOST);
        assertEq(keccak256(bytes(host.html())), PUBLISHED_KECCAK);
        assertNotEq(uint8(bytes(host.html())[0]), 0xef);
    }

    function test_hostAddressIndependentOfChainid() public {
        bytes memory raw = _requireDist();
        vm.chainId(1);
        address ethereum = _predictHost(raw);
        vm.chainId(8453);
        address base = _predictHost(raw);
        assertEq(ethereum, base);
        assertEq(ethereum, PUBLISHED_HOST);
    }

    function _etchNickFactory() internal {
        vm.etch(
            NICK_FACTORY,
            hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3"
        );
    }

    function _requireDist() internal view returns (bytes memory) {
        assertTrue(vm.exists("../dist/index.html"), "dist freeze artifact missing");
        return bytes(vm.readFile("../dist/index.html"));
    }

    function _split(bytes memory raw) internal view returns (bytes[] memory parts, address[] memory predictedChunks) {
        uint256 max = 24576;
        uint256 n = (raw.length + max - 1) / max;
        parts = new bytes[](n);
        predictedChunks = new address[](n);
        for (uint256 i; i < n; ++i) {
            uint256 start = i * max;
            uint256 len = raw.length - start;
            if (len > max) len = max;
            bytes memory part = new bytes(len);
            assembly {
                mcopy(add(part, 0x20), add(add(raw, 0x20), start), len)
            }
            parts[i] = part;
            predictedChunks[i] = deployer.predict(deployer.chunkSalt(i, part), deployer.chunkInitcode(part));
        }
    }

    function _predictHost(bytes memory raw) internal view returns (address) {
        (, address[] memory chunks) = _split(raw);
        bytes memory hostInit = abi.encodePacked(type(VersionHost).creationCode, abi.encode(chunks));
        return deployer.predict(deployer.hostSalt(chunks), hostInit);
    }
}
