import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDeployment, DeploymentNotFoundError } from '../src/index.js';

function writeFixture(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'inft-deploy-'));
  const path = join(dir, '0g-testnet.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe('loadDeployment', () => {
  it('parses a well-formed record', () => {
    const path = writeFixture({
      network: '0g-galileo-testnet',
      chainId: 16602,
      deployer: '0x0000000000000000000000000000000000000abc',
      oracle: '0x0000000000000000000000000000000000000def',
      addresses: {
        AgentNFT: '0xc3f997545da4AA8E70C82Aab82ECB48722740601',
        MemoryRevocation: '0x735084C861E64923576D04d678bA2f89f6fbb6AC',
      },
      explorer: {
        AgentNFT:
          'https://chainscan-galileo.0g.ai/address/0xc3f997545da4AA8E70C82Aab82ECB48722740601',
        MemoryRevocation:
          'https://chainscan-galileo.0g.ai/address/0x735084C861E64923576D04d678bA2f89f6fbb6AC',
      },
    });
    const d = loadDeployment({ path });
    expect(d.chainId).toBe(16602);
    expect(d.addresses.AgentNFT.toLowerCase()).toBe('0xc3f997545da4aa8e70c82aab82ecb48722740601');
  });

  it('throws DeploymentNotFoundError when file missing', () => {
    expect(() => loadDeployment({ path: '/no/such/path.json' })).toThrowError(
      DeploymentNotFoundError,
    );
  });

  it('throws on missing fields', () => {
    const path = writeFixture({ chainId: 1 });
    expect(() => loadDeployment({ path })).toThrowError(DeploymentNotFoundError);
  });

  it('throws on invalid address', () => {
    const path = writeFixture({
      chainId: 16602,
      oracle: '0x_not_an_address',
      addresses: { AgentNFT: 'not-an-address', MemoryRevocation: '0x1' },
    });
    expect(() => loadDeployment({ path })).toThrowError(DeploymentNotFoundError);
  });
});
