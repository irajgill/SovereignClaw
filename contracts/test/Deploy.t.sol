// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {AgentNFT} from "../src/AgentNFT.sol";
import {MemoryRevocation} from "../src/MemoryRevocation.sol";

contract DeployScriptTest is Test {
    function test_run_deploysAndBindsContracts() public {
        (address oracle, uint256 oraclePk) = makeAddrAndKey("oracle");
        oraclePk; // silence unused
        (, uint256 deployerPk) = makeAddrAndKey("deployer");
        vm.deal(vm.addr(deployerPk), 100 ether);

        vm.setEnv("PRIVATE_KEY", vm.toString(bytes32(deployerPk)));
        vm.setEnv("ORACLE_ADDRESS", vm.toString(oracle));

        Deploy deployer = new Deploy();
        (address nftAddr, address revAddr) = deployer.run();

        AgentNFT nft = AgentNFT(nftAddr);
        MemoryRevocation rev = MemoryRevocation(revAddr);

        assertEq(rev.agentNFT(), nftAddr, "registry binding wrong");
        assertEq(nft.revocationRegistry(), revAddr, "AgentNFT registry wrong");
        assertEq(nft.oracle(), oracle, "oracle wrong");
        assertEq(nft.owner(), vm.addr(deployerPk), "owner wrong");
        assertEq(nft.name(), "SovereignClaw Agent");
        assertEq(nft.symbol(), "SCAGENT");
    }
}
