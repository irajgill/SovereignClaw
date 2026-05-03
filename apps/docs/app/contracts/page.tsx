import { DocsLayout } from '@/components/Layout';

export const metadata = { title: 'Contracts' };

const AGENT_NFT = '0xc3f997545da4AA8E70C82Aab82ECB48722740601';
const REVOCATION = '0x735084C861E64923576D04d678bA2f89f6fbb6AC';
const ORACLE = '0x4a5CbF36C2aE90879f7c2eF5dCC32Fecb0b569e3';
const DEPLOYER = '0x236E59315dD2Fc05704915a6a1a7ba4791cc3b5B';

export default function Page(): JSX.Element {
  return (
    <DocsLayout active="/contracts">
      <h1>Contracts on 0G Galileo Testnet</h1>
      <p>
        Deployed Phase 2 (May 2026), bytecode-verified. <code>chainId 16602</code>. Both contracts
        are immutable post-deploy except for the owner-only <code>setOracle</code> rotation on
        AgentNFT.
      </p>

      <h2>AgentNFT</h2>
      <p>
        ERC-7857-style iNFT — mint, transfer-with-reencryption, revoke, recordUsage. Standard
        ERC-721 transfer paths are disabled; every ownership change must go through the oracle
        re-encryption gate so the new owner can read the agent&apos;s memory.
      </p>
      <table>
        <tbody>
          <tr>
            <th>Address</th>
            <td>
              <a
                href={`https://chainscan-galileo.0g.ai/address/${AGENT_NFT}`}
                target="_blank"
                rel="noreferrer"
              >
                {AGENT_NFT}
              </a>
            </td>
          </tr>
          <tr>
            <th>Owner / admin</th>
            <td>
              <a
                href={`https://chainscan-galileo.0g.ai/address/${DEPLOYER}`}
                target="_blank"
                rel="noreferrer"
              >
                {DEPLOYER}
              </a>
            </td>
          </tr>
          <tr>
            <th>Oracle (current)</th>
            <td>
              <a
                href={`https://chainscan-galileo.0g.ai/address/${ORACLE}`}
                target="_blank"
                rel="noreferrer"
              >
                {ORACLE}
              </a>
            </td>
          </tr>
          <tr>
            <th>EIP-712 domain</th>
            <td>
              <code>SovereignClaw AgentNFT</code> · v1 · chainId 16602
            </td>
          </tr>
        </tbody>
      </table>

      <h2>MemoryRevocation</h2>
      <p>
        Public, append-only revocation registry. Bound to AgentNFT at construction (immutable).
        Anyone can call <code>isRevoked(tokenId)</code> / <code>getRevocation(tokenId)</code>; only
        AgentNFT can write.
      </p>
      <table>
        <tbody>
          <tr>
            <th>Address</th>
            <td>
              <a
                href={`https://chainscan-galileo.0g.ai/address/${REVOCATION}`}
                target="_blank"
                rel="noreferrer"
              >
                {REVOCATION}
              </a>
            </td>
          </tr>
          <tr>
            <th>DESTROYED_SENTINEL</th>
            <td>
              <code>keccak256(&quot;SOVEREIGNCLAW:DESTROYED:v1&quot;)</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Verifying yourself</h2>
      <p>
        Clone the repo and run <code>pnpm check:deployment</code>. The script reads{' '}
        <code>deployments/0g-testnet.json</code>, hits the live RPC, and asserts:
      </p>
      <ol>
        <li>both contracts have non-empty bytecode at the recorded addresses,</li>
        <li>
          <code>MemoryRevocation.agentNFT()</code> equals the AgentNFT address,
        </li>
        <li>
          <code>AgentNFT.revocationRegistry()</code> equals the MemoryRevocation address,
        </li>
        <li>
          <code>AgentNFT.oracle()</code> equals the dev-oracle address,
        </li>
        <li>
          <code>AgentNFT.owner()</code> equals the deployer,
        </li>
        <li>
          <code>name = &quot;SovereignClaw Agent&quot;</code>,{' '}
          <code>symbol = &quot;SCAGENT&quot;</code>, and
        </li>
        <li>
          the <code>DESTROYED_SENTINEL</code> hash matches the canonical bytes.
        </li>
      </ol>
      <p>
        10/10 green at every push to <code>main</code>.
      </p>

      <h2>Source</h2>
      <ul>
        <li>
          <a href="https://github.com/irajgill/SovereignClaw/blob/main/contracts/src/AgentNFT.sol">
            contracts/src/AgentNFT.sol
          </a>
        </li>
        <li>
          <a href="https://github.com/irajgill/SovereignClaw/blob/main/contracts/src/MemoryRevocation.sol">
            contracts/src/MemoryRevocation.sol
          </a>
        </li>
        <li>
          <a href="https://github.com/irajgill/SovereignClaw/tree/main/contracts/test">
            contracts/test/ (77 Foundry tests, 128k invariant calls per property)
          </a>
        </li>
      </ul>
    </DocsLayout>
  );
}
