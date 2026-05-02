// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MemoryRevocation} from "../src/MemoryRevocation.sol";
import {AgentNFT} from "../src/AgentNFT.sol";

/// @notice Deploys MemoryRevocation and AgentNFT in one broadcast.
///         MemoryRevocation.agentNFT is immutable, so we predict the
///         AgentNFT address with vm.computeCreateAddress before deploying
///         the registry, then assert the prediction held after AgentNFT
///         is created. If the assertion ever fires, the broadcaster's
///         nonce was not what we expected — re-run with --slow or check
///         for pending txs.
///
/// Required env:
///   PRIVATE_KEY     — deployer wallet (funded with 0G testnet gas)
///   ORACLE_ADDRESS  — initial oracle address (rotatable later via setOracle)
///
/// Optional env:
///   AGENT_NFT_NAME    — ERC-721 name (default "SovereignClaw Agent")
///   AGENT_NFT_SYMBOL  — ERC-721 symbol (default "SCAGENT")
contract Deploy is Script {
    function run() external returns (address agentNFTAddr, address revocationAddr) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        require(oracle != address(0), "ORACLE_ADDRESS=0");

        string memory name_ = vm.envOr("AGENT_NFT_NAME", string("SovereignClaw Agent"));
        string memory symbol_ = vm.envOr("AGENT_NFT_SYMBOL", string("SCAGENT"));

        address deployer = vm.addr(pk);
        // Two contracts; the registry deploys at nonce N, AgentNFT at N+1.
        address predictedAgentNFT = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);

        vm.startBroadcast(pk);
        MemoryRevocation registry = new MemoryRevocation(predictedAgentNFT);
        AgentNFT nft = new AgentNFT(address(registry), oracle, name_, symbol_);
        vm.stopBroadcast();

        require(address(nft) == predictedAgentNFT, "AgentNFT address prediction mismatch");

        console2.log("=== SovereignClaw Phase 2 deploy ===");
        console2.log("chainId:        ", block.chainid);
        console2.log("deployer:       ", deployer);
        console2.log("oracle:         ", oracle);
        console2.log("MemoryRevocation:", address(registry));
        console2.log("AgentNFT:       ", address(nft));

        return (address(nft), address(registry));
    }
}
