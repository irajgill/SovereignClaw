/**
 * Thin ethers Contract factories. Centralized so every helper uses the same
 * ABI binding and explorer URL formatting.
 */
import { Contract, type ContractRunner, type Provider } from 'ethers';
import { AgentNFTAbi, MemoryRevocationAbi } from './abis.js';

export function getAgentNFT(address: string, runner: ContractRunner): Contract {
  return new Contract(address, AgentNFTAbi as never, runner);
}

export function getMemoryRevocation(address: string, runner: Provider | ContractRunner): Contract {
  return new Contract(address, MemoryRevocationAbi as never, runner);
}

export function explorerTxUrl(explorerBase: string, txHash: string): string {
  return `${explorerBase.replace(/\/+$/, '')}/tx/${txHash}`;
}

export function explorerAddressUrl(explorerBase: string, address: string): string {
  return `${explorerBase.replace(/\/+$/, '')}/address/${address}`;
}
