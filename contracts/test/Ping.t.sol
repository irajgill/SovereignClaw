// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ping} from "../src/Ping.sol";

contract PingTest is Test {
    Ping internal pinger;

    event Pinged(address indexed from, string message, uint256 timestamp);

    function setUp() public {
        pinger = new Ping();
    }

    function test_emitsPingedEvent() public {
        vm.expectEmit(true, false, false, true);
        emit Pinged(address(this), "hello", block.timestamp);
        uint256 ts = pinger.ping("hello");
        assertEq(ts, block.timestamp);
    }

    function testFuzz_acceptsAnyMessage(string calldata msg_) public {
        pinger.ping(msg_);
    }
}
