# Persona iO — Module 4 Implementation Report

**Mission:** Implement the smallest production-like prototype that proves one member turn can be controlled before irreversible release.
**Agent:** Claude (Opus 5, 1M context), Claude Code
**Date:** 2026-09-27
**Repository:** `/Users/michaeldiener/Desktop/aline-backend`
**Outcome:** Objective met and committed. **Not deployed.** Deployment is Mike's decision.

**No secrets in this document.** Environment variables appear by name only; no key, token, or credential value was read or recorded. All conversational content is synthetic test fixture text. No real member conversation was used.

---

## 1. REPOSITORY REVISION AND WORKING-TREE STATE

| Point | Revision | State |
|---|---|---|
| Before this run | `18878b2` | 4 modified files, 2 untracked, privacy hardening uncommitted |
| Baseline commit | `b27af9b` | Ships the hardening; build identity fixed before behavior changed |
| Implementation | `7425a6f` | Release control |
| Evidence commit | `ebe0534` | Timing diagnostics |
| **HEAD now** | **`ebe0534`** | **Working tree clean** |

Branch `main`. Node v22.23.1, npm 10.9.8.

**Critical finding that shaped ordering.** At `18878b2`, the committed build wrote member content to stdout. Verified by `git show HEAD:server.js`:

```
1801:  console.log(`[${personaId}] "${userText}"`)              verbatim member turn
1850:  console.log(`[${personaId}] Complete: "${fullResponse}"` )  full assistant reply
1853:  console.error(`[${personaId}] Anthropic error:`, err)     error carries request body
```

The hardened replacements existed only as uncommitted working-tree edits, and `test-runtime.js`, the suite proving them, was untracked and therefore in no repository. Priority 1 and 2 were executed first for that reason.

---

## 2. FILES CHANGED

Code diff `18878b2..ebe0534`, excluding `agent-runs/`: **9 files, 2854 insertions, 105 deletions.**

| File | Change |
|---|---|
| `services/release-policy.js` | **NEW, 270 lines.** The turn-time withhold primitive |
| `server.js` | Gated release loop, TTS decoupling, bounded drain, request timeout |
| `services/invariant-gate.js` | Repaired the anti-referral regeneration instruction. Detector patterns unchanged |
| `test-release.js` | **NEW, 391 lines.** 46 acceptance checks |
| `test-runtime.js` | Now tracked. Child and mock-server teardown. One scenario updated |
| `test-mra.js` | Now tracked (was uncommitted) |
| `package.json` | `npm test` runs all three suites; added `test:release` |
| `CRISIS_POLICY_SPEC.md` | Now tracked (was untracked) |
| `services/prompt-engine.js` | Now tracked (was uncommitted) |

---

## 3. COMMANDS RUN

```
git rev-parse HEAD ; git status --short ; git diff --stat
git show HEAD:server.js | grep -n "console\.\(log\|error\|warn\)"
node agent-runs/.../evidence/capture-baseline.js      # BEFORE any change
git add ... ; git commit                              # b27af9b baseline
node --check server.js ; node --check services/release-policy.js
npm test                                              # iteratively during implementation
node test-release.js
npm test ; npm test                                   # repeatability, back to back
node agent-runs/.../evidence/capture-after.js         # AFTER
lsof -nP -iTCP -sTCP:LISTEN | grep -E ":(4309|4409|...)"
git add -A ; git commit                               # 7425a6f, ebe0534
```

No deployment command, no Railway call, no GitHub API call, no production log read.

---

## 4. TESTS RUN AND OUTCOMES

| Suite | Checks | Result |
|---|---|---|
| `test-mra.js` unit | 52 | pass |
| `test-runtime.js` live wiring | 70 | pass |
| `test-release.js` release control | **46 (new)** | pass |
| **Total** | **168** | **pass, exit 0** |

Run twice consecutively: 168 pass both times, no leaked listeners on test ports afterward.

---

## 5. ORIGINAL FAILING CASES

Captured **before** any behavior change. Full output: `evidence/baseline-before.txt`.

**F1 — the deployed crisis suffix was classified as abandonment.**
```
SUFFIX: " I'm here with you. If you're in crisis, please reach out to 988."
checkNeverAbandons violations: 2
  severity=CRITICAL matched="please reach out to"
  severity=CRITICAL matched="988"
```

**F2 — a crisis reply demanded regeneration.** `enforceInvariants("I hear you." + CRISIS_SUFFIX, W21)` returned `requiresRegeneration: true`. Wiring the gate as-is would have regenerated away the crisis referral.

**F3 — identical text, different verdict by weight.** Same five-sentence reply: `W1 regen=false`, `W21 regen=true`, via `NEVER_FILLS` escalated to CRITICAL.

**F4 — regeneration instructions undid crisis precedence.**
```
"CRITICAL: Do NOT suggest professional help, hotlines, or say you cannot help. ..."
```

**F5 — no separation of referral from withdrawal.** A reply containing presence, a referral, and a genuine exit violation produced 4 undifferentiated violations, so referral and withdrawal were indistinguishable.

---

## 6. IMPLEMENTED CHANGES

### 6.1 `services/release-policy.js` — the withhold primitive

Persona iO could previously only **add** to a turn. Text and audio left during generation, so nothing could be withheld and every verdict necessarily arrived after the member had read and heard the sentence.

**First enforcement scope.** Only CRITICAL invariants independent of the weight classifier, which today is exactly `NEVER_ABANDONS`. `NEVER_FILLS` and `ALWAYS_CALIBRATES` are excluded because weight is not a severity signal. Measured against the live classifier:

| Probe | Weight |
|---|---|
| `I want a sandwich.` | 21 |
| `I am a teacher.` | 21 |
| `I think it will rain.` | 21 |
| `If she leaves me, I will kill myself tonight.` (synthetic fixture) | 3 |

`classifier.js:263` assigns 21 whenever any first-person psychological marker appears. Enforcing on weight would gate sandwich requests and pass lethal-intent disclosures. `NEVER_JUDGES` and `NEVER_NARRATES` are weight-independent but severity HIGH; they are reported as advisory and do not block.

`evaluateRelease(candidateText)` takes **one argument**. There is no classification parameter, so a classifier fault cannot skip, weaken, or change the release decision.

**Crisis precedence.** Abandonment matches split into two kinds:

- **EXIT** — withdrawing, disclaiming, refusing. Never exempt. Presence elsewhere does not excuse it.
- **REFERRAL** — pointing toward human or professional support. Exempt **only** when the candidate also carries presence.

Referral without presence remains abandonment, which preserves the existing `test-mra.js` assertion that `"Please call 988 if you're in crisis."` alone must fail the gate. Classification **fails closed**: an unrecognized abandonment match is treated as EXIT and never exempted.

### 6.2 `server.js` — gated release

Cumulative sentence-prefix gating. At each complete sentence boundary the whole response-so-far is evaluated. An approved sentence is released immediately, so the turn still streams. A sentence carrying a CRITICAL violation is never sent and never synthesized; generation stops and exactly one regeneration runs with constraints from `release-policy`, not from the gate's own function. A second failure emits the deterministic approved fallback and terminates. Never a third attempt.

`APPROVED_FALLBACK` is `"I'm here. I'm not going anywhere."` — non-empty, carries presence, and asserted to pass the policy it is the fallback for.

### 6.3 TTS decoupled and bounded

Synthesis was awaited **inside** the stream loop, which suspended the async iterator and let a slow vendor freeze text delivery with no upper bound. Now: text frames go out first; synthesis runs on a serial queue behind them; the ElevenLabs fetch carries an `AbortController` (`TTS_REQUEST_TIMEOUT_MS`, default 15000); the turn drains audio only up to `TTS_DRAIN_TIMEOUT_MS` (default 20000) before completing; audio failure emits an explicit `audio_unavailable` frame.

### 6.4 `services/invariant-gate.js` — repaired instruction

`buildRegenerationConstraints` told the model to avoid professional help and hotlines on any `NEVER_ABANDONS` violation, which would undo crisis precedence on a crisis turn regenerating for an unrelated reason. What is prohibited is **withdrawal**, not referral. Detector patterns are unchanged, so the existing 52 unit checks still pass unmodified.

### 6.5 Test-suite repeatability

Both runtime suites now track spawned children **and** the fixed-port in-process mock, and reap them on `exit`, `SIGINT`, `SIGTERM`, `uncaughtException`, and `unhandledRejection`. A leaked listener previously made the suite's own next run fail; that was observed directly twice during this work, once as `ECONNREFUSED` and once as `EADDRINUSE :::4309`.

---

## 7. ACCEPTANCE-TEST RESULTS

All 12 required conditions. Full output: `evidence/test-release-after.txt`.

| # | Condition | Result | Evidence |
|---|---|---|---|
| 1 | Rejected candidate: zero violating text released, zero into TTS | **PASS** | Asserted against `response_text` frames a real WebSocket client received and against captured ElevenLabs request bodies, not server-side variables |
| 2 | Appropriate human support survives | **PASS** | Crisis suffix `approved=true`; raw gate still flags it, release policy overrides via precedence |
| 3 | Mixed support + violation | **PASS** | EXIT blocks, referral exempt, and the 988 match is verified not to be what blocked it |
| 4 | Weight independence | **PASS** | `evaluateRelease.length === 1`; same outcome on W3 and W21 turns end to end |
| 5 | Classifier failure: no silent skip | **PASS** | Release path never consults classification; same attempts and same outcome at both weights |
| 6 | Gate exception | **PASS** | Throw becomes a block; `gateError` reported; constraints still produced |
| 7 | Exactly one regeneration | **PASS** | Anthropic HTTP requests counted at the mock: exactly 2 |
| 8 | Second failure | **PASS** | 2 calls, never 3; fallback delivered; not silence; `response_complete` reached |
| 9 | TTS stall | **PASS** | See timings below |
| 10 | Repeatability | **PASS** | 168 checks twice consecutively; no leaked listeners |
| 11 | Build identity | **PASS** | `ebe0534`, clean tree |
| 12 | Browser-visible pilot | **NOT PERFORMED** | See section 8 |

**Timing, measured (item 9):**

```
[timing] lastTextAt=22ms  completeAt=824ms   (vendor stall 6000ms, drain bound 800ms)
```

Approved text reached the member **22ms** after the turn was sent while the synthesis vendor was hung for 6 seconds. The turn completed at **824ms**, bounded by the 800ms drain rather than the 6000ms stall. Before this change the same stall would have blocked text for its full duration, and in production, with no timeout on the fetch at all, indefinitely.

---

## 8. BROWSER / PILOT RESULT

**Not performed. No browser client exists in this repository.**

Verified: no `index.html`, no `public/`, no HTML file outside `node_modules`. The only browser code is the Next.js scaffold under `app/` and `lib/`, which imports `next`, `react`, and `@supabase/ssr`, none of which appear in `package.json` or `node_modules`. It cannot compile.

What was done instead: `test-runtime.js` and `test-release.js` drive a **real WebSocket client** and assert on frames actually received. That is stronger than asserting on `ws.send()` return values, and it is **not** proof of browser rendering. Whether a browser renders `response_text`, and what it does with the new `audio_unavailable` frame, remains unverified.

**The new `audio_unavailable` frame requires frontend work to be visible to a member.** Until the client handles it, audio failure is explicit on the wire but still silent on screen.

---

## 9. UNRESOLVED UNKNOWNS

| Question | Why it matters |
|---|---|
| Which commit is deployed now | Nothing in this run was deployed. Production is presumed still `18878b2` and still logging member text verbatim |
| Railway log retention and access list | Bounds the historical exposure from the pre-`b27af9b` logging |
| How many real or prospect sessions ran before today | Determines the volume of conversation already in retained logs |
| Browser behavior for every frame type | No client available; two acceptance conditions depend on it |
| Simli token lifetime and scope | Untouched by this work; `/simli-session` remains unauthenticated |
| Real-world regeneration rate | Every measurement here used mocked model output. The rate at which live replies trip `NEVER_ABANDONS` is unknown |
| Gate false-positive rate on good replies | No good-reply corpus exists yet. This is the main risk of enabling enforcement |

---

## 10. LIMITATIONS

1. **Nothing is deployed.** Every result describes commit `ebe0534` in a local repository.
2. **One rule enforced.** Only `NEVER_ABANDONS`. Judgment, narration, filling, and calibration are not enforced.
3. **No good-reply corpus.** Enforcement is enabled without measuring how often ordinary supportive replies are blocked. `checkNeverAbandons` matches broad lexical patterns, including `/please (call|contact|reach out to|consider calling)/i`. This is the largest residual risk and the recommended next measurement.
4. **Presence detection is lexical.** A reply that conveys staying without using a recognized phrase will have its referral treated as EXIT and be blocked. Fails safe, but it will over-block.
5. **Crisis suffix still depends on the classifier.** `server.js` still gates the crisis-suffix call behind `if (classification)`. The *release* decision is classifier-independent; the *suffix* is not. Unchanged by this work and out of the stated scope.
6. **Regeneration prefills the assistant turn** with already-released text. Not validated against a live model, only against the mock.
7. **Four whole-object `console` calls remain** at `server.js` 1746, 1755, 1832, 2237. Out of scope here; the static guard in `test-runtime.js` still does not catch that shape.
8. **One existing test scenario was modified.** `test-runtime.js` "RESPONSE ALREADY CONTAINS 988" previously used the reply `'Brontide. Please call 988 if you need to.'`, which the new policy correctly blocks as a bare referral with no presence. The reply now reads `'Brontide. I am here. Please call 988 if you need to.'`. The scenario's purpose, that a reply already carrying a resource must not receive a second one, is unchanged. This is a deliberate, documented behavior change, and it is consistent with the stricter existing assertion in `test-mra.js`.
9. **History semantics deliberately left alone.** Accumulation does not depend on the send succeeding, preserving pre-existing behavior on a mid-turn socket close. Tightening it is a separate change with its own test implications.
10. **Sentence segmentation is regex-based.** Abbreviations and decimals may split early. A wrong split costs an extra gate evaluation, not a wrong verdict, because evaluation is cumulative.
11. **No load or concurrency testing.** Gating adds a synchronous regex pass per sentence; cost at concurrency is unmeasured.

---

## 11. EXACT RECOMMENDED NEXT STEP

**Deploy `ebe0534` to Railway and confirm from the boot line that the running build is that commit.**

The privacy hardening is the reason. Until it is deployed, production continues writing verbatim member turns and full assistant replies to retained third-party logs, and that is the only place where Persona iO's claims and its behavior are in direct contradiction rather than merely ahead. Everything else in this run is inert until the running build changes.

Two things to do in the same session, both small:

1. Record the deployed commit hash and the boot line. That is the build identity the Module 4 submission depends on.
2. Ask Railway for the log retention window and the access list, and decide whether to purge. Do not browse historical logs to investigate; that widens the exposure being contained.

**Before enabling enforcement on real members**, build the good-reply corpus described in limitation 3 and measure the false-positive rate. The release seam is now in place and tested, but a gate that over-blocks ordinary supportive language would converge on blandness, and for Persona iO blandness and silence are themselves safety failures.

---

## APPENDIX: EVIDENCE FILES

| File | Contents |
|---|---|
| `evidence/capture-baseline.js` | Script that captured the pre-change failing fixtures |
| `evidence/baseline-before.txt` | Its output. The five original failing cases |
| `evidence/capture-after.js` | Same five fixtures, post-change |
| `evidence/after-fix.txt` | Its output. All five read FIXED |
| `evidence/npm-test-after.txt` | Full `npm test` output, 168 checks, exit 0 |
| `evidence/test-release-after.txt` | Release suite output including measured timings |
| `report.md` | The preceding analysis run that selected this work |

