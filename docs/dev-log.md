# SovereignClaw - Dev Log

Append-only chronological log of build progress and decisions. One entry per
working session. Per working agreement Section 19.14, end-of-day `main` must be
green.

---

## Phase 0 - Foundation

### Open architectural questions for Phase 1

1. **Compute path: Router vs Direct.** Roadmap Section 3.3 specifies the Direct
   SDK (`@0glabs/0g-serving-broker`) with manual ledger funding and TeeML
   verification. Since the roadmap was written, 0G has shipped the Compute
   Router - an OpenAI-compatible HTTPS gateway with API-key auth.
   **Update from Phase 0 dashboard inspection:** the Router supports a
   `verify_tee: true` request flag that returns on-chain TEE attestation in the
   response trace (`tee_verified` field). Confirmed working with
   `qwen/qwen-2.5-7b-instruct` on testnet. This means Router does not sacrifice
   the per-call attestation surface - it exposes it as opt-in. Phase 1 should
   standardize on Router for `sealed0GInference` unless the Direct SDK exposes
   attestation properties Router does not, such as raw TEE quote bytes for our
   own verification, or per-provider key pinning. Recommendation logged for
   Phase 1 kickoff: default Router, evaluate Direct only if a concrete
   sovereignty requirement demands it.
2. **Built-in SDK encryption.** `@0gfoundation/0g-ts-sdk@1.2.6+` ships native
   AES-256 + ECIES encryption. We're pinned to 1.2.1 which predates this.
   Roadmap Section 6.2 specifies our own `encrypted()` wrapper. Phase 1 must
   decide: (a) stay on 1.2.1 and write our own per spec - gives full control over
   key derivation from wallet sig per Section 6.3, or (b) upgrade >=1.2.6 and
   wrap the SDK's encryption. Either is defensible.
3. **Package naming.** Roadmap calls the storage SDK `@0glabs/0g-ts-sdk`; the
   actually-published package is `@0gfoundation/0g-ts-sdk`. Phase 0 uses the
   correct one. Future references in code/docs should match.

### Phase 0 → Phase 1 handoff: TEE field path resolved

Step 1.0 of Phase 1 ran `scripts/inspect-router-response.ts` against the
testnet Router with `qwen/qwen-2.5-7b-instruct`. Result:

- **TEE attestation field:** `x_0g_trace.tee_verified` (boolean).
- **Provider address:** `x_0g_trace.provider` (0x-prefixed, on-chain).
- **Request ID:** `x_0g_trace.request_id` (UUID, useful for support tickets).
- **Per-call billing:** `x_0g_trace.billing.{input_cost, output_cost, total_cost}`
  (string-encoded wei).

The Router uses an `x_0g_trace` envelope for all 0G-specific metadata.
This is the canonical extension point and Phase 1's `sealed0GInference`
adapter will type it explicitly.

**Confirmed live:** `tee_verified: true` returned for this model + provider
combination. TEE attestation is a real, verified claim, not theatre.

**Phase 1 implication:** `InferenceResult` will surface a typed `attestation:
{ teeVerified: boolean; providerAddress: string }` block and a `billing:
{ inputCost: bigint; outputCost: bigint; totalCost: bigint }` block on
every result. The roadmap §7.4 update from Phase 0 stands; we now have
the field path it referenced.
