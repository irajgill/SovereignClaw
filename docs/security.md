# SovereignClaw Security Model (v1, Phase 3 draft)

This is the first cut of the security model. It pairs with §2.4 (trust
boundaries) and §6.5 (revocation) of `SovereignClaw-Roadmap.md`. Phase 8
will publish the polished, audit-grade version; this draft is the working
reference for builders today.

> **Hackathon-scope notice.** SovereignClaw runs on 0G Galileo testnet with
> a centralized "dev oracle" that we run. Production deployments must replace
> the dev oracle with a TEE-attested service. Every limitation that exists
> only because we chose a fast hackathon path is called out below as
> "Phase 3 simplification" with what production needs to do instead.

## Trust boundaries

There are **two** trust boundaries in SovereignClaw. Not seven, not one.

### Boundary A — Wallet-derived encryption

All sovereign memory is encrypted **off-chain**, before it is written to 0G
Storage, with AES-256-GCM under a Data Encryption Key (DEK) that is wrapped
under a Key Encryption Key (KEK) derived deterministically from a wallet
signature on a fixed message (EIP-191).

- The KEK never leaves the user's session in the browser path.
- On the backend path, the KEK is derived from a server-held wallet for that
  agent. That wallet is the trust unit.
- The contract stores a **wrapped DEK** in `AgentNFT.Agent.wrappedDEK`. Up
  to 2048 bytes. Nobody who lacks the wallet can derive the DEK.
- AAD (additional authenticated data) for AES-GCM is namespace + key, so a
  ciphertext from one (namespace, key) pair cannot be substituted for
  another.

**What this guarantees.** An attacker reading 0G Storage sees ciphertext.
Without the wallet that derived the KEK, they cannot read the plaintext.
This is what makes memory "sovereign."

**What this does not guarantee.** Forward secrecy: if the wallet is later
compromised, all of its historical ciphertexts are recoverable. There is no
way to make 0G Storage forget. This is fundamental to immutable storage,
not a SovereignClaw choice.

### Boundary B — The oracle

ERC-7857 transfers require the wrapped DEK to be re-wrapped under the new
owner's pubkey before the on-chain transfer takes effect. SovereignClaw
delegates that re-wrapping to a service we call **the oracle**.

The oracle holds:

1. A long-lived secp256k1 keypair (the _oracle key_). The contract verifies
   EIP-712 signatures from this address before accepting any transfer or
   revoke.
2. (In production) Re-encryption material for actually re-wrapping the DEK.

**Phase 3 simplification.** The dev oracle in `apps/backend/src/routes/oracle/`
runs a Hono service we control. It accepts `/oracle/reencrypt` and
`/oracle/revoke` and signs proofs. **It does not yet perform real ECIES
re-encryption** — the placeholder passes the on-chain DEK bytes through
unchanged for the new owner. This is sufficient to exercise the contract
flow end-to-end on testnet but is _not_ a meaningful crypto guarantee in
isolation. The README of `apps/backend` and the example app both call this
out. Production must:

1. Run inside a TEE (Intel TDX or equivalent) and ship attestations alongside
   each `/oracle/reencrypt` response.
2. Implement true ECIES re-encryption: decrypt under the oracle's own
   keypair, re-encrypt to the new owner's pubkey using a tamper-evident
   protocol (so the new owner can detect oracle misbehavior).
3. Persist the in-memory revocation registry (Phase 3 ships it
   process-local; documented at the top of `apps/backend/src/store.ts`).
4. Re-read on-chain `MemoryRevocation` at boot to rebuild the in-memory
   set, so a restart cannot be exploited to re-encrypt a revoked token.
5. Rotate `ORACLE_PRIVATE_KEY` on a schedule with `setOracle`. The
   `oracleHistory` array in `deployments/0g-testnet.json` records every
   rotation.

**The oracle is a centralized trust point.** Anyone who controls the oracle
key can sign valid transfer / revoke proofs that the contract will accept.
SovereignClaw is honest about this; the production swap to a TEE is the
mitigation.

## Revocation: honest crypto semantics

This is the most-asked, least-understood part of the system. Borrowing
roadmap §6.5 verbatim:

**What revocation cannot do.**

- **Delete the encrypted blob from 0G Storage.** Storage is immutable.
- **Recall a DEK that someone has already extracted into their session memory.**
  AES-GCM is symmetric; once the key has been seen, it has been seen.

**What revocation can do.**

- **Destroy on-chain access to the wrapped DEK.** `AgentNFT.revoke` zeroes
  the `wrappedDEK` storage slot and sets `revoked = true`. Irreversible.
- **Make the oracle refuse future re-encryption for the token.** The oracle
  records the tokenId in its registry; subsequent `/oracle/reencrypt`
  returns HTTP 410.
- **Mark the token revoked on-chain so well-behaved readers refuse to
  read.** `MemoryRevocation.isRevoked(tokenId)` is a public view.

**The honest pitch.** After revocation, no party that did not already hold
the DEK can ever derive it. The chain enforces this; the oracle cooperates;
well-behaved clients respect the flag.

This is the strongest you can get with immutable storage and stays-online
ciphertext. SovereignClaw does not pretend to offer more.

## Defense-in-depth hierarchy

If one of the layers below fails, what's left?

| Compromise                                       | What's still safe                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0G Storage operator becomes hostile              | Ciphertext is unreadable without the wallet KEK. Sovereign memory still sovereign.                                                                                                                                                                                                                      |
| Oracle key is stolen                             | Attacker can transfer tokens to themselves but cannot read previously-revoked memory. **Also**: attacker can sign re-encryption for non-revoked tokens, so any token still alive can be moved without the owner's consent. **This is the highest-impact failure mode** and is why production needs TEE. |
| Owner wallet is stolen                           | Game over for that owner. Standard Web3 risk.                                                                                                                                                                                                                                                           |
| Compute provider returns wrong inference         | Detectable iff `verify_tee=true` (Phase 1 default). Provider is failover-able by Router.                                                                                                                                                                                                                |
| Indexer node lies about uploads                  | Each upload returns a Merkle root; download verifies against it. The SDK refuses bad data.                                                                                                                                                                                                              |
| `MemoryRevocation` registry is somehow rewritten | Cannot happen: `agentNFT` is immutable in the registry's constructor; only AgentNFT can write; AgentNFT only writes inside its own `revoke` function which checks owner+oracle. Three levels of misalignment would be required.                                                                         |

## EIP-712 binding

All oracle proofs are EIP-712 typed-data signatures over a struct that
binds:

- `action` ∈ {Transfer, Revoke} — prevents action-confusion replay.
- `tokenId` — prevents binding-replay across tokens.
- `from`, `to` — prevents re-routing of a transfer.
- `newPointer`, `dataHash` — pins the encrypted-pointer and DEK-hash the
  proof attests to.
- `nonce` — per-token monotonic counter; replay impossible.

The domain separator pins `chainId = 16602`, `verifyingContract = AgentNFT
address`, name `"SovereignClaw AgentNFT"`, version `"1"`. A signature for
one deploy on one chain cannot be replayed on any other.

The off-chain TS code (`packages/inft/src/eip712.ts`,
`apps/backend/src/eip712.ts`) and the on-chain Solidity
(`contracts/src/AgentNFT.sol::_verifyOracleProof`) compute the digest from
the same constants. Constants are emitted by Foundry into
`deployments/eip712-typehashes.json` and asserted byte-equal in unit tests.
Drift fails CI.

## Things production must do that hackathon scope does not

This list is the gap between "demo on testnet" and "ship to mainnet":

1. **TEE-attested oracle.** See above.
2. **True ECIES re-encryption** of the wrapped DEK on transfer.
3. **Persistent oracle revocation registry**, rebuilt from chain at boot.
4. **`docs/security.md` audit-grade rewrite** post-Phase-8 with formal
   threat model and STRIDE breakdown.
5. **Source verification on chainscan-galileo** (Phase 2 carryover; manual
   upload pending while the explorer's verification page is unnavigable).
6. **Wallet-side rate limiting** on the oracle to prevent DoS.
7. **Authenticated transport** between client and oracle by default
   (Phase 3 supports `ORACLE_AUTH_TOKEN` but does not require it).
8. **Off-chain audit log** of every oracle action, write-only by the oracle
   and verifiable by any third party.

## Reporting

Security issues: please email `claudee.helloagentic@gmail.com` rather than
opening a public issue. Phase 8 will publish a proper `SECURITY.md` with
a key for confidential reports.
