# SovereignClaw — 2:30 demo video script (Track 1)

Read at a normal pace this is ~2:35. Bracketed lines describe the cut /
overlay; everything else is what you say.

---

## 0:00 — 0:15 · Hook

> [Open on the README hero. Cursor highlights the badges row, then
> > scrolls to the four code snippets.]

"AI agents today live inside a single provider's account. You can't take
their memory with you. You can't sell them. You can't shut them down.

SovereignClaw fixes that. Sovereign memory on 0G Storage. ERC-7857 iNFT
lifecycle on chain. TEE-attested inference. All open source. All in
TypeScript. Five packages on npm."

## 0:15 — 0:35 · Install + agent in 8 lines

> [Switch to terminal. Show `pnpm add @sovereignclaw/core
> > @sovereignclaw/memory @sovereignclaw/inft @sovereignclaw/reflection
> > @sovereignclaw/mesh ethers` running.]

"One install, five packages. Each composable on its own."

> [Open `examples/research-claw/src/index.ts` — about 80 lines of code.]

"This is ResearchClaw. Eighty lines of TypeScript. It's a sovereign
researcher: encrypted memory on 0G Storage, TEE-verified inference
through the 0G Compute Router, self-critique via the reflection package
that writes learnings back to the same memory."

## 0:35 — 1:05 · Run it on real testnet

> [Run `cd examples/research-claw && pnpm dev`. Let the output play.]

"`pnpm dev`. Real testnet. No mocks."

> [As lines stream:]

"There's the inference call. `tee_verified: true` — that's a real
attestation from a TDX provider, dstack-verified, on chain.

Reflection just ran. Score 0.87. The learning gets written back as an
encrypted entry on 0G Log — there's the root hash."

## 1:05 — 1:25 · Mint as iNFT

> [Continue same terminal. Highlight the `mintAgentNFT` call printing.]

"One function call mints the agent as an ERC-7857 iNFT. The agent's
encrypted memory pointer goes on chain. The DEK is wrapped under the
owner's pubkey."

> [Click the chainscan link. Show the AgentNFT contract page with the
> > fresh Mint event.]

"There it is on chainscan-galileo. Real token. Real owner. Real metadata
hash."

## 1:25 — 1:50 · Revoke — the killer feature

> [Back to terminal. Run the revoke command.]

"This is what makes it sovereign. `revokeMemory`. The owner clicks
revoke; the oracle marks the token; the contract zeroes the wrapped DEK
on chain. After this returns, no party that didn't already hold the key
can ever derive it. Click to unreadable: one-point-five seconds."

> [Show the timing breakdown print. Then click the chainscan link to
> > the Revoked event.]

"Verifiable on chain. The MemoryRevocation registry is public. Anyone
can query it without paying for the full NFT storage layout."

## 1:50 — 2:20 · ClawStudio — drag-build, click deploy

> [Switch tab to https://sovereignclaw-studio.vercel.app.]

"Same primitives, but visual. ClawStudio. Drag a Memory node. Drag an
Inference node. Drag a Reflection node. Connect them to an Agent. The
generated code is in the Monaco panel — same code you'd write by hand."

> [Click Deploy. Let the toast progress through "manifest written →
> > agent #N minted".]

"Click Deploy. The backend re-runs the canonical codegen to reject
tampered client source, writes a manifest to 0G Storage, and mints one
iNFT per agent. Three real iNFTs land on chain in about a minute."

> [Click each tx link briefly.]

"All three on chainscan."

## 2:20 — 2:35 · Track 2 closer + outro

> [Switch tab to github.com/irajgill/IncomeClaw.]

"And this — IncomeClaw — is the production consumer. Five sovereign
agents wired into a mesh, hired as iNFTs, killable on demand. That's
the Track 2 submission, separate repo, built only against the public
API of these five packages.

SovereignClaw. Five packages on npm. Two contracts on Galileo.
Open-source. Yours."

> [End card: `npm i @sovereignclaw/core` · `github.com/lalla-ai/SovereignClaw` ·
> > Telegram + X handles.]

---

## Hand-cued screen list (for editing)

| Beat | Window                                                             |
| ---- | ------------------------------------------------------------------ |
| 0:00 | README hero                                                        |
| 0:15 | Terminal — `pnpm add`                                              |
| 0:25 | `examples/research-claw/src/index.ts` (VS Code, ~80 lines visible) |
| 0:35 | Terminal — `pnpm dev` streaming                                    |
| 1:05 | Terminal — `mintAgentNFT` output                                   |
| 1:15 | Browser tab — chainscan-galileo AgentNFT page                      |
| 1:25 | Terminal — revoke output with timing breakdown                     |
| 1:40 | Browser tab — chainscan revoke tx                                  |
| 1:50 | Browser tab — sovereignclaw-studio.vercel.app, drag in flight      |
| 2:05 | Studio Deploy progress toast                                       |
| 2:15 | chainscan tx links (3 of them)                                     |
| 2:20 | Browser tab — github.com/irajgill/IncomeClaw README                |
| 2:30 | End card                                                           |

## Pre-recording checklist

1. Wallet `.env` has ≥0.05 0G; faucet at https://faucet.0g.ai if needed.
2. `pnpm benchmark:cold-start` clean run within last 24h (proves the
   8-line agent path).
3. ClawStudio backend on Railway is up: `curl https://oracle-production-5db4.up.railway.app/healthz`.
4. One throwaway tx run on Galileo 30 s before recording (warms RPC).
5. Browser zoom at 110%; terminal font ≥16pt.
6. Cut every cursor wiggle. Air time is precious.

## Backup if something flakes mid-take

- ResearchClaw step: pre-record once cleanly, splice in if live tee_verified
  doesn't show up.
- Studio Deploy step: pre-record one successful deploy and have it queued.
  Live failure = cut to the canned clip; voiceover continues.
- Chainscan: keep the explorer pages already loaded in a second window so
  you don't have to wait on a render mid-take.
