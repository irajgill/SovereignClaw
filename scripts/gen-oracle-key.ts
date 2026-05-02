/**
 * Generate a fresh secp256k1 keypair for the SovereignClaw dev oracle.
 *
 * Writes the private key + address to stdout. Operators put the private
 * key into their secret store; nothing is persisted to disk by this script.
 *
 *   pnpm gen:oracle-key
 *
 * Output is JSON; pipe to jq if you only want one field.
 */
import { Wallet } from 'ethers';

const w = Wallet.createRandom();
const out = {
  ORACLE_PRIVATE_KEY: w.privateKey,
  ORACLE_ADDRESS: w.address,
  generatedAt: new Date().toISOString(),
  warning:
    'Treat ORACLE_PRIVATE_KEY like a wallet key. NEVER commit it. Put it in your secret store.',
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
