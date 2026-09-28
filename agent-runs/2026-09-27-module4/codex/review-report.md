# Persona iO Module 4: independent implementation review

**Reviewer:** Codex  
**Date:** September 27, 2026, America/Phoenix  
**Repository:** `/Users/michaeldiener/Desktop/aline-backend`  
**Mode:** Review and local synthetic verification only. Repository code was not modified by the reviewer. This report is the requested export. Temporary review harnesses and test outputs were written under `/tmp`.

> **PROVISIONAL:** Independent implementation checks are complete, but the user requested assessment after Claude finishes its implementation report. Document-to-implementation reconciliation is pending.

## Decision

**Request changes before describing the complete protected-turn mission as achieved.**

The working tree now has a real, causally active withholding mechanism. Its selected abandonment checks can stop a violating sentence before text transmission and TTS submission, run one application-level regeneration, and deliver a predetermined fallback after two rejected candidates. Ordinary text no longer waits for ordinary TTS synthesis. Those are independently reproduced improvements, not merely imported modules.

However, the stronger mission remains incomplete:

1. Markdown transformation can turn approved raw text into TTS content that the same release policy rejects.
2. Referral-first replies can be rejected even though the complete reply satisfies the policy's stated same-reply presence requirement.
3. Audio continues after `audio_unavailable`, `response_complete`, and the return to `listening` because the drain timeout does not cancel or suppress queued work.
4. Crisis activation still depends on classification weight; classifier failure skips crisis evaluation.
5. Empty model output is reported as a successful completed turn with no useful result or deliberate fallback.
6. No application-level model or whole-turn deadline was established. Browser rendering, avatar degradation, and deployed build identity remain unverified.

Passing the supplied fixtures does not disconfirm these counterexamples. The final back-to-back repository command completed with **52 unit + 70 runtime + 46 release checks passing in each run**, with no remaining listeners on the inspected test ports. Its coverage does not establish the complete mission.

## 1. Requested source, actual scope, and evidence limits

The user requested review against:

`agent-runs/2026-09-27-module4/claude/implementation-report.md`

That path was absent at the initial inspection and at repeated inspections during verification. The initial command returned `No such file or directory`. The reviewer asked asynchronously whether the report was still being written or located elsewhere. No contents of that nonexistent file were inferred or attributed to it.

The available `claude/report.md` is a prior analysis report, explicitly labeled read-only analysis, not an implementation completion report. Its Appendix A acceptance tests and Appendix B mission order were inspected as a provisional comparison source. The prior Codex final contract in `codex/report.md`, particularly section 10.9, was also available. Differences between those contracts are stated below; neither is silently substituted for the missing requested document.

Files changed concurrently during the review. This was independently observed through new files, changed hashes, and expanded package scripts. The reviewer did not make those code changes. Core `server.js` and `services/release-policy.js` hashes remained the same through the recorded probes. Test and package files did change. Consequently, HEAD alone does not identify the reviewed implementation, and the observations must be read with their file hashes and test-run scope.

### What this review verifies

- Direct current code inspection and git state.
- Repository tests running against local synthetic model/TTS mocks.
- Independent fault probes executing the unmodified server source, with real local WebSocket transport and mocked providers.
- Selected counterexamples repeated through the real server child process and installed Anthropic SDK, redirected to a local mock server.
- Actual TTS request text and WebSocket frames in those tests.

### What it does not verify

- Production revision, Railway configuration values, live vendor behavior, production traffic, or historical logs.
- Browser rendering, actual spoken playback, Simli rendering, or member outcomes.
- Comprehensive crisis detection, clinical effectiveness, privacy compliance, or general safety.
- Missing implementation-report claims or owner approval of changes to mission scope.

All conversational test material used here was synthetic. No real member conversations or credential values are included.

## 2. Exact git and build identity

Initial state:

```text
branch: main
tracking display: main...origin/main [ahead 1]
HEAD: b27af9b8f378f4dc2846ca40be4c65faaf9b0416

 M server.js
 M test-runtime.js
?? agent-runs/
?? services/release-policy.js
```

Recent commits inspected:

```text
b27af9b Module 4 safety baseline: privacy-hardened logging, observe-only classifier, append-only crisis path
18878b2 fix readme link; fail fast on missing MODEL_NAME; log model on boot
f1782d7 docs: retitle architecture as target spec, scope README to deployed state
4472f92 Upgrade to Persona iO v3.3.0 with demo support
022bc4f Fix WebSocket audio chunk sending
```

The upstream display uses the locally recorded `origin/main`; no fetch was performed. It does not establish current remote state or deployment.

Recorded later state at 21:55:54 Phoenix:

```text
## main...origin/main [ahead 1]
 M package.json
 M server.js
 M test-runtime.js
?? agent-runs/
?? services/release-policy.js
?? test-release.js
```

At that snapshot the tracked diff was 207 insertions and 17 deletions across package/server/runtime-test files. Untracked release policy and release tests are not included in ordinary `git diff --stat` totals.

### SHA-256 manifest at 21:55:54

| File | SHA-256 |
|---|---|
| `server.js` | `226fdad1c1ec0f919591d10662266aa8fab796e7d8d40dbeb528b929754be902` |
| `services/release-policy.js` | `767972d7b0a15320dfb6429ceab76a71ea8467d05367d15c8f9162a76f2e39a8` |
| `services/invariant-gate.js` | `17d9c4e092fe111e47d5f58e4c5d162273744100ded314a791d5d3a9f8213603` |
| `services/crisis-override.js` | `59c292cb99ecd1db2935342facb9759554f76b203e551fada70dc8b94bd38999` |
| `services/classifier.js` | `af43cfdf41499fc268d15f0c52081004271961b9570f20ab154bad30e7e87a76` |
| `package.json` | `27c02d9f868d7bbbad5a76a655669582609fbeaaae8e57ded4a231648380d087` |
| `package-lock.json` | `080f8edc7a0059c50f12f68ba7106fdcc1876eee95963dd9a2fd0c58f2e241b1` |
| `test-mra.js` | `8f86a7dae574cac3d9ea818594a07e7ccd81cfd1e2ac23ff29c556100af37434` |
| `test-runtime.js` | `8584c2c67bd54e2df67e031982485b128af22b2b6d8cc89794bce28c2b9ffddd` |
| `test-release.js` | `f077f279f7d4484930ece9a91d96e5b29929ad8f0f59cf7a27b13d5c6a441327` |
| `railway.toml` | `a449200a217c74689efe905f25e98d9758a58b820c08e0d5efd60b86714242e7` |

`server.js` was the same hash in the in-memory, real-WebSocket, and SDK counterexample runs. The initial package hash was `29877e0928df44f613fd7dc3d53d6acc1027b19a2d71c4c4e667899db27703c0`, before release tests were added to `npm test`. Runtime-test hashes changed as its fixture and cleanup handling were edited externally.

**Conclusion:** this is a working-tree implementation on top of `b27af9b`, not a capability supplied by that commit alone. A clean checkout of the recorded HEAD cannot reproduce the untracked release mechanism. No production commit was independently identified.

### Concurrent change at 22:00 Phoenix

A later inspection found an additional modification to `services/invariant-gate.js`, SHA-256 `ecd22530b695035f133b0c0e75168abc23b2c38b1f99594a54272750cdcdf470`. The diff changes only `buildRegenerationConstraints` for abandonment so it permits human support while requiring presence. The active release path calls its own `buildReleaseConstraints`, not this helper; the three imported checkers did not change. This does not repair the reproduced release-path counterexamples. Comments in `release-policy.js:128-131` and the server that say the old helper still forbids support became stale after this concurrent edit.

The tracked diff then totaled 216 insertions and 18 deletions across four files. HEAD remained unchanged. The before-manifest above is preserved rather than rewritten as though all tests ran against a single frozen tree.

## 3. Test execution and repeatability ledger

Node version observed: **v22.23.1**.

| Run | Command/method | Result and interpretation |
|---|---|---|
| Initial sandbox attempt | `npm test` | Unit portion passed; socket listener failed with `EPERM`. Environmental permission failure, not a product assertion failure. |
| First socket-enabled attempt | `npm test` | 52 unit passes; runtime startup failed with `EADDRINUSE` on fixed port 4309. Another local listener existed. |
| Complete original command | `npm test` before release script inclusion | **52/52 unit and 70/70 runtime checks passed**, exit 0. |
| New release suite | `node test-release.js` | **46/46 checks passed**, exit 0. |
| Expanded command | `npm test` with all three scripts | **52 + 70 + 46 = 168 passes, 0 assertion failures**, exit 0. |
| Expanded repeat attempt after manifest | `npm test` | 52 unit passes; runtime aborted with `UNCAUGHT: listen EADDRINUSE ... 4309`. Did not complete that repeat. |
| Final isolated sequential repeat | `npm test && npm test` with separate output files | **168 passes, 0 failures in each run**, overall exit 0. Afterward, no listeners appeared on ports 4309-4326, 4409-4414, 49009, or 49110-49112. |
| Independent VM probes | Unmodified `server.js`, mocked transport/providers | 16 scenarios inspected. This was a diagnostic scenario run, not 16 passing acceptance tests. |
| Independent real-WebSocket probes, runs 1 and 2 | Unmodified server source, ephemeral loopback listener, mocked model/TTS | Both runs reproduced the release, ordering, blank-result, and late-audio counterexamples. No actual browser. |
| Real server + installed SDK counterexamples | Existing release-test helper loaded in memory, separate local ports | Markdown bypass, referral-order suppression, and mixed-content handling reproduced through actual SDK streaming. |
| Direct policy/crisis/wrapper probes | Actual modules; exception injected at checker boundary for wrapper test | Weight-dependent crisis result and raw/transformed policy mismatch reproduced; wrapper returned `approved:false`, `gateError:true` on a thrown checker. |

Representative complete test output:

```text
> node test-mra.js && node test-runtime.js && node test-release.js
RESULTS: 52 passed, 0 failed out of 52 tests
RUNTIME RESULTS: 70 passed, 0 failed out of 70 checks
RELEASE RESULTS: 46 passed, 0 failed out of 46 checks
```

These totals count assertions/checks, not 168 independent end-to-end member scenarios.

### Repeatability conclusion

The exact full-suite-twice/no-listeners criterion was **verified locally at the end of the review**: the final sequential command passed all 168 checks twice, exited 0, and left no matching listeners on the inspected test-port ranges. Earlier attempts encountered a competing fixed-port listener. Those failures establish a concurrency limitation, not a sequential-repeat failure. The reviewer waited for free ports and did not terminate another process.

Concurrent edits also prevent labeling all early suite executions as tests of the final manifest. The core counterexamples are better anchored: both key implementation hashes stayed stable and the independent probe outcomes repeated.

## 4. Major findings with C.R.I.T.

### F1. High: post-approval TTS transformation bypasses the selected policy

**Claim:** Content rejected by the release policy can reach TTS after a formatting transformation.

**Reason:** `server.js:1983` and `1997` evaluate raw generated text. `server.js:2221-2230` then removes markdown before synthesis. `services/release-policy.js:172-200` relies on lexical matching from the invariant module.

Synthetic counterexample, reproduced through the real server and installed SDK:

```text
Raw candidate:       I'm **not** qualified to help.
Raw policy verdict:  approved
TTS request text:    I'm not qualified to help.
TTS-text verdict:    rejected, EXIT
Model requests:     1
Turn completed:     yes
```

**Inference:** This disproves the broad claim that nothing rejected by the selected policy can be synthesized. It is a policy-consistency finding, not a clinical judgment that this particular sentence is harmful. Browser rendering may also remove formatting, but rendering was not observed.

**Test/recommendation:** Evaluate the relevant rendered/spoken representation before releasing it, or establish a tested normalization contract. Add the exact counterexample and formatting variations. Preserve candidate identity across transformations.

### F2. High: sentence-prefix gating suppresses some complete replies that satisfy crisis precedence

**Claim:** The runtime's approval unit conflicts with the policy's same-reply presence semantics.

**Reason:** `release-policy.js:179` exempts a referral when presence occurs in the candidate. `server.js:1979-1988` evaluates/rejects the first complete sentence before later presence can arrive. A rejected stream is aborted, so the later sentence never repairs that evaluation.

```text
Complete synthetic reply: Please call 988. I am here with you.
Whole-reply policy:      approved
Runtime first sentence:  rejected before later presence
Regenerated reply:       I am here.
Observed final text:     I am here.
Observed TTS:            I am here.
Model requests:          2
```

The reversed order, presence before referral, completed without regeneration. Both orders were tested through local WebSocket transport; referral-first suppression also reproduced through the installed SDK.

**Inference:** The implementation preserves some appropriate support, not support generally under its advertised same-reply rule. This is not merely a detector accuracy issue: the policy and the buffering strategy evaluate different objects.

**Test/recommendation:** Add referral-before-presence, presence-before-referral, quoted/negated presence, and mixed violation/support cases. Adopt the evaluation unit explicitly. Full-response buffering would avoid this particular early rejection; any smaller window needs demonstrated semantics. Do not invent a broad referral exemption.

### F3. High: completion does not terminate optional audio work

**Claim:** Audio can arrive after the server declares audio unavailable and the turn complete.

**Reason:** `server.js:1943-1946` creates a serial TTS promise chain. `2141-2145` races that chain against a timeout, but does not abort active synthesis, cancel pending tasks, or prevent later sends. `2260-2300` sends audio whenever the socket remains open, without a turn identity or completed-turn guard.

Independent real-WebSocket test: four short sentences, 20 ms synthetic TTS delay each, 5 ms drain setting. In both runs:

```text
response_text x4
audio_unavailable
response_complete
status: listening
audio x4
```

**Inference:** Approved text is independent of the ordinary TTS wait, which is an improvement. Terminal turn state is not independent of subsequent media side effects. On a live persistent socket, old audio can overlap a later turn; the cross-turn overlap is a risk inferred from missing turn isolation, not an observed browser playback result.

**Test/recommendation:** After the terminal media decision, cancel or suppress remaining work for that turn. Test a delayed TTS success after the deadline and a second turn starting before the old queue finishes. The acceptance criterion is zero old-turn audio after its permitted boundary, not merely a timely `response_complete` frame.

### F4. High: crisis processing remains weight-dependent and is skipped on classification failure

**Claim:** The new withholding policy is weight-independent, but the whole member-facing safety path is not.

**Reason:** `release-policy.js:172` accepts candidate text only and does not invoke weight-dependent `NEVER_FILLS` or `ALWAYS_CALIBRATES`. In contrast, `crisis-override.js:106-117` returns before crisis-language checks when weight is below 21. `server.js:2072` invokes crisis processing only when classification exists; the alternate branch logs that it was not evaluated.

Direct test using the same synthetic crisis-bearing input and response, changing only supplied weight:

```text
weight 3:  override false, no suffix
weight 21: override true, suffix present
```

Injected classifier failure in the real-WebSocket probe still released ordinary approved text and completed, with crisis telemetry stating that crisis was not evaluated.

**Inference:** “Weight does not influence the release-policy verdict” is supported. “Weight no longer influences safety behavior” is contradicted. The provisional Claude acceptance test requiring a documented degraded crisis evaluation is not met by simply logging its absence.

**Test/recommendation:** Define the degraded crisis rule with Mike and test it independently of the emotional-weight proxy. Do not claim reliable crisis detection from these fixtures. Do not silently change clinical policy in a wiring fix.

### F5. High: crisis audio bypasses the ordinary queue and its failure notification

**Claim:** Crisis audio can race ordinary audio, and a suffix-only TTS failure need not produce an `audio_unavailable` event.

**Reason:** `server.js:2100` directly awaits suffix synthesis while ordinary TTS continues in `ttsChain`. Its boolean updates `crisisAudioStreamed`, not `ttsFailed`. Only `ttsFailed` controls the client failure notification at `2150`.

Independent real-WebSocket requests with three ordinary sentences were ordered:

```text
ordinary sentence 1
crisis suffix
ordinary sentence 2
ordinary sentence 3
```

When the suffix request alone threw, text still contained the suffix, `crisisAudioStreamed` was false, and the client received `response_complete` without `audio_unavailable`. Delayed ordinary TTS also produced late audio after completion in crisis scenarios.

**Inference:** The crisis text path improves resource delivery for recognized cases. The audio ordering and notification contract remain incomplete. Packet arrival is not proof of what a browser played.

**Test/recommendation:** Put all audio for a turn under one ordering/cancellation/failure contract. Include suffix-only HTTP failure, stalled suffix, and ordinary/suffix completion reordering. Keep text independent.

### F6. Medium: empty generation is counted as successful useful completion

**Claim:** Empty model output produces no useful result or deliberate fallback but still emits success completion.

**Reason:** An empty stream never enters candidate evaluation or release. `releaseOutcome` remains `approved`; `server.js:2167-2175` emits complete/listening and success metadata.

Independent result:

```text
model requests: 1
response text: 0 characters
TTS requests: 0
events: thinking, response_complete, listening
release outcome: approved
```

**Inference:** This violates the proposed useful-result/fallback/explicit-failure contract for an ordinary non-crisis turn. It is not a rejected candidate leaking; it is an invalid-success state.

**Test/recommendation:** Treat empty/whitespace-only and incomplete generations explicitly. Add nonempty meaningful terminal-result validation or an approved fallback/error branch.

### F7. High for the complete mission: no application-level model/turn deadline is established

**Claim:** TTS timeout additions do not establish that every started turn terminates within an adopted bound.

**Reason:** `server.js:1802` constructs the model client without an application deadline; generation/stream iteration has no whole-turn deadline. The installed SDK defaults in `node_modules/@anthropic-ai/sdk/core.js:134` include a 600,000 ms timeout and two retries. `sendTextTracked` also has no explicit callback deadline.

A never-yielding synthetic model iterator left the probe at thinking with no terminal event during the observation window. This test establishes lack of a short application bound in that scenario, not literal infinite waiting by the real SDK.

**Inference:** Real SDK/network behavior may eventually time out. That is not evidence of a deliberately chosen usable whole-turn bound. The gate is synchronous, so its exception wrapper does not establish protection against an event-loop-blocking computation either.

**Test/recommendation:** Adopt explicit model and whole-turn limits and late-result behavior. Test stalled headers, stalled stream after a prefix, interrupted generation, and delayed send completion. Separate bounded server failure from browser recovery proof.

### F8. Medium: single-release-point and text-only-fallback claims are broader than the implementation

**Claim:** Not every member-facing text frame runs through the new evaluator, and the fallback is synthesized.

**Reason:** Generated sentences are evaluated at `1983/1997`. The fixed fallback goes directly through `releaseSegment` at `2035`; that function enqueues TTS. The crisis suffix goes directly through `sendTextTracked` at `2090` and direct TTS at `2100`.

Two rejected candidates produced exactly the fixed fallback and a TTS request for that fallback. Fault injection replacing the crisis module's returned suffix with an EXIT phrase produced rejected combined text and TTS without another verdict.

**Inference:** The fault-injected suffix is not evidence that the current constant suffix is unsafe. Its current text passes the policy. A deliberately trusted, separately approved template path can be valid, but it must be documented as an exception and protected against changes. The broad “every frame is evaluated” comment is inaccurate. A text-delivered fallback exists; a text-only fallback does not.

**Test/recommendation:** Name trusted-template exceptions explicitly, centralize their release accounting, and test them. Decide whether “text-only” means no audio attempt or merely text surviving audio failure; do not use the terms interchangeably.

### F9. Medium: regeneration is bounded at the application layer, not globally at two HTTP requests

**Claim:** Exactly one application-level regeneration was independently reproduced on rejection; this does not cap all vendor HTTP attempts at two.

**Reason:** `server.js:2007-2036` contains one conditional regeneration and no regeneration loop. Direct probes and SDK tests observed two model requests for successful original/retry exchanges and no third after two rejections. SDK retries remain configured by default.

On regeneration provider failure, the probe observed thinking followed by a generic error frame, not the fixed fallback or normal listening transition. A generic explicit error may be an allowed terminal failure under the broader contract, but browser handling was not observed.

**Inference:** The bounded-regeneration claim is supported when stated narrowly. Retry amplification under transient HTTP failures remains outside the two-successful-request fixture. Normal unblocked turns use zero regenerations.

**Test/recommendation:** Distinguish candidate attempts, SDK HTTP attempts, and member turns. Bound and measure each relevant quantity. Add original/retry transport failures and verify browser terminal behavior.

### F10. Medium: send-failure and advisory telemetry claims are unsupported

**Claim:** Some comments promise evidence that the actual code does not emit.

**Reason:** `releaseSendFailed` is assigned at `server.js:1956-1961` but not read into release telemetry or history behavior. Release text is accumulated and TTS enqueued even on a failed tracked send. The comment says the failure is recorded in telemetry. `release-policy.js:188-193` builds advisory violations, but the server does not log or otherwise consume them; “reported for telemetry” overstates current participation.

**Inference:** A successful server send still cannot prove browser receipt. These metadata gaps make diagnosis and truth claims weaker; they do not prove every successful connection loses content.

**Test/recommendation:** Inject send callback failure and inspect actual client outcome, next-turn history, and bounded metadata. Either implement the claimed telemetry or correct the comments. Avoid logging matched conversational fragments to solve this.

## 5. Positive findings and failed negative hypotheses

The review did not merely infer that the gate was unwired. That earlier problem has materially changed in this working tree.

- **Verified:** generated sentence-prefix verdicts execute before the tested text/TTS release. A plain EXIT fixture was withheld and replaced through regeneration.
- **Verified:** mixed support plus a later EXIT violation retained already-approved support while withholding the explicit EXIT sentence. Presence was not a blanket exemption for that fixture.
- **Verified:** the release function does not accept classification and calls only weight-independent checkers. Weight-dependent length/calibration rules were deliberately excluded.
- **Verified:** the exception wrapper returns a block on a thrown checker. Runtime injected gate-error results caused one retry and the fixed fallback, not unchecked model candidate release.
- **Verified:** two rejected candidates caused two application calls and the fixed fallback, with no application-level third attempt.
- **Verified:** approved ordinary text arrived before slow ordinary TTS completed. This is a real dependency improvement despite the late-audio defect.
- **Verified:** tested ordinary/model/TTS diagnostic sentinel cases passed in the repository runtime suite. This does not prove every Simli, Deepgram, WebSocket, or persona-query path is content-safe.
- **Verified:** package scripts eventually included the release suite. The earlier observation that `npm test` omitted it became stale during the review and is not the final package claim.

The mixed-content SDK probe produced `...988.I am staying.` with no inserted separating space between an approved prefix and a regenerated candidate. This is a smaller composition defect and evidence that regeneration continues after an already released prefix; it is not proof of a prohibited EXIT leaking.

## 6. Provisional acceptance matrix

The requested implementation report was unavailable during the recorded review. This matrix compares actual behavior with the accessible Claude analysis Appendix A and the prior Codex contract. It is not a claim to have read missing implementation assertions.

| Acceptance item | Assessment | Independent evidence / missing evidence |
|---|---|---|
| Rejected candidate withheld | PARTIAL | Plain fixture passes; markdown-to-TTS transformation fails. Previously approved prefixes remain released. |
| Appropriate human support survives | PARTIAL / COUNTEREXAMPLE | Presence-first passes; referral-first complete policy-approved reply loses resource through regeneration. Raw `enforceInvariants` still rejects suffix; new adapter, not raw gate, changes behavior. |
| Mixed support and violation | PASS for selected fixture | Explicit EXIT withheld; resource retained. No broad semantic guarantee. |
| Classifier failure | FAIL against degraded-crisis requirement | Ordinary approved text completes; crisis processing explicitly skipped. |
| Gate exception | PASS for tested exception contract | Wrapper blocks; injected runtime gate error reaches fallback. No gate computation deadline or browser proof. |
| Model failure/interruption | PARTIAL | Generic error frame exists; no model/whole-turn bound or observed browser reset. Empty output incorrectly completes successfully. |
| One regeneration / second rejection | PASS for application rejection count | Two requests on tested successful exchanges. Fallback also goes to TTS; transport retries are a separate count. |
| TTS stall | PARTIAL | Text and completion can precede synthesis; late audio escapes after terminal state. Suffix failure notification incomplete. |
| Avatar failure | UNKNOWN | No browser/Simli failure test was independently performed. |
| Browser-visible completion | UNKNOWN | Real Node WebSocket client is not browser rendering/playback. |
| Logging sentinels | PASS within tested routes | Existing suite passed; broad no-leak claim remains unsupported for untested/raw logging paths. |
| Repeat full suite twice with no listeners | PASS in final local run | `npm test && npm test`: 168/168 each; no remaining listeners on inspected test ports. Earlier concurrent runs collided. |
| Reviewed/submitted/deployed identity | FAIL for a committed artifact; production UNKNOWN | Dirty tree plus untracked required module/test. Boot version is not a revision hash. |
| 30-fixture routing contract | NOT ESTABLISHED | No independent complete corpus through runtime was shown; new gate has narrowed scope. |
| Good-reply corpus acceptance rate | NOT ESTABLISHED | No measured corpus budget; referral-order counterexample found. |
| Candidate transformation | FAIL | Actual TTS payload rejects under the same policy. |

### Mission differences requiring explicit disposition

The available Claude mission prescribed a fixed two-sentence lag, `enforceInvariants` on critical violations, one release point, a crisis-suffix exception, one regeneration, text-only fallback, and deployed revision evidence. The current implementation instead uses cumulative completed-sentence prefixes, a narrower `NEVER_ABANDONS` adapter, multiple trusted-template release routes, and a synthesized fallback. The earlier Codex recommendation preferred initial full-response buffering. These are different plans.

Avoid treating a justified design change as misconduct: removing weight-dependent enforcement is supported by the known proxy problem. However, the owner must explicitly accept the narrower scope and revised acceptance meaning. Tests should not silently redefine the promised outcome. Production/deployment remains unknown; this review grants no release permission. The requirement that a referral without a presence marker counts as abandonment is also an explicit policy choice in the adapter, not something a legacy unit test can authorize on Mike's behalf.

## 7. Why the passing tests miss the failures

- `test-release.js:355-372` waits only four seconds while its TTS mock delays six seconds, then terminates the child. It verifies early text/completion but ends before the delayed audio can expose the terminal-state defect.
- Its WebSocket handler retains JSON events and does not capture binary audio. It cannot assert no late audio from the observations it records.
- The support fixture puts presence before referral. It does not cover a later presence sentence, negation, quotation, or permission-changing formatting.
- The weight unit test calls the same single-argument release function twice. Source inspection and runtime low/high cases support the narrow result, but neither removes the weight condition from crisis handling.
- The gate-exception fixture is a unit-level conversion failure. That does not alone establish every runtime gate-failure branch; independent fault injection here supplied additional bounded evidence.
- The suite counts successful local model requests to prove one regeneration. It does not test SDK retry amplification.
- Existing history tests passed with their selected response/chunking timings. They do not prove send acknowledgment equals browser receipt or that audio ordering is generally correct.
- No actual UI source or browser test was used to prove recognition of the new `audio_unavailable` event.
- Unit tests still affirm the old raw gate's referral rejection. The new policy tests affirm an adapter exemption. That is not inherently contradictory when scoped, but calling the original gate repaired would be inaccurate.

## 8. Unsupported or overbroad claims to correct

| Claim | Defensible replacement |
|---|---|
| Every member-facing frame passes evaluation | Generated sentence prefixes do; fixed fallback and crisis suffix take separately trusted paths. |
| Nothing rejected can be synthesized | Plain tested EXIT candidates were withheld; markdown normalization currently defeats that guarantee. |
| Weight no longer influences enforcement/safety | The new candidate-withholding verdict ignores weight; crisis activation still requires high weight. |
| Crisis precedence is solved | Presence-first fixtures pass; referral-first semantics and classification failure remain unresolved. |
| The turn is fully bounded | Ordinary TTS drain is bounded; model/whole-turn timing and late work are not fully controlled. |
| Audio unavailable means no audio for this reply | Current code may send queued audio later. |
| Fallback is text-only | The fallback is delivered as text and also submitted for TTS. |
| Exactly two vendor calls maximum | One application-level regeneration; SDK retries may add HTTP attempts. |
| History equals what the member received | History accumulates attempted ordinary release and cannot establish client rendering; send failure is not reflected as promised. |
| Advisory findings are reported in telemetry | The adapter returns them; the server currently discards them. |
| 168 passing checks proves the mission | It proves those checks passed in the recorded local mock setup. Independent counterexamples remain. |
| Build `b27af9b` contains the release controller | The controller is an untracked/dirty working-tree addition on that commit. |
| Live/deployed output behavior was reviewed | No deployed revision or real browser was inspected. |

Remaining raw error/persona log sites and static health/boot responses were observed in code. They prevent a repository-wide privacy/health/build-provenance guarantee. No sensitive logs were read, and these observations do not establish historical exposure.

## 9. Recommendations in causal order

1. **Freeze and identify the review artifact.** Supply the requested implementation report and record exact code/test/configuration identity. Resolve the competing mission definitions explicitly. Do not describe HEAD as the dirty build.
2. **Close the representation gap.** Cover the exact text/spoken meaning after transformations with the release decision. Add the reproduced markdown counterexample before changing code.
3. **Resolve the approval-unit mismatch.** Test both referral/presence orders and choose buffering consistent with the adopted policy. Preserve support without creating a broad exemption.
4. **Make terminal media behavior true.** One ordered media lifecycle per turn, cancellation/suppression after terminal state, and suffix failure reflected in client state. Test delayed success beyond the deadline and a next turn.
5. **Define degraded crisis and invalid-result behavior.** Weight independence of one adapter must not obscure skipped crisis processing. Handle empty results and model stalls with explicit adopted bounds.
6. **Finish evidence continuity.** Preserve the successful final repeat evidence and reproduce it for the eventual committed build; observe an actual browser recognizing success/fallback/error/media-unavailable states; associate any deployment claim with its true revision.
7. **Keep the useful scope discipline.** Do not expand into memory, identity persistence, dashboards, or new personas to compensate for these failures. Preserve the working withholding and bounded-regeneration mechanisms while repairing their contracts.

The main effort remains the protected-turn slice. The evidence says that its core interception mechanism exists now, but the representation, temporal, and crisis-policy boundaries still need work.

## 10. Commands, artifacts, and reproduction

Read-only repository commands included:

```text
git status --short --branch
git rev-parse HEAD
git log -5 --oneline
git diff --stat
git diff -- server.js services/release-policy.js
git diff -- test-runtime.js
cat package.json
cat railway.toml
rg / sed / nl targeted source inspection
SHA-256 reads of implementation and test files
lsof -nP -iTCP:4309 -sTCP:LISTEN
```

Executed tests were the commands in section 3. Sandbox listener denial required socket-enabled execution. All model and TTS interactions in tests were synthetic/local mocks; no production provider call was part of this review.

Temporary evidence locations, useful in this workspace but not required to understand this report:

```text
/tmp/personaio-codex-review-npm-test-1.log
/tmp/personaio-codex-review-npm-test-2.log
/tmp/personaio-codex-review-npm-test-3.log
/tmp/personaio-codex-review-npm-test-4.log
/tmp/personaio-codex-review-release-tests-1.log
/tmp/personaio-codex-review-probes.cjs
/tmp/personaio-codex-review-probes-1.jsonl
/tmp/personaio-codex-review-websocket-probes.cjs
/tmp/personaio-codex-review-websocket-probes-1.jsonl
/tmp/personaio-codex-review-websocket-probes-2.jsonl
/tmp/personaio-codex-review-sdk-probes.cjs
/tmp/personaio-codex-review-sdk-probes.jsonl
/tmp/personaio-codex-review-manifest-before.json
/tmp/personaio-codex-review-manifest-final.json
/tmp/personaio-codex-review-final-repeat-a.log
/tmp/personaio-codex-review-final-repeat-b.log
```

### Compact independent scenario results

| Scenario | Model calls | Observable result, repeated where stated |
|---|---:|---|
| Plain EXIT then clean candidate | 2 | EXIT absent, clean text/TTS, completion. |
| Two EXIT candidates | 2 | Fixed fallback text and TTS, completion. |
| Referral then presence | 2 | Resource lost to clean regeneration despite whole-candidate approval. |
| Presence then referral | 1 | Complete support text preserved. |
| Support plus explicit later EXIT | 2 | Support retained; EXIT withheld; regeneration appended without separating whitespace in the fixture. |
| Markdown EXIT | 1 | Raw approved, transformed TTS rejected by same policy, completion. |
| Four delayed TTS segments | 1 | Text/terminal precede four later audio frames, in both real-WebSocket runs. |
| Suffix-only TTS failure | 1 | Crisis text present, suffix audio false, no `audio_unavailable`, completion. |
| Delayed crisis/ordinary audio | 1 | Suffix request races ordinary queue; late audio possible. |
| Classifier exception | 1 | Approved text completes, crisis not evaluated. |
| Injected gate-error verdict | 2 | Fixed fallback, no candidate release. |
| Empty model output | 1 | Zero text, success completion. |
| Regeneration provider error | 2 | Generic error, no normal completion/listening in observed turn. |
| Stalled model iterator | 1 | Only thinking during probe window; no configured whole-turn timeout. |
| Injected invalid crisis suffix | 1 | Combined policy-rejected content released; diagnostic proof of bypass, not current constant behavior. |

The TTS policy results for individual referral-only chunks are not treated as separate violations when prior delivered presence supplies cumulative context. The markdown counterexample is different: its entire transformed single candidate fails the same policy.

## 11. Completion boundary

This is a review result, not a release approval. No implementation changes were made by Codex. Required fixes are recommendations only. The requested implementation-report comparison remains limited by that document's absence during the recorded review; a later-supplied document or changed source requires a scoped follow-up rather than retroactive claims.

The defensible current statement is: **the reviewed working tree withholds selected violating sentence prefixes and bounds application regeneration in local tests, but does not yet satisfy the complete protected-turn acceptance contract.**


## Appendix A. Reproducible SDK counterexample driver

The following is the executed review driver. It loads the existing test helper in memory, changes only its local test ports, and exports the helper instead of running its original main function. It does not rewrite repository files. Run from the repository root with local socket permission after confirming the selected ports are free. Providers are the helper's local synthetic mocks. The real server and installed SDK still process each turn.

```javascript
const fs=require('fs'),path=require('path'),Module=require('module'),crypto=require('crypto');
const root=process.cwd(),file=path.join(root,'test-release.js');
let source=fs.readFileSync(file,'utf8');
source=source.replace('const MOCK_PORT = 4409','const MOCK_PORT = 49009').replace('let nextPort = 4410','let nextPort = 49110');
source=source.replace(/main\(\)\.catch\([\s\S]*$/, 'module.exports = { runSession };');
const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(root);m._compile(source,file);
(async()=>{
 console.log(JSON.stringify({serverSha256:crypto.createHash('sha256').update(fs.readFileSync('server.js')).digest('hex')}));
 for(const [name,replies] of [
  ['markdown_tts_bypass',["I'm **not** qualified to help."]],
  ['support_after_referral',['Please call 988. I am here with you.','I am here.']],
  ['mixed_support_exit',["I am here. Please call 988. I can't help you with this.",'I am staying.']]
 ]){
  const r=await m.exports.runSession({turns:[{userText:'hello',replies}],waitMs:700});
  const t=r.observed[0];console.log(JSON.stringify({name,text:t.emitted,tts:t.tts.map(x=>x.text),calls:t.anthropicCalls,complete:t.completeAt!==null}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
```

The independent late-audio probe used four sentences, a 20 ms mocked synthesis delay per request, and `TTS_DRAIN_TIMEOUT_MS=5`. It retained binary WebSocket frames for 120 ms, including frames after completion. Both runs received four audio frames after the terminal event. Unlike the repository stall test, it observed beyond the delayed provider success. These small settings test ordering; they do not estimate real provider latency.


## Appendix B. Final review cutoff and identity

Final source/status inspection: **2026-09-27T22:03:49.025346 Phoenix**. The requested implementation report was still absent. HEAD remained `b27af9b8f378f4dc2846ca40be4c65faaf9b0416`. Core server/release-policy hashes remained unchanged throughout the counterexample probes and final repeat. The old gate regeneration-helper change was already present before the final sequential command. No further changes to the recorded files appeared at final inspection.

```text
## main...origin/main [ahead 1]
 M package.json
 M server.js
 M services/invariant-gate.js
 M test-runtime.js
?? agent-runs/
?? services/release-policy.js
?? test-release.js
```

The final manifest is the section 2 table with `services/invariant-gate.js` replaced by `ecd22530b695035f133b0c0e75168abc23b2c38b1f99594a54272750cdcdf470`. All other hashes match the 21:55:54 manifest. The earlier whole-suite successes and the final repeat are separately recorded rather than retrospectively treated as one frozen test run.

Final repeated results:

```text
Run A: 52 unit passed, 70 runtime passed, 46 release passed, 0 failed
Run B: 52 unit passed, 70 runtime passed, 46 release passed, 0 failed
Combined command exit: 0
Post-run inspected test-port listeners: none
```

**Final disposition: request changes to the protected-turn implementation; passing local fixtures and successful repeatability do not resolve the reproduced release, crisis-ordering, and late-audio defects.**
