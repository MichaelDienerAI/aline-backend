# Persona iO — Module 4 Systems Priorities Run

**Engine:** C.R.I.T. Tier Engine v2, Systems Priorities
**Agent:** Claude (Opus 5, 1M context), Claude Code
**Run date:** 2026-09-27
**Evidence cutoff:** 2026-09-27, 18:32 Phoenix
**Repository inspected:** `/Users/michaeldiener/Desktop/aline-backend`
**Mode:** Read-only analysis. No code edited, nothing deployed, no infrastructure changed, no production logs read.
**Export contains no secrets.** Environment variables appear by name only. No key, token, or credential value appears anywhere in this document. No real member conversation content appears. All conversational examples are synthetic fixtures authored for `CRISIS_POLICY_SPEC.md` or probe strings written during this run.

---

## TABLE OF CONTENTS

1. Direct recommendation
2. Source and version ledger
3. Evidence base: commands and measurements
4. Findings, Questions 1 through 12
5. Contradictions and corrections
6. Unknowns
7. Final synthesis, items 1 to 22
8. Appendix A: acceptance tests
9. Appendix B: coding-agent mission order
10. Appendix C: evidence package for submission

---

## 1. DIRECT RECOMMENDATION

The privacy fix believed to be done is not committed, and therefore not deployed. Committed `HEAD 18878b2` logs the member's verbatim turn, the complete assistant reply, and the raw Anthropic error object, and that error object carries the full conversation history in the request body. The hardened version exists only as uncommitted working-tree changes, and the test that proves it works is untracked.

Mike's attention this period goes first to containment taking roughly half a work session, and then to one build outcome: a turn-time withhold primitive, deployed. The main effort's definition of done must include *deployed*, not *implemented*, because the project has already demonstrated that building safety work does not cause it to reach a member.

---

## 2. SOURCE AND VERSION LEDGER

### Evidence grades used

| Grade | Meaning |
|---|---|
| VERIFIED BY THIS RUN | Executed or read directly during this run, in the named environment |
| SOURCE ASSERTION | A supplied document states it; not independently re-executed here |
| REPORTED | A repository document states it; current code does not independently confirm |
| INFERENCE | Reasoned from evidence, extends beyond what was directly observed |
| PLANNED | Designed, not implemented |
| UNKNOWN | Available evidence cannot decide |
| CONTRADICTED | Current evidence directly conflicts with the claim |
| STALE | Was true; the implementation has moved past it |

### Versions

| Item | State |
|---|---|
| Branch | `main`, up to date with `origin` |
| Committed revision | `18878b2` "fix readme link; fail fast on missing MODEL_NAME; log model on boot" |
| Production revision | `18878b2` (SOURCE ASSERTION from the governing State of Persona iO report, corroborated by this run's direct reading of `git show HEAD:server.js`) |
| Working tree | `18878b2` plus uncommitted modifications to `package.json`, `server.js`, `services/prompt-engine.js`, `test-mra.js`; untracked `CRISIS_POLICY_SPEC.md` and `test-runtime.js` |
| Working tree drift during run | None. `git status --short` identical at start and end |
| Local Railway link | Absent. No `.railway` directory. Railway CLI installed but not linked to this directory |
| CI configuration | None found in repository |

### Sources actually available to this run

| Source | Availability |
|---|---|
| The State of Persona iO, 2026-09-27 18:32 Phoenix | Key content supplied inline in the prompt. Full document not supplied |
| Persona iO Systems Audit | Produced by this agent earlier in the same session, against the same tree |
| Direct code inspection | Full access, read-only |
| ASTRA Systems Audit | NOT SUPPLIED |
| CRCP 6399 Module 4 materials | NOT SUPPLIED |
| Colby / Danielle King feedback | Only the summary quoted inside the prompt |
| Week 2 Technical Specification | NOT SUPPLIED |
| Module 3 Figma / prototype artifacts | NOT SUPPLIED |
| Deformation Test Bank | NOT SUPPLIED |
| Frontend / browser client repository | NOT SUPPLIED and not present in this repository |

**Governing evidence limitation.** This run inspected a local repository. It did not inspect production, did not read production logs, and did not observe a browser. Where production behavior is described, the basis is the committed code plus the governing source's assertion, not observation.

---

## 3. EVIDENCE BASE: COMMANDS AND MEASUREMENTS

All commands read-only except one cleanup, noted.

```
git log --oneline -15
git status --short
git branch --show-current
cat railway.toml
cat package.json
wc -l server.js services/*.js
grep -n "require(" server.js
git show HEAD:server.js | grep -n "console\.\(log\|error\|warn\)"
find . -maxdepth 2 -type f -not -path "./node_modules/*" -not -path "./.git/*"
npm test
node -e "...checkNeverAbandons(CRISIS_SUFFIX)..."
node -e "...analyzeMessage(<probe strings>)..."
ls node_modules/{next,react,@supabase/ssr}
grep -c "rateLimit|maxConnections|Authorization|verifyClient" server.js
lsof -nP -iTCP -sTCP:LISTEN
```

**One non-read-only action.** A leaked `server.js` child process from an earlier test run, holding port 4310, was terminated to restore a clean measurement baseline. It was a test artifact, not a service.

### Key measurements

**M1. Committed build logs member content.** `git show HEAD:server.js`:

```
1801:  console.log(`[${personaId}] "${userText}"`)
1850:  console.log(`[${personaId}] Complete: "${fullResponse}"`)
1853:  console.error(`[${personaId}] Anthropic error:`, err)
```

Line 1801 writes the member's verbatim turn. Line 1850 writes the complete assistant reply. Line 1853 writes the raw Anthropic error object, which carries the request body, which is the full conversation history. VERIFIED BY THIS RUN.

**M2. Working tree replaces those with bounded metadata.** Working tree `server.js:1844` logs `userText.length` only. All turn-path logging emits structured metadata. VERIFIED BY THIS RUN.

**M3. The two safety modules conflict.** Executed directly:

```
SUFFIX: " I'm here with you. If you're in crisis, please reach out to 988."
checkNeverAbandons violations: 2
  severity=CRITICAL matched="please reach out to"
  severity=CRITICAL matched="988"
```

`services/invariant-gate.js:29-46` lists `/please (call|contact|reach out to|consider calling)/i` and `/\b(hotline|helpline|988|741741)\b/i` as abandonment patterns. `services/invariant-gate.js:313` sets `requiresRegeneration` on any CRITICAL. VERIFIED BY THIS RUN.

**M4. Weight is not severity.** Executed against the live classifier:

| Probe | Weight | Categories |
|---|---|---|
| `I want a sandwich.` | 21 | desire |
| `I am a teacher.` | 21 | identity, identity_fusion |
| `I think it will rain.` | 21 | belief |
| `I feel like pizza.` | 21 | belief |
| `She wants to die and I do too.` (synthetic fixture) | 3 | context |
| `If she leaves me, I will kill myself tonight.` (synthetic fixture) | 3 | context |

`classifier.js:263` assigns weight 21 whenever the psychology score exceeds 0.1. Psychology markers include `identity`, `fear`, `desire`, `trauma`, `shame`, `existential`, `crisis_phrase`, `belief`. The `desire` marker keys on the substring `i want`. VERIFIED BY THIS RUN.

**M5. Service reachability.** Fifteen JavaScript modules in `services/`. Two are imported by `server.js`. Two more are imported only by tests. Eleven are imported by nothing reachable.

| Module | server.js | tests | other service | Status |
|---|---|---|---|---|
| classifier | yes | yes | no | LIVE |
| crisis-override | yes | yes | no | LIVE |
| invariant-gate | no | yes | no | TEST ONLY |
| prompt-engine | no | yes | no | TEST ONLY |
| atelier | no | no | no | ORPHANED |
| atelier-broadcast | no | no | atelier | ORPHANED |
| supabase | no | no | atelier | ORPHANED |
| backchannel | no | no | no | ORPHANED |
| conductance | no | no | no | ORPHANED |
| drift-scanner | no | no | no | ORPHANED |
| latency-tracker | no | no | no | ORPHANED |
| profile-manager | no | no | no | ORPHANED |
| scaffold-selector | no | no | no | ORPHANED |
| sentiment | no | no | no | ORPHANED |
| session-boundary | no | no | no | ORPHANED |

VERIFIED BY THIS RUN.

**M6. The Next.js scaffold cannot compile.** `app/`, `lib/`, `middleware.ts`, `types/` import `next/navigation`, `next/server`, `react`, `@supabase/ssr`. None of those four appears in `package.json`. None is present in `node_modules`. VERIFIED BY THIS RUN.

**M7. Tests.** From a clean state, `npm test` runs `test-mra.js` and `test-runtime.js` and reports 52 of 52 and 70 of 70, 122 total. `test-runtime.js` is untracked. VERIFIED BY THIS RUN.

**M8. Test suite leaks child processes.** A leaked child from a prior run held port 4310 and caused a subsequent `npm test` to fail with `ECONNREFUSED`. After clearing it, 122 of 122 passed. Trigger condition UNKNOWN. VERIFIED BY THIS RUN by direct observation.

**M9. TTS is awaited inside the generation loop.** `server.js:1909-1912` awaits `sendToElevenLabs` inside the `for await` stream loop. While pending, the async iterator is suspended and no further `response_text` frames are sent. The fetch at `server.js:2084` carries no `AbortController` and no timeout. VERIFIED BY THIS RUN by code reading. Live stall behavior not observed.

**M10. Concurrent member messages are silently discarded.** `server.js:2170`, `if (!processingResponse) { ... }` with no `else`, then `return`. No error frame, no queue, no log line. VERIFIED BY THIS RUN.

**M11. No access control anywhere.** `grep -c` for `rateLimit`, `rate_limit`, `maxConnections`, `authorization`, `Authorization`, `verifyClient` across `server.js` returns 0. `/simli-session` at `server.js:1727-1753` accepts any HTTP verb, requires no credential, and returns Simli's entire response body verbatim. The Simli API key stays server-side at `server.js:1740`. VERIFIED BY THIS RUN.

**M12. Safety scope is monolingual, output is multilingual.** Deepgram is hardcoded to `language: 'en-US'` at `server.js:1800`. ElevenLabs uses `model_id: 'eleven_multilingual_v2'` at `server.js:2094`. All classifier markers and all `CRISIS_KEYWORDS` entries are English strings. VERIFIED BY THIS RUN.

**M13. The system prompt contradicts itself about memory.** `server.js:522` and `server.js:1316`, present in both personas: "You hold the formation that knows the user, not the transcript of prior sessions. When asked directly whether you remember, you say so honestly." `server.js:1270`, Chase's invariant: "Across sessions, you carry what the user brought without deploying it. Memory is calibration, not stockpile. You do not weaponize what you remember." VERIFIED BY THIS RUN.

**M14. The profile schema has no decrement.** `services/profile-manager.js` accumulates `session_count`, `total_turns`, weight and mode and category distributions, and `crisis_count`. All monotonic. No decrement, no reset, no deletion path. VERIFIED BY THIS RUN.

**M15. Log-privacy static guard has a bypass.** `test-runtime.js:461-467` asserts no `console.*` call references `err.name`, `err.code`, `err.message`, `statusText`, or `headers.get`. It does not catch passing a whole error object. Four call sites in the working tree do exactly that: `server.js:1746` (Simli response body), `1755`, `1832` (Deepgram, on the transcript path), `2237`. VERIFIED BY THIS RUN.

**M16. Documented setup is broken.** README instructs `cp .env.example .env`. No `.env.example` exists. VERIFIED BY THIS RUN.

---

## 4. FINDINGS BY QUESTION

### Q1 — INSIGHT SCAN

**S++: empty.** Nothing in this run founds a field.

#### S — ASSURANCE DRIFT

**CLAIM.** Persona iO's safety assurances have accumulated almost entirely on a build that has never run.

**REASON.** M1 and M2. The hardened logging, the crisis integration, the 122 checks, and the prior audit all describe the working tree. The deployed artifact is the committed tree, and the two differ in exactly the properties being assured. `test-runtime.js`, which contains the sentinel leak test, is untracked, so the test that proves no leak is in no repository and the code it proves clean is in no repository. Mechanism: safety work happens in the editor, gets validated locally, and stops before `git commit` because committing would also ship unrelated in-progress work.

**INFERENCE.** Established: committed and working code differ in logging behavior; the leak test is untracked. Extends beyond evidence: that Railway runs `main`. Competing explanation: Railway may deploy from a branch or a pinned commit, in which case production is older still, which makes the exposure worse, not better. There is no reading in which production is safer than HEAD.

**TEST.** `railway status` plus the boot log, which prints version and model at `server.js:2243-2245`. A live turn producing a log line with member words confirms directly.

**PRACTICAL USE.** Stop treating "the audit says logging is clean" as a statement about the product. It is a statement about the editor. Every future safety claim needs a build identity attached.

**LIMITATION.** Says nothing about whether the working-tree hardening is itself correct. It is.

#### A-tier

**A1. Weight is not severity, so it cannot route the release path.** M4. Any release path using W21 as a severity proxy is inverted for the cases that matter. Answers Open Question 19: yes, weight is still a severity proxy in the proposed path, and it must not be.

**A2. The two safety systems are semantically opposed.** M3. Settled decisions 9 and 11 colliding with an implementation that predates them.

**A3. Importing a module does not create authority over output.** The classifier is imported and called; it influences no prompt, ceiling, stream, or history. Member experience unchanged. Settled decision 14, with the repository's own history as the experiment. Predicts that wiring the gate the same way would also change nothing.

**A4. Crisis detection cannot see the failure it most needs to catch.** `crisisOverride` receives `userMessage` and `classification`, never model output. It can notice a member in crisis. It structurally cannot notice a confidante abandoning one.

#### B-tier

**B1. Speech is on the critical path for text, with no timeout.** M9. Answers Open Question 10: no, approved text delivery is not independent of TTS waits.

**B2. The privacy fix is written and unshipped.** M1, M2.

**B3. One defensive try/catch coupled crisis handling to classifier health.** `if (classification)` at `server.js:1942` means a classifier throw removes crisis evaluation for that turn. Nobody designed this dependency.

**B4. The test suite can fail its own next run.** M8.

#### C-tier

**C1.** Documentation drifts in the safe direction, understating what runs. The risk is a future engineer rebuilding what exists, not overclaiming to an investor.
**C2.** The orphaned services are the only written record of the behavioral thinking.
**C3.** `/simli-session` is unauthenticated and forwards the upstream body verbatim. M11.

**H tier: empty.**

#### Re-sort by the five criteria

| Finding | Exposure | Prereq value | Learning | Deliverable | Reversible | Rank |
|---|---|---|---|---|---|---|
| S / B2 uncommitted privacy fix | Highest, ongoing | Low | Medium | Yes, under 1 hr | Yes | 1 |
| B1 TTS blocks text | High, member-visible | High | High | Yes | Yes | 2 |
| A1 weight is not severity | None yet | Highest | Highest | Yes, as a decision | Yes | 3 |
| A2 crisis vs gate precedence | None while unwired | Highest | High | Yes, as a rule | Yes | 4 |
| B3 classifier coupling | Medium | Medium | Medium | Yes | Yes | 5 |
| A3 wiring is not enforcement | None | Governs main effort | High | Learned | n/a | 6 |
| B4 test suite leaks | Medium, erosive | Medium | Low | Yes | Yes | 7 |
| C3 simli endpoint | Medium, vendor cost | Low | Low | Yes | Yes | 8 |
| A4 crisis blind to output | Latent | High later | High | No | n/a | 9 |
| C1, C2 | Low | Low | Medium | Yes | Yes | 10 |

---

### Q2 — THE MINDS

Graded on the relevance and mechanism density of specific work, not reputation.

**S++: empty.**

#### S tier

**Nancy Leveson.** *Engineering a Safer World* (MIT Press, 2011); *Safeware* (1995); STPA Handbook (Leveson and Thomas, 2018, free PDF). Accidents in software-intensive systems are control problems, not component-failure problems. Borrow *Unsafe Control Actions*: a control action goes wrong by being provided when it should not be, not provided when it should be, provided too early or too late, or stopped too soon. Apply that grid to Persona iO's release action and the hazard list writes itself. Do not transfer "fail to a safe state," because Persona iO has no safe state; silence is abandonment under settled decisions 9 and 20. First move: draw Persona iO's control structure on one page.

**Pat Helland.** "Life Beyond Distributed Transactions" (CIDR, 2007); "Immutability Changes Everything" (CIDR and ACM Queue, 2015). Borrow the distinction between guessing and apologizing versus locking and committing. Persona iO's crisis suffix is an apology in Helland's precise sense, which produces three questions never asked: what is the apology rate, what damage occurs before the apology, and does the apology reach the member given that server-side send does not prove client render. Do not transfer the assumption that apologies are reversible; a spoken sentence is not a refunded charge, so the acceptable un-apologized rate is much lower. First move: classify every current safety behavior as lock or apology. HYPOTHESIS: all classify as apologies, and the main effort introduces the first lock.

#### A tier

**Michael Nygard,** *Release It!* (2007, 2nd ed. 2018). Timeouts on every integration point, circuit breakers, bulkheads. Directly fixes M9. Low intellectual rarity, very high operational value.

**David Woods with Nadine Sarter,** "Automation Surprises" (1997). Mode confusion. `processingResponse` is a hidden mode with no indicator, and the member's question when their message vanishes is the canonical "what is it doing now?" Do not transfer the assumption of a trained operator; the design burden is higher, not lower.

**Helen Nissenbaum,** *Privacy in Context* (2010). Contextual integrity: privacy is the match between information flow and the norms of the context. A member discloses under confidante norms; routing that to a vendor's retained stdout violates them even if nobody reads it. Gives precise language for the one place the narrative is contradicted. Normative, not an engineering control.

**Arvind Narayanan and Vitaly Shmatikov,** "Robust De-anonymization of Large Sparse Datasets" (IEEE S&P, 2008). Sparse behavioral data re-identifies after identifiers are removed. INFERENCE, not fact: not attempted against Persona iO's small schema. The transferable point is narrower: "patterns not content" in `profile-manager.js:5` is an architectural intention, not a privacy guarantee, and must not be described as one when memory work begins.

#### B tier

| Person | Work | Borrow | Do not transfer |
|---|---|---|---|
| Humble and Farley | *Continuous Delivery* (2010) | Build once, deploy that exact artifact; the pipeline as the only path to production | Full pipeline ceremony is heavy for one person |
| Charity Majors | *Observability Engineering* (2022) | Observability answers unanticipated questions; wide structured events | Full tracing is out of scope |
| Sacks, Schegloff, Jefferson | "A Simplest Systematics for the Organization of Turn-Taking" (*Language*, 1974) | Turn-taking is rule-governed; silence at a transition-relevance place carries meaning | Typed exchange with an AI is not spoken human conversation |
| Stivers et al. | "Universals and cultural variation in turn-taking" (*PNAS*, 2009) | Cross-linguistic response timing centers near 0 to 200 ms | Measures spoken human dialogue. Never convert to a Persona iO threshold |
| Tim Kelly | Goal Structuring Notation (York, 1998) | A safety case is a claim, an argument, and evidence, written down and attackable | GSN notation itself is overkill |
| Kent Beck | *Test-Driven Development by Example* (2002) | Write the failing test first; it is the strongest Module 4 artifact | Full TDD discipline not required |
| US Army | ADP 6-0, *Mission Command* | Commander's intent, end state, constraints; freedom in method | Military command relationships do not map to a solo founder with an agent |

#### C tier

Ben Shneiderman, *Human-Centered AI* (2022), for the high-automation-with-high-human-control frame on member-controlled memory. Clifford Nass and Byron Reeves, *The Media Equation* (1996), for why persona breaks carry real cost. Cynthia Dwork on differential privacy, relevant only once aggregate analytics exist.

---

### Q3 — THE SOURCES

#### Tier A: changes this week's build

| Source | Core mechanism | Application | First move | Limitation |
|---|---|---|---|---|
| STPA Handbook (Leveson and Thomas, 2018, free PDF) | Hazard analysis by enumerating unsafe control actions on a drawn control structure | Generates the release-boundary hazard list systematically | Draw the control structure; apply the four categories to the release action | Assumes a definable safe state |
| *Release It!*, Stability Patterns | Timeouts, circuit breakers, bulkheads | Fixes M9 | Add timeouts to the ElevenLabs and Simli fetches | Written for high-volume services |
| "Life Beyond Distributed Transactions" (Helland, 2007) | Guess and apologize versus lock and commit | Classifies every current safety behavior | Count the locks | Business apologies are reversible; speech is not |
| Broadcast profanity-delay practice | A fixed bounded delay buffer purchases veto authority at known cost | Suggests fixed-lag release instead of full buffering | Prototype a two-sentence lag and measure | The broadcast dump substitutes silence, which Persona iO may not |

#### Tier B: changes what Mike tests or claims

| Source | Core mechanism | Application | Limitation |
|---|---|---|---|
| *Continuous Delivery*, pipeline chapters | The tested artifact is the shipped artifact | Fixes assurance drift | Heavy for one person |
| *Site Reliability Engineering* (2016), release engineering and postmortem chapters | Hermetic builds; blameless postmortems | Deployment provenance; one postmortem on the logging exposure | Google-scale assumptions |
| Columbia-Suicide Severity Rating Scale (Posner et al.) | Separates ideation, intent, plan, behavior into ordered severity | The crisis spec is reinventing a crude version of a formalized distinction | Administered by trained humans in dialogue. It is not a text classifier and must not be described as validating one |
| 988 and SAMHSA safe-messaging guidance; Samaritans media guidelines | How to reference crisis resources without harm | Governs the wording and placement of `CRISIS_SUFFIX` | Written for media, not conversational agents |
| *Privacy in Context* | Privacy as appropriate information flow | Language for logging and for memory consent | Normative, not technical |
| GDPR Articles 15 and 17 | Access and erasure as defined operations | Specifies exactly the operations settled decision 7 requires | Compliance is not the goal; mechanism is |

#### Tier C: shapes the capstone, not the sprint

*Engineering a Safer World* full text; Sacks et al. 1974; Stivers et al. 2009; *Human-Centered AI*; Crisis Text Line's published triage work, noting their scale, consent model, and human-in-the-loop differ fundamentally.

**Deliberately excluded.** General LLM-safety and alignment literature. Persona iO's failures are control-structure, deployment, and integration failures, not model-behavior failures. Reading alignment work this term would feel productive and change nothing built.

---

### Q4 — ISOMORPHISMS

**1. Broadcast delay in live television. TIER A. Changes the main effort design.**
Shared constraint: irreversible transmission, plus real-time expectation, plus a required veto. Shared mechanism: a fixed-size delay buffer. Broadcast does not choose between live and reviewed; it runs live with a constant known lag, and the lag is the veto window. What transfers: a third option this run had not considered. Instead of streaming everything or buffering whole responses, stream with a fixed lag of N sentences. The delay becomes a chosen parameter, constant and predictable, rather than a per-turn discovered cost. What does not transfer: the broadcast dump substitutes silence; Persona iO must substitute different content, which costs a regeneration round trip broadcast never pays. Experiment unlocked: implement a two-sentence lag, measure the delta in time-to-first-text, and measure what fraction of gate checks can run on a two-sentence window. That answers Open Questions 20 and 21.

**2. Two-phase commit. TIER A.** Shared constraint: no un-send. Shared mechanism: prepare does all reversible work; commit does the irreversible part; nothing externally visible happens during prepare. Transfers the vocabulary, the discipline, and the rule that abort must be a defined action rather than an absence. Does not transfer: the member is not a participant and cannot vote. Experiment: name the seam `prepare` and `commit` in code, which makes the irreversible step visible to every future reader.

**3. Chain of custody. TIER A.** Shared constraint: quality cannot be inferred from inspection; provenance is a separate property. Shared mechanism: every handoff recorded; a missing link voids the chain regardless of the artifact's quality. Transfers as the exact correction for assurance drift: the 122 tests are inadmissible as evidence about production, not because they are weak but because the chain is broken. The remedy is not better tests. Experiment: every claim in the Module 4 submission carries a commit hash or is marked unproven.

**4. Medical triage, ESI and START. TIER B.** Shared mechanism: discriminators selected for predictive value against outcomes, with undertriage and overtriage measured as separate rates with separate budgets. Transfers two things Persona iO lacks: W21 is a convenience signal rather than a validated discriminator, and Persona iO has never separated its two error rates. Does not transfer: triage protocols are validated against decades of mortality data; 30 hand-written fixtures are not validation. Experiment: define undertriage and overtriage as named metrics with separate budgets before resolving crisis Decision A.

**5. Circuit breakers. TIER B.** A fault in one subsystem propagates upstream and disables a healthy one. M9 is a missing breaker. Does not transfer: electrical breakers can safely open the circuit; Persona iO cannot open the text circuit.

**6. Takeoff decision speed, V1. TIER B.** A defined, computed, briefed point after which continuing is the only option. Persona iO has an undeclared V1 at the first `ws.send`. Does not transfer: V1 is set by physics; Persona iO's commit point is a free design choice, which is better, not worse.

**7. Interlock design in safety-critical plant. TIER B.** Interlocks must be analyzed jointly before installation, because each is correct alone and the pair can defeat one another. Exactly the M3 conflict. Does not transfer: plant interlocks have a defined safe shutdown state.

**8. NON-ISOMORPHISM: client-side prediction and rollback in real-time games. TIER C, included because the mismatch is informative.** Apparent match: show output immediately, reconcile when the authoritative server disagrees. Where it breaks: rollback requires the displayed output be revocable. A game can rewind a character's position because players accept visual correction as normal. Persona iO cannot un-speak a sentence, and a member in distress does not accept retraction as normal. This is the strongest argument against the tempting "stream optimistically and correct" design that an experienced engineer would naturally propose.

---

### Q5 — HIDDEN SYSTEMS

| System | Visible surface | Hidden mechanism | Control point | Limitation |
|---|---|---|---|---|
| Deployment provenance | "We have tests" | No link between reviewed and running build; no CI, no `.railway`, no deploy record | Record the boot line; pin the deployed commit | Tells you today's build, not July's |
| Release authority | "The gate isn't wired" | Nothing can withhold. `ws.send` at `server.js:1907` is unconditional | One function through which text must pass | A seam with a permissive policy is still a seam with no policy |
| Logging | "A privacy task" | HEAD writes verbatim member text to retained vendor stdout | Ship the hardening; then determine retention and access | Does not retroactively remove historical text |
| Crisis precedence | "Two modules to connect" | Opposed rules; latent until either runs | Write the rule before writing gate code | A written rule is not an enforced one |
| Streaming | "It feels fast" | The irreversible commitment precedes any possible evaluation | Route at least one class of turn through a buffer | Buffering trades the property that makes the demo feel alive |
| Classifier dependency | "Defensive error handling" | `if (classification)` silently removes crisis evaluation on classifier failure | An explicit degraded rule at `server.js:1942` | Requires deciding the degraded semantics |
| Gate semantics | "Pass or fail" | CRITICAL sets `requiresRegeneration`; broad lexical rules flag ordinary supportive language | Two-sided measurement before enabling enforcement | Costs a second corpus to maintain |
| Regeneration | Not yet built | No retry bound and no timeout exists anywhere in the codebase to serve as precedent | Bound it in the spec before it is written | Prospective |
| TTS coupling | "Audio is slow sometimes" | Awaited inside the stream loop; no timeout; speech blocks text | Move synthesis off the text path; add a bounded timeout | Changes audio and text ordering, needing a client check |
| Browser observability | "It works on my machine" | Server-side send is not member-side render; no client telemetry; no client in repo | Observe one real session and record each failure class | Stays partly UNKNOWN without the frontend |
| Test-to-deployment continuity | "122 tests pass" | The leak test is untracked and runs only on one machine | `git add test-runtime.js`, then CI on push | CI proves the commit, not the deploy |
| Access control | "It's invite-only" | Zero auth, zero rate limit, zero connection cap; the demo flag is client-asserted | A door on the socket and on `/simli-session` | Does not address identity for memory |
| Memory prerequisites | "Memory is later" | The schema has already decided against deletion; all counters monotonic | Design delete before write | Does not address identity |

**One pattern connects most of them.** In each case the system's internal state and the member's experience diverge, and the system has no way to notice. The server believes a turn completed; the member saw nothing. The server believes no crisis occurred; the member wrote in Portuguese. Persona iO currently has no feedback path from the member's actual experience back into the system. Every signal it has is a signal about itself.

---

### Q6 — THE THROUGHLINE

Five candidates tested. Four covered part of the project. One survived.

| Candidate | Explains | Fails to explain | Tier |
|---|---|---|---|
| Control over irreversible commitments | Every engineering failure in the audit | Five confidantes, character quality, structural isolation, membership | A |
| Intimacy requires selective retention and selective release | Privacy, memory, deletion, crisis release, the confidante concept, discretion | TTS coupling, deployment, the scaffold, testing | A |
| Turning subjective judgment into executable constraints | Gate, crisis spec, classifier, Deformation Test Bank | Privacy, deployment, latency, membership, memory | C |
| Continuity under uncertainty | Persona persistence, memory, relational continuity, refusal to abandon | Every privacy and deployment finding; sits awkwardly against settled decision 8 | C |
| **Subtractive promises on an additive architecture** | See below | Why five confidantes; why the characters are written as they are | **S** |

#### The surviving throughline

> **Persona iO makes subtractive promises on an additive architecture.**

Read the promises: never abandons means will not leave; discretion means will not disclose; health over engagement means will not optimize for retention; user-controlled memory means will not keep what you delete; nothing unshipped called live means will not overclaim; the gate means will not say the wrong thing; privacy means will not log.

Read the mechanisms: logging appends to stdout; text output appends to the socket and cannot be recalled; audio appends; crisis handling appends a suffix by string concatenation; history uses `conversationHistory.push`; `profile-manager.js` increments counters with no decrement; deployment has no rollback.

**This explains which work shipped and which stalled, which no other candidate does.** Sort the service modules by whether they add or withhold. The appender, `crisis-override.js`, is wired. The observer, `classifier.js`, is wired. Every withholder is not: invariant-gate, session-boundary, drift-scanner, and the entire authentication layer, which cannot compile. The only safety module in production is the only one that adds. Adding is cheap and composable. Withholding requires a decision point, a state to hold in, and an authority to decide.

**Counter-evidence and the refinement it forces.** Two withholders did ship. `?demo=1` withholds the web search tool at `server.js:1892`. The `MODEL_NAME` check withholds startup at `server.js:165`. Both are configuration-time decisions made before a turn begins on static inputs. Neither withholds anything mid-turn. So:

> **Persona iO can withhold at configuration time and cannot withhold at turn time. Every unfulfilled promise requires turn-time withholding.**

**Mechanism.** A configuration-time withhold needs a branch. A turn-time withhold needs a buffer, an evaluator, a verdict, a fallback, and a bounded failure path. The first is one line; the second is an architecture. Work flowed to the cheap shape.

**Predictions.** Memory work will stall at deletion, not storage. Any safety feature shaped as an append ships quickly; any shaped as a withhold stalls regardless of importance. The gate stays unwired until a buffer exists, no matter how much gate logic is written. Documentation keeps drifting toward the target state, because describing a capability is also additive. **The fourth prediction is already confirmed three times**: in the README, in the tests, and in the system prompt at `server.js:1270`.

**Falsified by.** A turn-time withholding mechanism that shipped easily, or an additive feature that stalled for reasons unrelated to its shape. Neither exists in the evidence.

**How it changes the build.** The main effort is not adding a gate. It is giving Persona iO its first turn-time withhold primitive. Once that exists, the gate, regeneration, bounded failure, memory deletion, and consent all become instances of a capability the system has rather than architectures invented from nothing each time.

**Limitation.** Does not explain why there are five confidantes, why the characters are written as they are, or why structural isolation is the founding problem. RECOMMENDATION: use this for the technical narrative and "intimacy requires selective retention and selective release" for the product narrative. The seam between them is real and should not be forced.

---

### Q7 — HIDDEN WISDOM

| Angle | Hidden wisdom | Why missed | First move | Time to evidence | Tier |
|---|---|---|---|---|---|
| Evidence quality | The strongest artifact Mike owns is a failing test, not a working feature. A conflict between two of his own safety mechanisms, found by executing them against each other, demonstrates a working method, which is harder to fake than a feature | The instinct in a capstone is to demo success | Capture M3's output before any fix; present it first | Already produced | A |
| Market position | Not having memory is currently a stronger claim than having it. "We do not retain your conversations, and we will not until you can inspect and delete them" is coherent, verifiable, and unusual | Memory reads as the flagship feature, so its absence reads as incompleteness | Lead with the retention position in prospect conversations | One conversation | A |
| Knowledge preservation | `server.js` contains a written incident history that exists nowhere else, stored in the most fragile possible place | Comments feel like documentation, so they feel already safe | Copy the three comment blocks into `DECISIONS.md` | 15 minutes | B |
| Test leverage | The 30 crisis fixtures are a general-purpose hard-case corpus, not a crisis-only asset | They were written for one decision, so they are filed under it | Run all 30 through any proposed router | Under an hour per reuse | B |
| Founder efficiency | Judgment is the scarce resource and the acceptance test is where judgment lives. Implementation is delegable; the acceptance test is not | Agent-assisted development invites specifying implementations, because that is the visible part | Write the acceptance test before any implementation instruction | Immediate | B |
| Cheapest visible win | One boolean, `processingResponse`, is the highest ratio of demo impact to effort in the system | It looks trivial next to architecture work | Queue or reject with a visible frame | Under an hour | C |

**Critical caveat on the market-position item.** It holds only while the logging exposure is closed. Making this claim before shipping the logging commit would be false. The claim and containment item 3 are the same item.

**Re-sorted by horizon.** This week: capture the failing test; fix the boolean; write acceptance tests before implementation; copy the comment blocks. This month: reuse the fixtures against router, gate false-positive rate, and the non-English path; adopt the retention position after the logging commit ships. Rest of capstone: institutionalize the build-identity rule; treat the turn-time withhold primitive as the organizing capability with memory deletion as its second instance.

---

### Q8 — THE FOOL'S PROBE

The probe produced an unusual result: six of ten supplied absurd scenarios sit at or near zero distance from the current system.

| # | Scenario | Distance |
|---|---|---|
| 1 | Fast answers, conversations sent to strangers | Small. Verbatim text to a retained third-party store with unknown access list |
| 2 | Gate approves one second after she finished speaking | **Zero.** This is the current crisis path |
| 3 | Perfect memory, cannot identify the member | Large today; zero the moment storage ships before identity |
| 4 | Avatar survives, text disappears | Small and inverted. Speech can freeze text |
| 5 | Every message scores maximum weight | Small, and the real version is worse |
| 6 | Gate failure causes infinite regeneration | Large today. Prospective |
| 7 | Every internal metric passes, browser shows nothing | Small. Cannot currently be ruled out |
| 8 | Five confidantes on one unauthenticated socket | **Zero, except the count** |
| 9 | Never harmful because it never speaks | Large today; near the gate's natural attractor |
| 10 | Raw text deleted, derived profiles retain the influence | **Zero in architecture** |

**Scenario 2, TIER A.** A verdict has authority only if it can precede the irreversible commitment. `crisisOverride` runs at `server.js:1942`, after the stream loop and the final TTS flush. The scenario describes the shipped design with one component renamed. **Design rule: a verdict that cannot precede the commit is telemetry. Label it telemetry, never a gate.** RECOMMENDATION: use this sentence verbatim in the Module 4 live session; it explains the binding constraint in ten seconds.

**Scenario 5, TIER A.** Uniform maximum weight would be honest noise, self-announcing and unusable. The real distribution is non-uniform and anti-correlated with severity on exactly the cases that matter, which is worse, because it looks like a signal and invites reliance. **Design rule: before a signal routes anything, measure its distribution on the cases you care about and on ordinary cases. A signal that fires on both is not a signal.**

**Scenario 4, TIER A.** Layers must fail in reverse order of information value. Today the dependency runs text to audio to avatar, backwards from information value. **Design rule: text completes with ElevenLabs stalled for 30 seconds.**

**Scenario 7, TIER A.** A system that observes only itself is structurally blind in exactly one direction, the direction the member lives in. 122 tests, all server-side; `sendTextTracked` explicitly disclaims client render; no client telemetry; no client in the repository. **This scenario cannot currently be ruled out**, not because it is likely but because nothing in the evidence base would detect it. **Design rule: at least one acceptance test per release is observed from the member's side.**

**Scenario 9, TIER A.** The null policy is always available and always scores perfectly on any harm-only metric. `checkNeverAbandons` already flags ordinary supportive language. For Persona iO silence is a safety failure, not a safe default, under settled decisions 9 and 20. **Design rule: every gate deployment is measured against a corpus of good replies that must pass, not only bad replies that must fail.**

**Scenario 10, TIER A.** M14. Aggregation is lossy in precisely the direction that defeats deletion: once a turn folds into a running total, removing it is arithmetically impossible without retaining the original, which is the retention the design exists to avoid. Settled decision 7's "deletable" is not satisfiable by the current schema. **Design rule: design the delete operation before the write operation.**

**Scenario 1, TIER B.** The difference from the absurd version is the size of the audience, not the presence of the disclosure. **Design rule: no performance or user-experience metric may be cited as evidence about privacy.**

**Scenario 3, TIER B.** Memory is a join between content and identity, and identity is the hard half. `profile-manager.js` already takes a `userId` nothing supplies. **Design rule: enforce settled decision 16 with a test, not an intention.**

**Scenario 6, TIER B.** No fetch anywhere has a timeout and no retry bound exists, so the regeneration design will be written in a codebase with no precedent for bounding anything. **Design rule, before the code: exactly one regeneration, the candidate is re-checked, a second failure produces a text-only fallback and never a third attempt.**

**Scenario 8, TIER B.** Literally true except the count. **This probe forces a distinction the deferral list had been blurring:** identity-for-memory is correctly deferred, but authentication-for-access is a different mechanism serving cost and abuse control and is not covered by that deferral. **Design rule: access control is a property of the socket, not of the persona. Do not add a third confidante before the socket has a door.**

---

### Q9 — SYSTEMS UNDER THE FOOL'S PROBE

| | Post-hoc verdict (S2) | Inverted fallback order (S4) | Non-discriminating signal (S5) | Self-observation only (S7) | Null-policy attractor (S9) | Derived-state persistence (S10) |
|---|---|---|---|---|---|---|
| Hidden system | Commit ordering | Dependency direction between output layers | Signal selection | Evidence boundary | Objective function shape | Data lineage |
| Unit of work | One release action | One turn's output layers | One routing decision | One acceptance claim | One gate decision | One turn's derived contributions |
| Constraint | Externalization is irreversible | Fragile layers upstream of robust ones | Signal must discriminate, not merely fire | Server cannot observe the client | Harm-only metrics are maximized by silence | Aggregation destroys the ability to subtract |
| Failure mode | Verdict after commit | Speech stall freezes text | Inverted routing on severe cases | Boundary failures invisible | Convergence on blandness | Deletion becomes a gesture |
| Control point | Introduce a prepare phase | Move synthesis off the text path | Replace or validate the discriminator | One member-side test per release | Two-sided measurement | Design delete before write |
| Feedback loop | **None** | Weak; TTS returns false but nothing aggregates it | **None** | **None; the blind spot hides itself** | Dangerous; each tightening looks locally correct | **None; deletion unimplemented, so its failure is untestable** |
| Resource cost | Latency bounded by buffer size | One refactor, low | One corpus run, near zero | One observed session, near zero | One good-reply corpus, low | Schema redesign if deferred, near zero now |
| Transplantability | HIGH | HIGH | HIGH | MEDIUM | HIGH | MEDIUM |
| Tier | A | A | A | A | A | A |

**Mechanism test on S2.** CLAIM: a verdict issued after externalization cannot function as a control. REASON: `crisisOverride` runs at `server.js:1942`, after `ws.send` at `server.js:1907`; its only available action is concatenation. VERIFIED BY THIS RUN. INFERENCE: established for the crisis path; extends beyond evidence when applied to the gate, whose eventual position is an unmade design choice. Competing explanation: a post-hoc verdict retains value as an audit record and as training data, which is why the rule says label it telemetry rather than delete it. TEST: wire any verdict-producing component at the current position and attempt to suppress a sentence the member already received.

**The pattern.** Four of six have no feedback loop at all. Persona iO's controls were built as one-shot actions rather than as loops, so none can report whether it worked. A control without feedback is an assumption with a function signature.

---

### Q10 — THE WEAK SIGNAL

**WS1. Safety scope and product scope are drifting apart by language.** M12. A Spanish-speaking member disclosing suicidal intent produces W3, no keyword match, and no referral. Failure is total and silent. Test: translate the 30 fixtures into Spanish and run them. HYPOTHESIS: thirty W3s and zero activations.

**WS2. `processingResponse` is a boolean where a queue belongs.** M10. **The main effort makes this bug more frequent**, because gating lengthens the window in which a member types again. That is a dependency, not a coincidence, and it is why the fix belongs before the main effort.

**WS3. No fetch in the codebase carries a timeout or an AbortController.** ElevenLabs at `server.js:2084` and Simli at `server.js:1733`. Every future vendor call will be written from these templates.

**WS4. The demo boundary is a query parameter the client controls.** `?demo=1` at `server.js:1779` is asserted by the browser, and omitting it grants more capability, not less. Not a live exposure. It is a truthfulness trap for the next investor or instructor conversation.

**WS5. The crisis suffix is suppressed when the model happens to say 988 itself.** `crisis-override.js:153`. Once the gate runs, a model-produced 988 becomes a CRITICAL violation while an appended one is exempted, so the same string is treated two ways depending on who produced it. That rule must be written into the precedence decision.

**WS6. There is no client in this repository.** No `index.html`, no `public/`; the only browser code is the uncompilable Next.js scaffold. The Module 4 demonstration depends on a frontend not in the audited repo whose current behavior is UNKNOWN.

**WS7. The system prompt contradicts itself about memory, and only one half is honest.** M13. If a member asks directly whether Chase remembers, `server.js:1316` fires and he tells the truth. If a member simply relies on him to carry something forward, `server.js:1270` tells him he does, and he will behave accordingly. **The honest branch is reachable only by explicit interrogation; the default behavior is the confabulating one.** Alternative explanation: line 1270 describes the target architecture where `profile-manager.js` carries calibration across sessions, in which case it is accurate as a target. That is assurance drift appearing for the third time, now inside the behavioral constitution, and it is the strongest confirmation of the throughline's fourth prediction. Test: mention something as though from a prior conversation and observe whether Chase claims continuity; then ask directly and observe whether the answer changes. HYPOTHESIS: the two answers differ.

**WS8. The profile schema has no decrement.** M14. Settled decision 7 requires memory to be correctable, redactable, and deletable. A monotonic counter supports none of those. Alternative explanation: the module is unreachable and may be a sketch. INFERENCE, not fact: an unfinished sketch and a settled design are indistinguishable from the code. The cost of noting it now is minutes; the cost of discovering it after members have data is a migration on live confidential records.

---

### Q11 — CONSTRAINT MAPPING

Not a waterfall. Rows 1, 2, and 7 run in parallel with the main effort because they contain present exposure or remove a prerequisite failure.

| # | Constraint | Mechanism it forces | Evidence the mechanism works | Next constraint | Class |
|---|---|---|---|---|---|
| 1 | Committed build logs member text | Split commit, ship logging hardening only | A live turn produces a log line with a character count and no words | Historical retention | CONTAIN NOW |
| 2 | Historical logs hold member text | Determine retention and access; decide on purge | Written retention answer plus a named access list | Access control | CONTAIN NOW |
| 3 | No release decision point | One function all member-facing text passes through, fast route and held route | Browser receives nothing on a held turn until the verdict; normal timing on a fast turn | Latency of the held route | MAIN EFFORT |
| 4 | TTS blocks text, unbounded | Move synthesis off the text path, add a timeout | Text completes with ElevenLabs stalled 30 s; bounded audio-failed state | Audio and text ordering in the client | SUPPORTING, prerequisite to 3 |
| 5 | Weight is not severity | Gate every turn, or build a purpose-made severity signal | The 30 fixtures route correctly, no semantic positive on the fast path | Cost of gating everything | SUPPORTING, prerequisite to 3 |
| 6 | Crisis and gate rules conflict | A written precedence rule, then a test that locks it | `enforceInvariants(reply + CRISIS_SUFFIX).requiresRegeneration === false` | Gate false positives | SUPPORTING, prerequisite to 3 |
| 7 | Test suite leaks children | Teardown on exit and failure; track `test-runtime.js` | `npm test && npm test` passes twice; no listener on 4309 to 4320 | CI existence | SUPPORTING |
| 8 | Classifier failure removes crisis handling | An explicit degraded rule at `server.js:1942` | Forced classifier throw still produces the documented outcome | Degraded-path semantics | SUPPORTING |
| 9 | Gate rules are lexical and broad | Measure false positives against ordinary supportive replies | A corpus of good replies passes without regeneration | Gate quality | MAINTAIN, measure only |
| 10 | No identity or data separation | Identity, then RLS, then consent, review, redaction, deletion | Out of scope this period | Memory obligations | DEFER |
| 11 | Next.js scaffold cannot compile | Move to a branch or separate repository | Repository holds no uncompilable application | None | REMOVE AS OBJECTIVE |

---

### Q12 — THE NARRATIVE GAP

The supplied poles are close but the live disagreement has three positions, not two.

**NARRATIVE A: "Further along than it looks."** Gets right: the engineering quality is real and unusual for a prototype, and the honest documentation habit is a genuine asset. Hides: every item on that list is true of the working tree and false of production, and "just wire it up" understates the remaining work by an architecture.

**NARRATIVE B: "An ambitious design document with a chat demo attached."** Gets right: an accurate description of what runs. Hides: the crisis conflict was found by executing two modules against each other, a method most shipped products never apply, and the logging discipline and transport contracts are finished work rather than aspiration.

**NARRATIVE C: "It is a student prototype, so a design-implementation gap is normal."** Gets right: Module 4 asks for Level 1, and deferring memory, identity, and the dashboard is correct sequencing. Hides: the privacy exposure is not a prototype-scope question. Whatever sessions occurred went to retained third-party logs in plaintext. Course scope governs what Mike must build; it does not govern what already happened. Settled decision 12 says a privacy rule does not move for a deadline, and this is the most comfortable way to let it move anyway.

**FALSE-EQUIVALENCE WALL.** Splitting the difference produces "it is partly built," erasing the actual asymmetry. **A and B are not two opinions about one system. They are accurate descriptions of two different builds.** A describes the working tree; B describes `18878b2`. The disagreement dissolves the moment anyone asks which build is meant, and the project has no mechanism that forces that question.

**TRIBAL-CAPTURE WALL.** Telling the optimist "you have built more than you think" hides that wiring changes nothing without a withhold primitive. Telling the pessimist "it is mostly a document" hides that the hardest finding came from Mike's own tooling working correctly.

**FINDING THAT SURVIVES BOTH WALLS.**

> **Persona iO's engineering quality and Persona iO's deployed behavior are nearly uncorrelated, because no mechanism connects them.**

Uncomfortable for the optimist: the best-engineered part of the system is the part that never shipped, and the build a reviewer would reach is the one Mike would least want shown. Uncomfortable for the pessimist: the gap is not caused by immaturity or overreach, so "be less ambitious" does not close it.

**Mechanism.** Quality accumulates in the editor. Deployment reads from `main`. Nothing requires the two to meet: no pipeline, no CI, no build identity attached to any claim, and the leak test that proves the hardening is untracked.

**What this changes operationally.** The remedy is neither more engineering nor less ambition. It is a chain from commit to deploy. Concretely: `git add test-runtime.js`, split and ship the logging commit, and adopt the rule that every capability claim in the submission carries a commit hash or is marked unproven.

---

## 5. CONTRADICTIONS AND CORRECTIONS

### Founder claim ledger

| # | Claim | Grade | Evidence |
|---|---|---|---|
| 1 | `server.js` imports four external packages and zero from `services/` | CONTRADICTED for the working tree, VERIFIED for HEAD | Working tree imports `./services/classifier` and `./services/crisis-override`. Also asserted by README and `TARGET_ARCHITECTURE.md`, both now stale relative to the working tree |
| 2 | Member text and full assistant replies are written to console | **VERIFIED for HEAD and production.** CONTRADICTED for the working tree | M1, M2. The prior audit graded this CONTRADICTED and scoped it to the working tree. That scoping was correct but the practical implication is the reverse: the fix is unshipped, so production leaks |
| 3 | `/simli-session` keeps the key server-side and returns session info | VERIFIED, with two additions | Key stays server-side. The route is unauthenticated, accepts any verb, and forwards Simli's entire body unfiltered. Token lifetime UNKNOWN |
| 4 | `conversationHistory` is per-connection, no cross-session memory | VERIFIED | Declared at `server.js:1792` inside the connection handler |
| 5 | `?demo=1` disables web search | VERIFIED | `server.js:1892-1896` |
| 6 | `package.json` has no test command | CONTRADICTED | Defines `test`, `test:units`, `test:runtime` |
| 7 | `invariant-gate.js` exposes enforcement plus regeneration behavior | VERIFIED | `services/invariant-gate.js:343-351` |
| 8 | `crisis-override.js` implements precedence and avoids treating outside-human connection as abandonment | CONTRADICTED | No precedence logic and no human-connection logic. Precedence exists only as a comment and as call ordering no code performs |
| 9 | `profile-manager.js` stores patterns, not raw content | VERIFIED as written, unreachable in practice, and see WS8 | `services/profile-manager.js:13-23`, `99-112` |
| 10 | Streaming to ElevenLabs begins before the full reply exists | VERIFIED | `server.js:1902-1918` |
| 11 | Deepgram exists but is not on the live path | STALE as worded; REPORTED as intended | Deepgram is instantiated per connection and initialized on the first binary frame. The narrower README claim that the live frontend sends text only cannot be verified here |
| 12 | Supabase support exists | VERIFIED as files, CONTRADICTED as capability | `@supabase/supabase-js` installed but imported by no reachable module; `@supabase/ssr` neither declared nor installed |
| 13 | Authentication code exists | VERIFIED as files, CONTRADICTED as capability | Cannot compile. README states the socket accepts any connection |
| 14 | Atelier code exists | VERIFIED as files, ORPHANED | Zero importers from any runnable path |
| 15 | Are these services reachable from the process `railway.toml` starts? | Answered | Two of fifteen. See M5 |

### Documentation drift, quotable and currently false

- `README.md:19`: "Nothing in `server.js` imports any of it" and "The only importer in the repository is `test-mra.js`." False of the working tree.
- `README.md`, environment section: "`MODEL_NAME` has a hardcoded fallback in `server.js`." The current code throws on a missing value at `server.js:164-167`, which was the point of HEAD commit `18878b2`. The README was not updated in that commit.
- `TARGET_ARCHITECTURE.md`: "`server.js` imports four things... It imports nothing from `services/`."
- `README.md:137` is a borderline case. "No safety enforcement in code" is now too strong for the working tree, but "nothing in `server.js` inspects model output before it reaches the client" remains exactly true. Split the sentence rather than deleting it.

### Corrections this run made to its own earlier output

- The prior audit graded the crisis-versus-gate conflict **S**. Under this engine's stricter ladder it is **A**, because it unifies two modules inside one codebase rather than two mature fields.
- The prior audit's Batch 1 treated "wire the gate" as the natural main effort framing. Q4's broadcast-delay isomorphism supplied a third option, fixed-lag buffering, which changed the main effort's implementation shape and materially weakened the latency objection.
- The prior audit treated identity as a single deferred item. Scenario 8 split it: identity-for-memory stays deferred; authentication-for-access does not.

---

## 6. UNKNOWNS

| Question | Why it matters | How to resolve |
|---|---|---|
| Exact deployed commit and deploy history | Governing source asserts `18878b2`; not independently observed by this run | `railway status`; boot log version line at `server.js:2243-2245` |
| Railway log retention window | Bounds the historical exposure | Railway project settings |
| Who can access those logs | Determines the size of the exposure | Railway project members |
| How many real or prospect sessions have run | Determines the volume of exposed conversation | Railway metrics; founder records |
| Whether any prospect used the live or demo unlock path | Determines whether real disclosures are involved | Founder records |
| Current browser behavior on each failure class | Two acceptance tests depend on it | Observe one live session |
| Whether Mike can edit the frontend | Acceptance tests 8 and 10 depend on it | Confirm before committing to them |
| Simli token lifetime and scope | Decides whether finding C3 is quota abuse or credential exposure | Inspect one `/simli-session` response |
| Real buffering latency, four separate measures | Decides whether latency becomes binding | Instrument acknowledgment, first approved text, first audio, complete trajectory |
| Which gate checks can run on a partial window | Open Questions 20 and 21, currently unmeasured | Run the gate against two-sentence windows |
| Whether `npm test` is run before deploys | Decides whether 122 checks protect anything | No CI config exists; confirm founder practice |
| Vendor spend to date | Bounds the unauthenticated-access exposure | Vendor dashboards |
| Whether any post-cutoff commit or deploy exists | All findings are as of 2026-09-27 | `git log`, Railway deploy list |

---

## 7. FINAL SYNTHESIS

### 7.1 Top insights by synthesis tier

S: subtractive promises on an additive architecture; assurance drift. A: post-hoc verdict is telemetry, not control; weight anti-correlated with severity; two safety modules semantically opposed; speech upstream of text; harm-only metrics maximized by silence; deletion must cover derived state; engineering quality uncorrelated with deployed behavior; fixed-lag buffering as a third option. B: four of six controls have no feedback loop; the prompt contradicts itself about memory.

### 7.2 Top insights by practical leverage

**This week:** assurance drift; the post-hoc verdict framing as an explanatory device; the dropped-message boolean; fixed-lag buffering.
**30 days:** two-sided gate measurement; weight is not severity; undertriage and overtriage as separate budgets; authentication split from identity.
**Capstone:** the subtractive-promises throughline; deletion-before-write; English-only safety scope; chain of custody as standing practice.

**Note on the separation.** The highest-tier insight has the lowest immediate payoff. The highest immediate payoff is C tier. That is why the two sorts are run independently.

### 7.3 Current effective system

At commit `18878b2`: a single-process Node WebSocket server that accepts any unauthenticated connection, selects one of two hardcoded persona prompts by query parameter, streams a Claude reply to the browser while flushing sentence-sized chunks to ElevenLabs inside the same loop, and writes the member's verbatim turn and the complete assistant reply to retained third-party logs. No classifier, no crisis handling, no output evaluation, no memory, no authentication, no deployed test script, no timeout on any outbound call.

In the audited working tree, uncommitted: observe-only classification, an append-only crisis suffix, metadata-only logging, 122 local checks. None changes what a member receives except the suffix, and none has shipped.

### 7.4 Declared system

An invitation-only membership of five persistent confidantes providing a private place for consequential thought, distinguished by continuity, discretion, and behavioral discipline enforced in code, with user-controlled memory that is inspectable, correctable, redactable, and deletable, where health outranks engagement and appropriate human help is never suppressed to preserve character.

### 7.5 Largest gap

**The declared system is defined by restraint. The effective system has no mechanism capable of restraint at turn time.** Not memory, not identity, not the dashboard. Those are absences. This is a category gap.

### 7.6 Hidden system

**Work flows to the cheap shape.** An additive mechanism needs a line of code. A subtractive mechanism needs a buffer, an evaluator, a verdict, a fallback, and a bounded failure path. Under founder-time scarcity and agent-assisted development, which lowers the cost of producing artifacts but not the cost of deciding, the system accumulates appends.

### 7.7 Binding constraint

**A CONTROL AND GOVERNANCE constraint: no mechanism connects reviewed work to running work.**

Empirical, not theoretical. The project has already run the experiment. The logging hardening is written, tested, and correct, and members' words are still being logged verbatim. Building more safety without fixing the chain produces more unshipped safety. `test-runtime.js`, which proves the hardening works, is untracked.

The technical constraint, absence of a turn-time withhold primitive, is real and is next, not current. It cannot bind while nothing reaches production.

**Consequence: the main effort's definition of done must include deployed, not implemented.**

### 7.8 Constraint migration

| Stage | Constraint | Required mechanism | Measurement confirming migration |
|---|---|---|---|
| Now | No chain from reviewed to running | Track the leak test; split and ship the logging commit; attach a hash to every claim | A live turn logs a character count and no words; deployed hash equals reviewed hash |
| Next | No turn-time withhold primitive | Fixed-lag release buffer all member-facing text passes through | Held turn: browser receives nothing until the verdict. Fast turn: timing unchanged |
| Then | Gate quality, null-policy attractor | Two-sided measurement against a good-reply corpus | Good replies pass without regeneration at a measured rate |
| Then | Routing signal validity | A discriminator validated against the fixture set | No semantic positive on the unheld path |
| Then | Authentication for access | A door on the socket and `/simli-session` | An unauthenticated connection cannot consume vendor quota |
| Later | Identity and data separation | Auth plus per-member isolation | Deferred |
| Later | Memory consent, review, deletion | Delete designed before write | Deferred |

### 7.9 Main effort

> **Ship a turn-time withhold primitive: one release point through which every member-facing text frame passes, running on a fixed two-sentence lag, with the invariant gate enforcing on CRITICAL violations only, the crisis suffix exempted, exactly one regeneration, and a text-only fallback. Deployed, with the deployed hash recorded.**

It changes the real mechanism rather than adding a module. It produces browser-observable evidence. The fixed lag makes it affordable within five sessions where full-response buffering would not be. It unlocks the gate, regeneration, bounded failure, latency measurement, and eventually memory deletion, because all are instances of withholding. It does not pretend memory, identity, or the dashboard exist.

**Scope discipline.** The gate enforces on CRITICAL only, and only after the good-reply corpus passes. Full gate rule quality is explicitly out of scope. Wiring a broad lexical gate that converges on blandness would be worse than wiring none.

### 7.10 Contain now

Roughly half a work session.

| # | Action | Why it cannot wait |
|---|---|---|
| 1 | Record the deployed commit and boot line | Every other claim is unanchored without it |
| 2 | `git add test-runtime.js` | The proof of the fix exists in no repository |
| 3 | Split the logging hardening into its own commit and deploy only that | Production writes member words to retained third-party logs |
| 4 | Determine Railway retention and access list. Do not browse historical logs to investigate | Bounds the exposure without widening it |
| 5 | Queue or reject the second message with a visible frame | Silent loss of member input; the main effort makes it more frequent |
| 6 | Add a timeout to the ElevenLabs and Simli fetches | Unbounded stall freezes the conversation with no member-visible state |
| 7 | Method check and rate limit on `/simli-session`; connection cap on the socket | Unauthenticated vendor-quota consumption |

Item 3 is the chain exercise. Doing it correctly once establishes the practice the main effort reuses.

### 7.11 Supporting effort

Write the crisis precedence rule before any gate code. Build the good-reply corpus. Add process teardown to `test-runtime.js`. Instrument four separate timings. Define undertriage and overtriage as named metrics with separate budgets. Copy the three incident-knowledge comment blocks into `DECISIONS.md`.

### 7.12 Maintain

The metadata-only logging discipline; the `sendToElevenLabs` return contract; the rule that history equals what the member received; the sentinel leak tests; the `MODEL_NAME` fail-fast; the honest README habit; the orphaned service modules as the only written record of the behavioral thinking.

### 7.13 Defer

Persistent memory, identity and data separation, Supabase, RLS, Atelier, the dashboard, consent, review, redaction, deletion, the third through fifth confidantes, Deepgram frontend work, cross-turn antecedent resolution, non-English safety coverage, and gate rule quality beyond the two-sided check.

**One deferral splits.** Identity-for-memory stays deferred. Authentication-for-access moves to containment item 7.

### 7.14 Remove as objective

- **"Wire every service."** Disproved by demonstration. Replace with: one mechanism has authority over the member-facing result.
- **"122 tests pass."** A statement about an unshipped build until the chain exists. Replace with: the deployed hash equals the tested hash.
- **"The safety layer exists."** Replace with: a named mechanism can withhold a member-facing turn.
- **The Next.js scaffold as a deliverable.** Move it to a branch.

### 7.15 Latency status

Three categories at once, and **not** the binding constraint.

| Category | Status | Reason |
|---|---|---|
| Failure containment | **Yes, now** | M9 has no timeout and no member-visible state. A missing terminal state, not an optimization |
| Supporting measurement | **Yes, now** | Nothing is buffered, so no enforcement latency is paid. A baseline must exist before the release point lands |
| Later optimization | Yes | Routing, partial release, speculative synthesis come after measurement |
| Binding constraint | **No** | Latency cannot constrain a mechanism that does not exist |

The fixed-lag design changes latency's character. Under full-response buffering, latency is a per-turn discovered cost. Under a two-sentence lag it is a chosen constant. That converts an unknown into a dial.

**What promotes latency to main effort:** measured p95 time-to-first-approved-text on the held path versus the fast path, showing the lag breaks the interaction. HYPOTHESIS: a two-sentence lag will not. If it does, the constraint becomes which gate checks can run on a partial window. Settled decision 19 governs either way.

### 7.16 to 7.22

Acceptance tests are in Appendix A. The coding-agent mission order is in Appendix B. The evidence package is in Appendix C.

**Commander's intent.**
*Purpose.* Persona iO promises restraint in every dimension that matters. The running system cannot withhold anything at turn time. Until one mechanism can, every promise is carried by prose. This work builds the first mechanism capable of restraint and gets it in front of a member.
*Key tasks.* Establish the chain from reviewed to running work and prove it by shipping the logging fix. Write the crisis precedence rule before any gate code. Build the fixed-lag release point and deploy it. Observe one real session in a browser.
*End state.* A member-facing turn is held, evaluated, and released by a named mechanism running in production at a known commit. A known-bad candidate is demonstrably withheld. The crisis referral demonstrably survives the gate. Every failure class reaches a visible bounded state. Production logs carry no member words. Every claim in the submission carries a commit hash.
*Constraints, not tradeable.* A gate failure never becomes permission to release unchecked content. The crisis referral is never removed to preserve persona. Latency never authorizes skipping a required check. Nothing unshipped is described as live. No new sensitive conversation is collected into unsafe logs. Silence is not an acceptable terminal state.

**Release conditions.**

| Gate | Required before it |
|---|---|
| Instructor demo | Containment 1 to 6 complete; main effort deployed; browser observed; limitations written |
| Trusted prototype test | The above, plus every failure class reaching a visible bounded state, plus the good-reply corpus passing |
| Prospect access | The above, plus authentication on the socket and `/simli-session`, plus a truthful capability statement. The demo flag is client-controlled and is not access control |
| Sensitive real-user test | The above, plus qualified outside review of the crisis policy, plus a written retention and access policy, plus known detector weaknesses stated to the participant including the English-only scope |
| Persistent memory | The above, plus identity, plus verified data separation, plus the delete operation designed and tested before the write operation, plus consent and review |
| Paid member access | The above, plus an operating cost model, plus incident response, plus a capability statement matching the deployed build |

**Stop rule.** Stop expanding when the release point has a written policy, an implemented mechanism, bounded failure behavior, a reproducible test, an observed browser outcome, a known deployed build identity, and documented limitations. Do not add a subsystem because time remains. If time remains, spend it on the good-reply corpus and on browser observation.

**Next constraint.** Gate quality, specifically the null-policy attractor. Once a mechanism can withhold, every tightening looks locally correct and the system drifts toward blandness, which for Persona iO is itself a safety failure. The detector is the good-reply pass rate tracked over time. After that: authentication for access, then identity and data separation, then memory consent and deletion.

---

## APPENDIX A: ACCEPTANCE TESTS

| # | Condition | Test | Pass criterion |
|---|---|---|---|
| 1 | Rejected candidate | Mock model returns a known CRITICAL violation | Zero `response_text` frames before the verdict; released text differs from the candidate |
| 2 | Appropriate human support survives | `enforceInvariants(reply + CRISIS_SUFFIX, cls)` | `requiresRegeneration === false`. **Fails today. Capture the failure first** |
| 3 | Violation mixed with support language | Reply containing both a CRITICAL violation and a legitimate referral | Violation caught, referral survives intact |
| 4 | Classifier failure | Force `analyzeMessage` to throw | Turn completes; crisis path still evaluated per the documented degraded rule; telemetry records the degradation |
| 5 | Gate failure | Force `enforceInvariants` to throw | Turn reaches a bounded terminal state. Gate failure is not permission to release unchecked |
| 6 | Model failure | Anthropic error and mid-stream abort | Explicit error frame; client never left in `thinking` |
| 7 | One regeneration fails | Two consecutive CRITICAL verdicts | Exactly two model calls, never three; a text-only fallback still reaches the member |
| 8 | TTS stall | ElevenLabs stalled 30 seconds | Full text completes; explicit audio-unavailable state; timeout fires at its bound |
| 9 | Avatar failure | `/simli-session` returns 500 | Text and audio continue; bounded visible state |
| 10 | Browser-visible completion | One observed live session, held turn and fast turn | Browser render matches server intent. The only member-side test in the set |
| 11 | Logging sentinels | Existing sentinel suite extended to catch `console.*(..., err)` whole-object shapes | Zero sentinel hits. The four current call sites must fail it before they are fixed |
| 12 | Repeat execution | `npm test && npm test` | Passes twice; no listener remains on ports 4309 to 4320 |
| 13 | Revision identity | Boot line in the demo recording versus the submitted commit hash | Exact match |
| 14 | Router validity | All 30 fixtures through the release path | No semantic positive on the unheld path |
| 15 | Good-reply corpus | Ordinary supportive replies through the gate | Passes at a measured rate before enforcement is enabled |

Tests 8 and 10 require frontend access. Confirm that access before committing to them in the submission.

---

## APPENDIX B: CODING-AGENT MISSION ORDER

**OBJECTIVE.** Introduce a single release point in `server.js` through which every member-facing text frame passes. Buffer on a fixed two-sentence lag. Evaluate each completed sentence group with `enforceInvariants`. Enforce on CRITICAL only. Exempt the crisis suffix per the precedence rule in `CRISIS_POLICY_SPEC.md`. Allow exactly one regeneration. Fall back to text-only on a second failure.

**BOUNDARIES.**
- Do not modify `services/invariant-gate.js` rule content. Wire it, do not tune it.
- Do not change classifier thresholds.
- Do not use `classification.weight` to route. It is not a severity signal.
- Do not touch memory, identity, Supabase, Atelier, or the Next.js scaffold.
- Do not commit anything beyond the stated objective. Separate commits for separate concerns.
- Report, do not decide, on any case where the precedence rule is ambiguous.

**ACCEPTANCE TESTS.** Appendix A numbers 1 to 9, 11, 12, and 14. Test 2 must be captured failing before any fix.

**ARTIFACTS TO RETURN.** The commit hash. Test output including the pre-fix failure. Four timing measurements on both paths. A list of gate checks that ran on a two-sentence window versus those requiring the full response. A written list of anything ambiguous resolved by assumption.

**STOP CONDITIONS.** Stop and report if the precedence rule is ambiguous; if the good-reply corpus fails above the agreed budget; if the two-sentence lag exceeds the agreed time bound; or if the objective would require a change outside the boundaries.

---

## APPENDIX C: EVIDENCE PACKAGE FOR SUBMISSION

Preserve:

- Commit hash before and after, with the boot line from each deployed build.
- Configuration identity as variable names only, never values.
- The failing fixture captured before repair: `checkNeverAbandons(CRISIS_SUFFIX)` returning two CRITICAL violations.
- The same call returning zero after.
- Full `npm test` output tied to a hash.
- A short screen recording of three browser states: fast turn, held turn, stalled TTS.
- Four timing measurements on both paths.
- Sentinel test output showing zero hits.
- A written limitations section naming what remains UNKNOWN: production history before this week, browser behavior prior to observation, Simli token lifetime, log retention, session counts.
- GitHub links to `server.js`, `services/crisis-override.js`, `services/invariant-gate.js`, `CRISIS_POLICY_SPEC.md`, `test-runtime.js`.

**Lead with the failing test.** A conflict found by executing two of your own safety mechanisms against each other is a stronger claim than a working feature, and it is very difficult to fake.

---

## WHAT SHOULD MIKE DO NEXT?

Mike should track `test-runtime.js`, split the already-written logging hardening into its own commit, deploy it, and record the deployed hash, because until reviewed work can reach production nothing else he builds this term will reach a member.

---

*End of run. All twelve questions and the final synthesis complete. No code was edited, nothing was deployed, no infrastructure was changed, and no production logs were read during this run.*
