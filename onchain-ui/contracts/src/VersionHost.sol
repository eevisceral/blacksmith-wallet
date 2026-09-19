// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title VersionHost
/// @notice Immutable ERC-5219 HTML host. Each chunk's runtime bytecode IS the
///         payload (no STOP prefix). `html()` concatenates constructor chunks
///         and never follows a latest/successor pointer.
contract VersionHost {
    error InvalidData();

    struct KeyValue {
        string key;
        string value;
    }

    address[] private chunks;

    constructor(address[] memory _chunks) {
        uint256 n = _chunks.length;
        if (n == 0 || n > 16) revert InvalidData();
        for (uint256 i; i < n; ++i) {
            if (_chunks[i].code.length == 0) revert InvalidData();
            for (uint256 j = i + 1; j < n; ++j) {
                if (_chunks[i] == _chunks[j]) revert InvalidData();
            }
        }
        chunks = _chunks;
    }

    /// @notice Concatenate full `extcodesize` of each stored chunk via EXTCODECOPY.
    function html() public view returns (string memory s) {
        address[] storage c = chunks;
        uint256 n = c.length;
        uint256 total;
        for (uint256 i; i < n; ++i) {
            total += c[i].code.length;
        }
        bytes memory out = new bytes(total);
        uint256 offset;
        for (uint256 i; i < n; ++i) {
            address chunk = c[i];
            uint256 len = chunk.code.length;
            assembly ("memory-safe") {
                extcodecopy(chunk, add(add(out, 0x20), offset), 0, len)
            }
            offset += len;
        }
        s = string(out);
    }

    /// @notice ERC-5219. Path/query ignored; body is this version's `html()`.
    function request(string[] calldata, KeyValue[] calldata)
        external
        view
        returns (uint16 statusCode, string memory body, KeyValue[] memory headers)
    {
        statusCode = 200;
        body = html();
        headers = new KeyValue[](2);
        headers[0] = KeyValue("Content-Type", "text/html");
        headers[1] = KeyValue("Cache-Control", "public, max-age=31536000, immutable");
    }

    /// @notice ERC-4804/5219: gateways should call `request()`.
    function resolveMode() external pure returns (bytes32) {
        return bytes32("5219");
    }
}
