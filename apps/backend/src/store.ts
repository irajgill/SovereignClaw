/**
 * In-memory revocation registry.
 *
 * This is the oracle's *own* record of which tokenIds it refuses to
 * re-encrypt. It is intentionally process-local and lost on restart —
 * acceptable for hackathon scope because the on-chain `MemoryRevocation`
 * registry is the durable source of truth, and a restarted oracle that
 * re-checks the chain at boot would be a Phase 4+ enhancement.
 *
 * Documented persistence gap: a restarted oracle that does NOT re-read
 * the chain could be tricked into re-encrypting a token the chain has
 * already revoked. Production deployments must persist this set or
 * read it from the chain on every reencrypt request. Phase 3's example
 * flow always submits the on-chain revoke tx after the oracle marks the
 * token, so the chain catches it; this in-memory store is belt-and-
 * suspenders for the same-process window.
 */
export interface RevocationStore {
  has(tokenId: bigint): boolean;
  add(tokenId: bigint, revokedBy: string): void;
  size(): number;
}

export function createInMemoryStore(): RevocationStore {
  const set = new Map<string, { revokedBy: string; at: number }>();
  return {
    has(tokenId) {
      return set.has(tokenId.toString());
    },
    add(tokenId, revokedBy) {
      set.set(tokenId.toString(), { revokedBy, at: Date.now() });
    },
    size() {
      return set.size;
    },
  };
}
