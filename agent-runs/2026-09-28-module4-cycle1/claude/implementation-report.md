# Persona iO — Cycle 1: Representation Consistency

**Mission:** Make Persona iO evaluate the actual spoken representation before that representation can be submitted to TTS.
**Agent:** Claude (Opus 5, 1M context), Claude Code
**Date:** 2026-09-28
**Outcome:** Objective met, committed. **Not deployed.**
**Scope:** Cycle 1 only. Cycles 2 through 5 were not addressed.

**No secrets.** Environment variables appear by name only; no key, token, or credential value was read or recorded. All conversational content is synthetic fixture text. No real member conversation was used. No production log was inspected.

---

## 1. STARTING REVISION AND TREE STATE

Recorded at the start of this run, treating the checked-out repository as authoritative:

```
git rev-parse HEAD      b519f9221173428302d081a6b36b27aec9e4b002
git branch --show-current   main
git status --short          (empty — clean tree)
git log -5 --oneline
  b519f92 Add independent Module 4 implementation review
  173c51d Add Module 4 implementation report
  ebe0534 test-release: always print TTS-stall timings as diagnostic evidence
  7425a6f Release control: withhold a member turn before irreversible release
  b27af9b Module 4 safety baseline: privacy-hardened logging, observe-only ...
```

`b519f92` is one commit beyond the implementation revision discussed in earlier analyses; it adds a review document and no code. Node v22.23.1, npm 10.9.8.

---

## 2. INSPECTED TRANSFORMATION PATH

Traced by reading the current file, not by trusting earlier line numbers.

```
model delta  (Anthropic stream)
  → buffer                              server.js  streamWithGate
  → takeCompleteSentences(buffer)       release-policy.js
  → evaluateReleaseSafe(releasedText + sentence)     <-- judged the RAW form
  → releaseSegment(sentence)
       → sendTextTracked({response_text, text: sentence})   DISPLAY = raw
       → enqueueTTS(segment)
            → segment.trim()                                transform 1
            → sendToElevenLabs(text)
                 → 11 markdown regexes + .trim()            transform 2  <-- UNEVALUATED
                 → fetch body { text }                      SPOKEN = normalized
```

**Mismatch point.** Transforms 1 and 2 ran *after* the release verdict, inside `sendToElevenLabs`. The gate never saw the normalized string. The object judged for release and the object committed to the vendor were different objects.

Other transformations between approval and TTS: none besides those two. The crisis suffix takes a separate direct call to `sendToElevenLabs`; it is a constant with no markdown, so it is unaffected. Noted in limitations.

---

## 3. FAILING TEST BEFORE IMPLEMENTATION

Test added **before** any runtime change, named for the contract it protects:

`R10: TTS REPRESENTATION MUST BE APPROVED BEFORE SYNTHESIS`

It drives the real server through the existing harness, captures the vendor payload at the patched `fetch`, and asserts the invariant that **every captured TTS request body must itself pass `evaluateRelease()`**. This is observed at the vendor boundary, not read from a server-side variable.

**Command**

```
node test-release.js
```

**Expected:** no unapproved string reaches the vendor.
**Actual (pre-fix):** exit 1, four checks failed.

```
═══ R10: TTS REPRESENTATION MUST BE APPROVED BEFORE SYNTHESIS ═══
  ✗ every TTS payload passes the release policy it was judged under
    → unapproved payloads: ["I'm not qualified to help."]
  ✗ markdown-normalized prohibited phrase never reaches TTS
    → ["Brontide.","I'm not qualified to help."]
  ✗ masked variant is not synthesized in any form
    → ["Brontide.","I'm not qualified to help."]
  ✗ masked variant is not displayed to the member
    → "Brontide. I'm **not** qualified to help."

RELEASE RESULTS: 52 passed, 4 failed out of 56 checks
```

The failure is genuine. No expected value was weakened to manufacture it. Full output: `evidence/01-regression-BEFORE-fix.txt`.

The positive control R11 already passed before the fix, which matters: it proves the later fix did not buy correctness by breaking formatting.

---

## 4. EXACT ROOT CAUSE

`sendToElevenLabs` performed first-time markdown normalization on text that had already been authorized for release. Emphasis inside a prohibited phrase prevented the abandonment pattern from matching the raw form, and normalization then re-formed the phrase:

| Representation | String | `/i('m\| am) not (qualified\|equipped\|able\|the right\|a substitute)/i` | Verdict |
|---|---|---|---|
| Raw (judged) | `I'm **not** qualified to help.` | no contiguous match | **APPROVED** |
| Spoken (sent) | `I'm not qualified to help.` | matches `I'm not qualified` | **REJECTED** |

The defect is structural rather than a bad pattern: **any** transform applied after the verdict can change the verdict, and normalization was the one that existed.

---

## 5. FILES CHANGED

Commit `7c76be9`. Three files, 222 insertions, 26 deletions.

| File | Change |
|---|---|
| `services/release-policy.js` | `normalizeForSpeech()` added and exported. +42 |
| `server.js` | `authorizeSegment()`, `spokenSoFar`, `releaseSegment` carries the approved spoken string, `sendToElevenLabs` no longer normalizes first. +91/−26 |
| `test-release.js` | A10, R10, R11 and the byte-equality assertion. +115 |

No other file was touched. No dependency added.

---

## 6. IMPLEMENTATION

**One shared normalization.** `normalizeForSpeech()` moved out of `sendToElevenLabs` and into `services/release-policy.js`, so the module that evaluates a string also defines the string being evaluated. There is no second copy that can drift. It is idempotent and total on `null`/`undefined`.

**Authorization covers both representations.**

```js
function authorizeSegment(segment) {
  const displayVerdict = evaluateReleaseSafe(releasedText + segment)
  if (!displayVerdict.approved) return { approved: false, verdict: displayVerdict, channel: 'display', spoken: '' }

  const spoken = normalizeForSpeech(segment)
  if (!spoken) return { approved: true, verdict: displayVerdict, channel: null, spoken: '' }

  const spokenCandidate = spokenSoFar ? `${spokenSoFar} ${spoken}` : spoken
  const spokenVerdict = evaluateReleaseSafe(spokenCandidate)
  if (!spokenVerdict.approved) return { approved: false, verdict: spokenVerdict, channel: 'spoken', spoken }

  return { approved: true, verdict: spokenVerdict, channel: null, spoken }
}
```

`releaseSegment(segment, spoken)` displays the raw segment, submits **that exact `spoken` string** to TTS, and appends it to `spokenSoFar` so later segments are judged against the spoken stream as it will be heard. Cumulative evaluation is preserved on both channels, which matters because presence detection is cumulative: a presence marker in an earlier sentence exempts a referral in a later one.

**Both representations must pass.** The display form is still judged, and now the spoken form is too. Blocking on either was the correct reading here: normalization *revealed* that the underlying proposition was prohibited, and the markdown was masking it. Releasing the text while muting the audio would have delivered the abandonment in writing plus an unexplained silence. It also means the gate is no longer defeatable by inserting emphasis, though that is a consequence rather than the goal.

**Display and speech may still differ.** The member sees the markdown; the vendor does not. Only the spoken side is constrained to equal what was authorized.

**The vendor boundary keeps a floor, not a transform.** `sendToElevenLabs` calls `normalizeForSpeech` once more. Because it is idempotent it cannot change approved bytes, and it prevents a future caller that forgets to normalize from handing raw markdown to the vendor. A comment states that it must never again become the place where normalization first happens.

---

## 7. NEW REGRESSION TEST

`R10 — TTS REPRESENTATION MUST BE APPROVED BEFORE SYNTHESIS` (5 checks). Runs the real server; asserts every captured vendor payload passes the policy, that the normalized prohibited phrase never reaches TTS in any form, that it is not displayed either, and that the turn still reaches an explicit terminal state.

`A10 — CANONICAL SPOKEN REPRESENTATION` (5 checks). Unit-level properties: normalization output, the raw/spoken disagreement that made the bug invisible, idempotency, totality on null and undefined.

---

## 8. POSITIVE FORMATTING TEST

`R11 — HARMLESS FORMATTING SURVIVES` (6 checks), using the synthetic reply
`Brontide. That sounds **really** heavy, and I am staying right here.`

Asserts no regeneration is triggered, the **display** frame keeps `**really**`, the **spoken** payload contains `really` with no `**`, every spoken payload is policy-approved, the substance survives, and:

```
✓ evaluatedSpokenText === ttsRequestText (byte-for-byte, per segment)
```

This last check compares the sequence of vendor payloads against `normalizeForSpeech()` of each display frame, so the invariant is asserted on observed bytes rather than inferred from code structure.

The defect was **not** fixed by banning Markdown or by stripping formatting from what the member sees.

---

## 9. COMPLETE TEST RESULTS

| Suite | Before this cycle | After |
|---|---|---|
| `test-mra.js` unit | 52 | 52 |
| `test-runtime.js` runtime | 70 | 70 |
| `test-release.js` release | 46 | **62** |
| **Total** | **168** | **184** |

The 16 new checks are A10 (5), R10 (5), R11 (6). **No existing test required modification.** All previously passing behavior stayed green.

---

## 10. REPEATABILITY

```
Run A: exit 0   52 / 70 / 62   all passed
Run B: exit 0   52 / 70 / 62   all passed
Listeners on test ports after Run B: none
```

Ports were confirmed clear before Run A and between runs. Evidence: `evidence/03-full-suite-runA.txt`, `evidence/04-full-suite-runB.txt`.

---

## 11. FINAL COMMIT HASH

```
before: b519f9221173428302d081a6b36b27aec9e4b002
after:  7c76be9503d872be57cdb91e5484179fdbd738e4
```

`7c76be9  Fix release policy consistency for TTS normalization`

Focused commit, Cycle 1 only. Not deployed.

---

## 12. C.R.I.T. CONCLUSION

**CLAIM.** In the local repository at commit `7c76be9`, the string the release policy authorizes for spoken release is the same string committed to the TTS request body, byte for byte, for every segment on the gated generation path.

**REASON.** `authorizeSegment` computes `normalizeForSpeech(segment)`, evaluates exactly that value, and returns it; `releaseSegment` passes exactly that returned value to `enqueueTTS`, which passes it unchanged to `sendToElevenLabs`, whose only remaining transform is an idempotent re-application that provably cannot alter those bytes. Executed evidence: R10 asserts every payload captured at the patched `fetch` passes the policy, and R11 asserts `expectedSpoken === ttsTexts` byte-for-byte per segment. The same tests fail on the pre-fix code, which is recorded in `evidence/01-regression-BEFORE-fix.txt`. 184 checks pass twice consecutively.

**INFERENCE.** This fixes the representation gap on the gated generation path: a transform applied after the verdict can no longer change the verdict for that path, and emphasis can no longer mask a prohibited phrase from the gate.

It explicitly does **not** fix: the crisis suffix, which takes a separate direct call to `sendToElevenLabs` and is exempt by crisis precedence rather than evaluated in its spoken form; any non-markdown divergence between what a vendor receives and what was judged, such as SSML, provider-side text handling, or pronunciation substitution; whether the vendor speaks the bytes it was sent; and everything in Cycles 2 through 5. It also does not establish anything about production or about a browser.

**TEST — the strongest remaining adversarial falsifier.** Construct a segment whose prohibited phrase is formed only by the *join* between segments after normalization, so that neither `normalizeForSpeech(segmentN)` alone nor the raw cumulative text matches, but `spokenSoFar + ' ' + spoken` does. The current code evaluates that join, so it should hold; the sharper variant is a phrase split across a sentence boundary such that `takeCompleteSentences` emits the halves separately and the single inserted space changes what matches. Adjacent to it: markdown spanning a sentence boundary, where `normalizeForSpeech` is applied per segment and the concatenation of normalized segments differs from normalizing the concatenation. Either would falsify the guarantee at the seam between segments rather than within one.

---

## 13. KNOWN LIMITATIONS

1. **Not deployed.** Everything here describes commit `7c76be9` in a local repository.
2. **Crisis suffix path unchanged.** `sendToElevenLabs(crisisResult.crisisSuffix, voiceId)` is still a direct call. The suffix is a constant with no markdown, so its spoken and raw forms are identical today, but it is not routed through `authorizeSegment`. Pre-existing; out of Cycle 1 scope.
3. **Per-segment normalization.** The spoken stream is the concatenation of independently normalized segments. Markdown spanning a sentence boundary would normalize differently than the whole string would. Named above as the strongest falsifier.
4. **Join whitespace is assumed.** `spokenSoFar` joins segments with a single space. If the vendor's own prosody differs, the evaluated spoken stream is an approximation of the heard stream at segment boundaries.
5. **Normalization is regex-based** and covers the markdown subset the original code covered. Any syntax outside that set passes through to the vendor unchanged, and is therefore judged as-is rather than as it would be rendered.
6. **Blocking on the spoken channel blocks display too.** A segment whose spoken form is prohibited is withheld entirely and triggers regeneration. That is deliberate here, but it means markdown that merely *looks* like a masked phrase will cost a regeneration.
7. **No browser evidence.** There is still no runnable client in this repository, so display behavior is asserted on WebSocket frames, not on rendered output.
8. **No live model.** Every measurement used mocked model output.
9. **Pre-existing findings not touched this cycle:** four whole-object `console` calls at `server.js` 1746, 1755, 1832, 2237; `/simli-session` unauthenticated; the crisis suffix still gated behind `if (classification)`; no good-reply corpus measuring gate false positives.

---

## 14. CYCLE SCOPE CONFIRMATION

Cycles 2 through 5 were **not** addressed, and no opportunistic fixes were made.

| Cycle | Topic | Status |
|---|---|---|
| 2 | Referral-before-presence / future-context buffering | **Not addressed.** The cumulative evaluation order is unchanged |
| 3 | Late audio after terminal state | **Not addressed.** Drain and `audio_unavailable` behavior unchanged |
| 4 | Crisis activation depending on weight or classifier failure | **Not addressed.** `if (classification)` unchanged; crisis semantics untouched |
| 5 | Empty output, model stalls, whole-turn deadlines | **Not addressed.** No timeout or deadline logic changed |

No memory, Supabase, database, persona, prompt-engine, crisis-policy, unrelated-safety-rule, latency, deployment, production-log, or authentication work was performed.

---

## APPENDIX: EVIDENCE FILES

| File | Contents |
|---|---|
| `evidence/01-regression-BEFORE-fix.txt` | R10 failing against the unfixed implementation, exit 1, 52/56 |
| `evidence/02-regression-AFTER-fix.txt` | A10, R10, R11 passing, exit 0, 62/62 |
| `evidence/03-full-suite-runA.txt` | Full suite run A, 184 checks, exit 0 |
| `evidence/04-full-suite-runB.txt` | Full suite run B, 184 checks, exit 0 |
| `evidence/05-before-after-contract.txt` | Required before/after contract fields including the equality result |

