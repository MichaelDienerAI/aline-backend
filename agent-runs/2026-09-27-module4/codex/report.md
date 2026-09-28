# Persona iO: Module 4 complete analysis and final synthesis

**Owner:** Michael Diener  
**Run:** C.R.I.T. Tier Engine v2, four batches and final synthesis  
**Export date:** September 27, 2026, America/Phoenix  
**Governing evidence cutoff:** September 27, 2026, 6:32 PM Phoenix  
**Planning horizon:** Five focused Persona iO work sessions, subject to the actual course deadline and available hours  
**Repository:** `aline-backend`  
**Artifact:** `agent-runs/2026-09-27-module4/codex/report.md`

## Executive decision

Mike should make Module 4 demonstrate one protected conversational turn in a known build: required policy checks control what reaches the member, appropriate human support survives those checks, and failures end visibly within a defined bound. Contain the reported logging and access exposure separately. Defer persistent memory, dashboards, additional personas, and speculative latency optimization.

The single main build outcome is an identified browser/backend path in which a synthetic typed turn reaches one of three observable outcomes: approved useful text, a deliberate policy-approved fallback, or an explicit bounded failure. A rejected candidate must reach neither member-facing text nor speech generation. Optional media must not indefinitely hold the core turn open.

This report consolidates the four analysis batches, their source research, the final operating decision, and the earlier audit evidence used by the run. It is a self-contained analytical record, not a new production audit. It does not claim that any proposed change was implemented, tested, committed, or deployed.

## 1. Scope, permissions, and evidence discipline

The work was analysis and prioritization. No implementation, deployment, infrastructure change, sensitive production-log inspection, GitHub change, Figma change, or release decision was authorized by the batch run. The later export instruction authorizes creation of this report only. No source-code change is part of this export.

The report contains no secret values or raw member conversations. Synthetic evaluation cases are described by behavior rather than reproducing potentially sensitive utterances. Environment variable names, file paths, and revision identifiers are not credentials.

### Evidence labels

| Label | Meaning in this report |
|---|---|
| VERIFIED IN NAMED ENVIRONMENT | A direct observation in an explicitly identified environment. Earlier observations are identified as verified by the earlier audit, not by this synthesis. |
| REPORTED | The user-supplied reconciliation, another document, or an earlier source asserts the state; this run did not independently reproduce it. |
| PLANNED | A proposed or intentionally designed mechanism, not an established running capability. |
| UNKNOWN | Available evidence cannot establish the answer. |
| CONTRADICTED | Inspected evidence directly conflicted with the proposition in the named environment. |
| STALE | A claim describes an earlier state that inspected evidence had already superseded. |
| INFERENCE | An analytical conclusion extending beyond direct observation, with its assumptions and tests stated. |

Inner C.R.I.T. means Claim, Reason, Inference, Test. Outer C.R.I.T. means Context, Role, Instructions, Target. A test described as proposed is not a test result. A passing fixture is not evidence of comprehensive safety, clinical effectiveness, privacy compliance, or production behavior.

### Source and version ledger

| Source/environment | Date and revision | What it supports | Limitation |
|---|---|---|---|
| User-supplied summary of *The State of Persona iO* | September 27, 2026, 6:32 PM Phoenix; reported production `18878b2` | Governing reported production/local distinction | The full underlying reconciliation was not independently read or retested in the later batches. |
| Earlier repository audit in this conversation | Local `main`, HEAD `18878b2548f1cdb659dedc65b92e88ee5446fbec`, dirty working tree | Code references, local unit results, mocked runtime observations | The dirty working tree is not identical to the commit. It is not proof of deployed behavior. |
| Supplied Systems Audit and ASTRA findings | Audit environment around `18878b2` | Architecture and prioritization context summarized by the user and earlier audit | Separate complete source documents were not all attached or independently inspected in this run. |
| Supplied Module 4 directions | Current course work period | Limited functional prototype, iteration, testing, repository/files, progress explanation | Exact deadline and available hours remain unknown; full course materials were not independently inspected. |
| Week 2 specification, Module 3/Figma, Deformation Test Bank, prior conversations | Supplied descriptions and settled decisions | Intended architecture, interface intent, evaluation method | Not proof of backend implementation or live functionality. |
| Primary external sources consulted in Batch 2 | Specific publications listed in section 7 | Transferable control, reliability, privacy, evaluation, and HCI mechanisms | External literature does not verify Persona iO. |

### Governing current-state assertions

**REPORTED production at the cutoff:** commit `18878b2`; verbatim member and assistant logging; some whole error logging; no classifier, crisis handling, output evaluation, or persistent memory; TTS can delay later text; `/simli-session` lacks meaningful application access protection; no deployed test script; a prompt implies continuity that runtime does not provide.

**REPORTED local state:** observe-only classification, append-only crisis handling, metadata-oriented logging, 122 local tests, and staged gate material. These additions were not deployed as of the supplied cutoff. Classification did not control release, the invariant gate was not on the live path, crisis and invariant semantics conflicted, and output still left before a pre-release verdict.

**UNKNOWN current production:** the deployment after that cutoff, whether logging has since changed, whether local work was committed or deployed, and actual browser failure behavior. The report must not describe the cutoff state as independently observed current production.

### Test-count reconciliation

The supplied reconciliation reports 122 local tests. The earlier audit independently executed `node test-mra.js` and recorded **52 passed, 0 failed**. It did not execute `test-runtime.js` because that test writes and deletes temporary files, which conflicted with the then-strict read-only instruction. Do not report 122 tests as independently executed by this run, and do not interpret the difference as a proven false source assertion. The counts refer to different evidence scopes that remain unreconciled.

## 2. Earlier audit evidence ledger

All line references in this section refer to the **earlier inspected local working tree**, not a fresh line-number verification during export. They are navigation evidence, not a guarantee that the present file has identical lines. Paths are repository-relative. No new runtime tests were run to produce this export.

### Inventory and operational configuration

| ID | Earlier observation | Evidence and implication |
|---|---|---|
| E01 | Branch `main`; HEAD `18878b2548f1cdb659dedc65b92e88ee5446fbec`; dirty working tree | Modified `package.json`, `server.js`, `services/prompt-engine.js`, `test-mra.js`; untracked `CRISIS_POLICY_SPEC.md` and `test-runtime.js`. A commit hash alone cannot identify this audited build. |
| E02 | Railway configuration starts the Node backend | `railway.toml`: Nixpacks builder; `startCommand="node server.js"`; `/health`; healthcheck timeout 100; restart on failure, maximum three retries. No deployed commit was independently established by the earlier audit. |
| E03 | Local package had automated test scripts | `npm test` runs `node test-mra.js && node test-runtime.js`, with separate unit/runtime scripts. Start/dev run `node server.js`. The claim of no test script was stale locally, while the later report still described no deployed script. |
| E04 | Unit test result | Earlier `node test-mra.js`: 52 passed, 0 failed. Runtime test file was not run under the no-write audit constraint. |
| E05 | Local runtime and inventory | Inspected Node version v22.23.1; package engine at least 18. No conversation browser source, Next build configuration/dependencies, migration/RLS files, CI, dedicated tests/scripts directories, `.env.example`, or Vercel configuration appeared in that inventory. Absence is scoped to that inspected repository. |

### Backend path

| ID | File reference | Earlier finding |
|---|---|---|
| E06 | `server.js:1-7`, optional `fs` use near 2009 | Three external packages were imported: WebSocket, Deepgram, Anthropic. Built-in HTTP and crypto are not external packages. Local classifier and crisis modules were imported. The four-external/zero-services claim was contradicted locally. |
| E07 | `server.js:165` | A missing model environment setting throws. README language implying a fallback was stale relative to this implementation. |
| E08 | `server.js:1712-1722` | Wildcard HTTP CORS. `/health` returns static process-level status and persona information; it does not verify vendors, enforcement, or browser receipt. |
| E09 | `server.js:1727-1757` | `/simli-session` sends the server-side Simli API key and a face identifier upstream, then returns upstream JSON without filtering. It also logs raw upstream/error material on some paths. Actual legacy response fields and credential lifetimes were not established. |
| E10 | `server.js:1769` | WebSocket server lacked application authentication, quotas, and origin enforcement in the inspected backend. A separate infrastructure control was not established. |
| E11 | `server.js:1772-1794` | Per-connection handler, persona query, demo flag, connection-scoped history. A sanitized persona key was used in some metadata, but raw persona identifiers remained in other paths. |
| E12 | `server.js:1782-1792` | Actual persona/voice map lookups used direct property access with fallback. An inherited property name could avoid the intended fallback. Local mocked inspection showed a missing serialized system prompt for such a key. |
| E13 | `server.js:1788`, `1797-1835` | Deepgram client instantiated per connection, including text connections. A conditional binary-audio path existed. Final transcripts overwrote rather than accumulated; early audio could be dropped before readiness; error recovery was limited. Actual browser use was unknown. |
| E14 | `server.js:1839-1898` | User turn added to connection history; local classification invoked; classifier failure did not block ordinary generation. Static persona prompt, environment-selected model, max output tokens 400, full current history, web search up to three uses unless demo enabled. |
| E15 | `server.js:1902-1918` | Text delta sent immediately around line 1907. Punctuation/length-triggered TTS awaited inside stream iteration. Final text also awaited TTS. No gate decision preceded those sends. |
| E16 | `server.js:1942-2003` | Crisis processing followed ordinary generation/TTS. It could append a suffix but not undo prior output. `sessionId` was null for its artifact path. The suffix tracked-send callback did not prove browser rendering. |
| E17 | `server.js:2006-2023` | Assistant history updated on successful completion; response complete/listening events emitted. TTS failure could coexist with an overall success status. Only aggregate elapsed timing was evident. |
| E18 | `server.js:2007-2013` | Optional history fingerprints included role, length, and truncated unsalted hash. A comment overstated what this proves about nondisclosure. Railway start configuration alone did not establish whether the option was disabled. |
| E19 | `server.js:2025-2045` | Model-error logging was more bounded locally. Error handling sent a generic error without the normal listening transition. A tracked server send proves transport acceptance at most, not rendering or playback. |
| E20 | `server.js:2063-2154` | TTS transformation removes markdown, including entire fenced blocks. Hard-coded voice/model/endpoint choices; no application deadline. HTTP/transport failures return false; ordinary callers ignore that boolean. Correct typed-array byte slicing was a useful implementation detail to preserve. |
| E21 | `server.js:2158-2237` | Busy turns could be silently ignored; malformed/unrecognized buffers could reach binary handling. Socket close finished Deepgram but did not establish cancellation of model/TTS work. Raw persona identifiers remained in logs. |
| E22 | Installed Anthropic SDK inspected earlier | Default retries two and timeout 600,000 ms. These defaults are not an end-to-end conversational deadline and may amplify delay/cost. |
| E23 | `server.js:520`, `1314` | Prompt language implied familiarity/formation beyond demonstrated cross-session retrieval. Session history must not be described as durable memory. |

### Staged modules and frontend scaffolding

| ID | File reference | Earlier finding |
|---|---|---|
| E24 | `services/classifier.js:119-150`, `245-286` | Substring/pattern-driven classification. Reported output categories included weights 1, 3, 8, 13, 21; no ordinary weight-5 output. Specific urgent-language variants were missed, and contextual benign language could trigger high weight. Weight was not established as severity. |
| E25 | `services/crisis-override.js:88+` | Required highest weight first; some external-context exclusions occurred before matching. Any existing crisis-resource number could suppress the suffix. Suffix was separate from the modified response. An example/reference ordering that put crisis after gate and before TTS did not match the inspected server. |
| E26 | `services/invariant-gate.js:29+`, `255+`, `320` | Certain referral/resource language triggered a critical abandonment violation. The gate returned verdict/regeneration metadata; it did not itself block transport or perform regeneration. Generated regeneration constraints could forbid appropriate professional/resource language. |
| E27 | `services/prompt-engine.js:25`, `269+` | Dynamic prompt construction existed but the server did not call it. Shared identity material was Aline-specific, creating a prospective Chase integration concern. Prompt statements about deletion were not deletion mechanisms. |
| E28 | `services/profile-manager.js:26`, `63`, `99` | Stored aggregate patterns/profiles rather than raw dialogue, but these can still be sensitive. Expected `finalWeight`, defaulted when missing, lacked demonstrated input-schema enforcement; read-modify-write could race. Not on the live turn path. |
| E29 | `services/session-boundary.js:52` | Returned `finalFecWeight`, unlike the profile consumer's `finalWeight`. Direct future wiring could silently use a default instead of the intended value. |
| E30 | `services/conductance.js:58`, `170`, `219` | Loading invoked decay; decay used elapsed time since reinforcement without a separately updated decay timestamp. Repeated loads could repeatedly decay state. Staged only; not evidence of a live-member effect. |
| E31 | `services/atelier.js:87-236` | Persisted/broadcast snippets and other artifacts, facts, intentions, and context. This was broader content retention than a profiles-only description would imply. Not established on the live turn path. |
| E32 | `app/api/atelier/dashboard/route.ts:69+` | Auth lookup existed, followed by service-role queries without demonstrated member scoping. Writer/read field names differed; ignored query errors/default values could make missing data appear neutral. Actual database schema and deployed participation were unknown. |
| E33 | `lib/supabase/`, authentication middleware, Next scaffolding | Supabase and auth-related code existed but were not shown reachable from the Railway `node server.js` process. No independent RLS verification. |
| E34 | `services/latency-tracker.js:5`, drift/backchannel modules | Latency module contained an unsupported universal neurological threshold claim. Drift scanning could return excerpts. These modules were not established as live. |
| E35 | `CRISIS_POLICY_SPEC.md:3`, later open decisions | Specification-only status; precedence and uncertainty decisions remained open. Documentation cannot resolve runtime authority by itself. |

### Earlier local counterexamples and mocked observations

The earlier audit tested synthetic examples. It found urgent variants that remained low-weight, punctuation/apostrophe sensitivity, an external-topic exclusion overriding an otherwise high-weight result, and benign contextual language receiving high weight. These observations undermine using emotional weight alone as crisis severity; they do not estimate real-world detection performance.

A synthetic appropriate-resource-and-presence response failed the staged gate as a critical abandonment violation, and the proposed regeneration constraints would remove the resource language. This establishes the local semantic conflict, not a deployed gate failure.

A no-file mock harness exercised the then-unmodified server with mocked vendors/network:

| Scenario | Earlier observed local sequence/result | Limit |
|---|---|---|
| Ordinary synthetic turn | Thinking, text, TTS/audio, model end, crisis processing, suffix/audio where applicable, complete/listening | Mocked execution, not real vendors or browser. |
| TTS HTTP failure | Text path could complete | Does not prove stall handling or useful browser state. |
| Pending TTS promise | Progress stopped before crisis/completion | Supports coupling mechanism, not a measured production incident. |
| Model failure | Thinking then error, without normal listening transition | Browser handling unknown. |
| Persona sentinel | Raw persona identifier appeared in logs | Does not establish historical production contents. |
| Inherited-property persona identifier | Intended system prompt absent from serialized request | Local input-handling counterexample. |

Exact full transcripts of audit commands are not reproduced because they were not all preserved in the available conversational record. This report does not fabricate `git log` output, line-count totals, or runtime outputs beyond the retained observations.

## 3. Claim corrections and contradictions

| Original or tempting claim | Grade and correction |
|---|---|
| Server imports four external packages and no services | CONTRADICTED in audited local tree: three external packages plus local classifier/crisis imports. Production scope must be evaluated separately. |
| Member and assistant text are logged | REPORTED in cutoff production. Ordinary local generation logs had improved, but raw error and persona paths remained concerns. Do not collapse these environments. |
| Simli API key stays server-side, therefore the response is harmless | Only the outbound use of the server key was inspected. Returned upstream fields were unfiltered; response credentials and lifetime UNKNOWN. |
| Connection history is memory | VERIFIED by earlier local audit only as connection-scoped history. Durable member memory was absent from the traced path. |
| Demo mode disables search | Verified by earlier local code for the inspected demo branch. It was not an access or safety boundary. |
| There is no automated test command | STALE for audited local package; REPORTED true of cutoff production. |
| Invariant gate enforces and regenerates | Gate logic/metadata existed, but transport enforcement and executed regeneration were not established. A returned flag is not an action. |
| Crisis handling already preserves human-support precedence | Append-only crisis code existed locally, but conflicted with staged gate rules and ran too late to undo ordinary output. |
| Profile storage contains no raw dialogue, so privacy is solved | Aggregate storage is not necessarily nonsensitive; staged Atelier also retained snippets. Neither observation proves deployed retention behavior. |
| Generation streams toward speech before full reply exists | Verified by earlier local path. This creates both responsiveness and an irreversible-output problem. |
| Deepgram is absent from the live process | CONTRADICTED for backend reachability: initialization and optional binary route existed. Actual browser use UNKNOWN. |
| Supabase, auth, Atelier, and other services exist, therefore they govern live turns | CONTRADICTED as a runtime inference. Most were outside the traced Railway entrypoint path. |
| Health endpoint means conversation is healthy | Static process status did not establish vendors, policy, or browser outcome. |
| 122 tests passed in this run | Unsupported. 122 REPORTED; 52 unit passes independently recorded earlier. |
| Every high-weight message is severe and every low-weight message is ordinary | CONTRADICTED by local counterexamples. |
| First output under a universal threshold proves conversational quality | Unsupported. Acknowledgment, approved text, audible speech, and continuity are distinct observations. |

## 4. Architecture and trustworthy-turn trace

### Declared, reachable, and observed architecture

| Layer | Description | Evidence limit |
|---|---|---|
| Declared | Persistent confidantes; classifier; calibration; invariant gate; crisis continuity; profiles; conductance; drift monitoring; Atelier; authentication; database support; memory controls; voice/avatar | Names and documents indicate intent, not participation. |
| Reachable in earlier local backend | HTTP health/Simli routes; WebSocket; persona/history; classifier; Anthropic; text streaming; awaited TTS; later crisis suffix; optional Deepgram | Most staged services were not reachable from the started process. |
| Observed in earlier mocked execution | Immediate text, interleaved awaited TTS, later crisis, completion on success; pending TTS blocked progress | No real browser/vendor execution proof. |
| Reported cutoff production | Conversational path without local classifier/crisis/output-evaluation additions | Reported deployment identity, not independently reobserved. |

The repository described a substantially broader governed confidante system than the path that produced a turn. The consequential gap was authority: most protective concepts could not change, block, or replace a member-facing output before it left.

### Turn stages

| Stage | Earlier local participation | What remains unproved |
|---|---|---|
| Member submits/browser event | UNKNOWN | Browser implementation and acknowledgment. |
| WebSocket parsing | LIVE | Correct handling of every malformed/busy input; member-visible rejection. |
| Identity/session | Connection session LIVE; persistent member identity UNREACHABLE in traced path | Application access and future member separation. |
| Persona selection | LIVE, with inherited-property edge case | Browser persona intent and robust validation. |
| Context retrieval | Connection history LIVE; durable retrieval UNREACHABLE | Cross-session continuity absent. |
| Classification | LIVE locally, observe-only; absent in reported production | Does not independently authorize release. |
| Prompt construction | Static persona prompts LIVE; dynamic service UNREACHABLE | Staged prompt policies not runtime guarantees. |
| Model generation | LIVE in code and mocked trace | Current real vendor behavior. |
| Output gate | UNREACHABLE | No pre-release verdict in observed path. |
| First irreversible text | LIVE before evaluation | A later rejection cannot retract received content. |
| Speech | LIVE optional call, awaited in core loop | Stall deadline and playback outcome. |
| Simli visual output | Session route LIVE; browser rendering UNKNOWN | Actual fallback and credential lifetime. |
| Crisis logic | LIVE locally after ordinary output/TTS | Current production absent per report; precedence conflict unresolved. |
| Logging | LIVE | Exact current production retention/access. |
| Durable memory | UNREACHABLE/PLANNED | Consent, review, retrieval, correction, deletion. |
| Telemetry | Limited LIVE metadata; staged modules UNREACHABLE | End-to-end timing and member outcome. |
| Next-turn state | Connection history LIVE on success | Disconnect recovery and retained failed-turn behavior. |

### Trustworthy-turn conditions

| Condition | Status for evidence environment |
|---|---|
| Correct arrival and parsing | PARTLY TRUE: route exists; malformed/busy and browser cases incomplete. |
| Correct session/member identity | PARTLY TRUE for connection; persistent identity absent. |
| Correct persona | PARTLY TRUE; validation edge case observed. |
| Correct current context | PARTLY TRUE for connection history; no durable recall. |
| Relevant risk classification | PARTLY TRUE locally, known misses; absent in reported production. |
| Prompt constructed | TRUE for ordinary inspected path; full intended policy not integrated. |
| Model returns | PARTLY TRUE; vendor failure/stall remains possible. |
| Critical evaluation before release | FALSE in inspected/reported path. |
| Crisis precedence preserved | FALSE as an established end-to-end property. |
| Text reaches member | Server send observed; actual rendering UNKNOWN. |
| Voice/avatar fail gracefully | PARTLY TRUE for some TTS errors; stalls and browser behavior unresolved. |
| Errors visibly terminate | UNKNOWN end to end; server transitions incomplete. |
| Logs minimize sensitive content | FALSE in reported production; PARTLY TRUE locally. |
| Permitted durable storage/retrieval | PLANNED, not live. |
| Member review/correction/removal | PLANNED, not live. |

No actual browser observation establishes the first link end to end. Within the traced backend, persistent identity is already absent if the claim requires a known member. The first definitive break in the claimed pre-release protection chain is output leaving without required evaluation. Do not turn this into a claim that every earlier stage is proven correct.

## 5. Batch 1: Insight scan, hidden systems, and constraints

### Highest retained insights

| Insight | Tier | CRIT and practical use |
|---|---|---|
| Policy needs authority at release | B | Claim: a rule cannot prevent output unless output depends on its decision. Reason: immediate sends precede evaluation. Inference: later monitoring can still be useful, but preventive authority is absent. Test: inject rejection and observe zero candidate content at text/TTS. Use: one release controller. Limit: ordering does not make the policy accurate. |
| Provenance is part of evidence | B | Claim: local tests cannot support a different running build. Reason: reported local/production mismatch. Inference: current deployment may have changed. Test: identify build/configuration and reproduce. Use: preserve build identity. Limit: provenance cannot repair weak tests. |
| Containment and prototype development are parallel responsibilities | C | Claim: logging/access exposure should not wait for the full gate build. Reason: exposure occurs independently of output quality. Inference: present exposure is conditional on current state. Test: current configuration and controlled synthetic leak tests. Use: separate containment work. Limit: historical handling requires owner decisions. |
| Optionality requires failure independence | B | Claim: media is not optional when text waits indefinitely for it. Reason: awaited TTS coupling. Inference: browser results unknown. Test: unresolved TTS with text/terminal observation. Use: independent approved-text delivery. Limit: text does not preserve all voice benefits. |
| Policy integration includes conflict resolution | A | Claim: simply wiring the staged gate could suppress appropriate help. Reason: observed referral/abandonment conflict. Inference: next implementation may resolve it. Test: support, violation, mixed fixtures. Use: adopt precedence before authority. Limit: tests do not confer clinical validity. |
| Prototype scope should maximize evidence, not module count | C | Claim: one complete protected path teaches more than many disconnected services. Reason: current gap concerns causal participation. Inference: depends on course scope as supplied. Test: compare whether a reviewer can reproduce changed member behavior. Use: Level 1 structural slice. Limit: not a complete production service. |

No S or S++ finding was justified. Practical ordering put current exposure first, then prerequisites, learning value, deliverability, and reversibility.

### Hidden systems

| System | Trigger and causal mechanism | Maximum-leverage intervention | Limitation |
|---|---|---|---|
| Deployment provenance | Local improvement remains outside deployed build, so member behavior does not change | Identify/reproduce demonstrated revision and configuration | Does not establish adequate behavior by itself. |
| First-output boundary | A delta is sent before the later verdict | Make required verdict a prerequisite for release | Buffers add delay; policy accuracy remains. |
| Logging | Normal/error convenience copies content into diagnostic retention | Bounded diagnostic schema and synthetic sentinel tests | Historical records and vendor retention remain separate. |
| Crisis precedence | General abandonment rule matches appropriate support | Explicit rule precedence, including mixed cases | Requires Mike's policy meaning and possibly outside review. |
| Classifier dependency | Failure or weak score is treated as ordinary permission | Explicit failure branch and distinct risk semantics | Classifier remains fallible. |
| Gate semantics | Caller assumes pass/fail means more than it does | Document exact verdict meaning and candidate coverage | A formal interface can still encode poor rules. |
| Regeneration | Rejected candidate causes repeated generation or unchecked retry | One bounded retry, independently checked | Fallback still needs policy. |
| TTS coupling | Awaited optional work suspends core progress | Approved text/terminal independent of media | Voice accessibility and quality need later work. |
| Browser observation | Server success is substituted for rendered result | Turn-linked browser evidence | Rendering is not understanding or benefit. |
| Access | Unrestricted request consumes resources or exposes unfinished functions | Verified access boundary appropriate to prototype | Full identity/membership remains future work. |
| Memory prerequisites | Retention outruns ownership/permission | Defer persistence until controls exist | Session/log privacy still needs work now. |

### Constraint mapping

| Constraint | Forced mechanism/workaround and its cost | Evidence of improvement | Next likely constraint | Class |
|---|---|---|---|---|
| Uncertain deployed state | Work from local evidence while production remains unproved | Running/demonstrated build identity matches evidence | Release mechanism | SUPPORTING; containment prerequisite |
| Reported raw logging/access exposure | Restrict sensitive testing; safer diagnostics require engineering effort | Controlled normal/error sentinel tests, access verification | Operational diagnosis and historical handling | CONTAIN NOW |
| No pre-release authority | Immediate output is responsive but cannot be recalled | Rejected candidate absent at both output boundaries | Policy quality and buffering delay | MAIN EFFORT |
| Crisis/gate conflict | Manual interpretation or avoiding gate activation | Support/violation/mixed tests satisfy adopted policy | False positives/negatives | SUPPORTING prerequisite |
| TTS waits/retry behavior | Wait indefinitely or silently ignore failure | Bounded browser outcome under fault injection | Performance and media quality | SUPPORTING |
| Browser evidence gap | Infer member result from server events | Actual render/terminal observation | Wider scenario coverage | SUPPORTING |
| Missing identity/data separation | Avoid private persistence | Future two-member isolation and access tests | Consent/retrieval/revocation | DEFER implementation; prerequisite before persistence |
| Operating economics unknown | Founder absorbs unmeasured spend/time | Later per-turn cost and bounded attempts | Sustainable service capacity | DEFER expansion, measure bounded prototype costs |

The chain is not a mandatory waterfall. Independent exposure containment may run in parallel. The five-session plan must remain conditional on hours, frontend access, credentials, and the course deadline.

## 6. System control, interfaces, failures, and carrier economics

### Hidden system map and authority

Inputs are member intent, persona choice, current context, policy, and vendor responses. Actors are member, browser, backend, vendors, Mike, coding agents, and operators. Resources include network, model/speech capacity, founder attention, test time, and money. Transformations turn input into prompts, candidates, decisions, messages, audio, history, and diagnostics. Feedback comes from test results, browser outcomes, failures, and bounded telemetry.

Mike has formal authority over scope, policy, claims, and release. The process that sends a message has practical control over release. Vendors control whether requests succeed and what they return. The browser controls what it renders. The member bears waiting, confusion, unwanted disclosure, or unhelpful behavior. Mike and operators bear diagnosis, incident handling, vendor spend, and continuity costs.

The system directly controls prompt construction, routing, buffer behavior, application logging, gate invocation, retry limits, and emitted UI states. It influences model behavior, speech naturalness, and end-to-end latency. It cannot reliably control outages, model retirement, network behavior, member disclosure, or external retention policies. Prompts and vendor requests influence outcomes; they are not guarantees of those outcomes.

### Interface map

| Interface | Information/state crossing; control | Failure and observation | Assessment/intervention |
|---|---|---|---|
| Browser/backend | Member input, persona/session fields, text/audio/status; client and backend each control one side | Lost/ignored input, disconnect, absent render; server and member may observe different things | Weakly specified end-to-end evidence; define turn-linked states. |
| Backend/model | Prompt, history, candidate stream; backend constructs, vendor generates | Errors, stalls, malformed/empty output | Upstream dependency; bounded failure and evaluation required. |
| Gate/release | Candidate, verdict, policy version; release code has practical power | Stale/missing verdict, fail-open, policy conflict | Highest leverage for pre-release trust. |
| Backend/TTS | Transformed approved text and audio; vendor controls synthesis | Stall/error blocks progress if awaited | Decouple core text; inspect transformations. |
| Backend/Simli/browser | Session request/response, browser media state | Unknown credential lifetime, initialization/render failure | Return-field/lifetime verification and observed fallback required. |
| Backend/Deepgram | Audio/transcripts | Readiness loss, transcript overwrite, raw errors | Optional backend route, browser use unknown; do not invent live capability. |
| Backend/database scaffolding | Profiles/snippets/auth-related state if later wired | Separation, schema, race, permission failures | Not established live; inspect before enabling persistence. |
| Backend/log retention | Diagnostic content/metadata | Unnecessary retained disclosures; operators may see information member cannot | Replace debugging function with bounded telemetry. |
| Member/memory record | Future permissions, visible records, corrections | Invisible retained influence or ineffective revocation | Future product contract, not current capability. |

Trust depends disproportionately on the interface between the policy decision and irreversible release. Useful communication must continue through that interface without optional media silently becoming a prerequisite.

### Failure paths

| Trigger | Earlier mechanism or gap | Member outcome established? | Required/proposed recovery |
|---|---|---|---|
| Anthropic error | Generic error; no normal listening event in inspected catch | Browser UNKNOWN | Explicit bounded terminal error/fallback. |
| Anthropic stall | SDK long timeout/retries, no demonstrated end-to-end deadline | UNKNOWN | Adopt application deadline and cancellation/late-result policy. |
| Stream interruption | Partial output may already have escaped | No browser proof | Protected buffer and explicit incomplete-turn behavior. |
| Invalid/empty response | No comprehensive validation established | UNKNOWN | Evaluate/validate before release; terminal fallback/error. |
| ElevenLabs HTTP failure | Returns false, caller often ignores | Mocked text completion only | Accurate media status, core completion independent. |
| ElevenLabs stall | Await blocks later text/crisis/completion | Local mocked stall verified | Bounded media task and independent text. |
| Simli failure | Session upstream error; frontend behavior unavailable | UNKNOWN | Browser-visible text path and bounded media failure. |
| Deepgram failure | Conditional route errors/readiness/transcript issues | UNKNOWN | Explicit input-mode error/retry; preserve typed option where implemented. |
| WebSocket disconnect | No established model/TTS cancellation | UNKNOWN | Cancel or safely discard late work; explicit reconnection scope. |
| Classifier failure | Local ordinary generation continued | Pre-release protection not established | Adopt failure branch; missing required evaluation is not permission. |
| Gate failure | Gate not live in traced path | No live fallback proven | No unchecked release; approved fixed fallback or bounded failure. |
| Regeneration failure | Execution not established | PLANNED | At most one retry, reevaluation, terminal fallback/error. |
| Supabase/auth/memory failure | Outside current turn path | No live-path failure behavior | Do not claim resilience; define before enabling. |
| Busy/malformed client input | Silent return or ambiguous buffer handling | UNKNOWN | Explicit accepted/rejected input and bounded client state. |

The desired sentence, “Because vendors cannot always succeed, Persona iO preserves useful approved text even if optional media fails,” was only **PARTLY TRUE** in local error cases and remains **ASPIRATIONAL** as an end-to-end browser guarantee.

### Vendor optionality

Anthropic generation is an upstream dependency of the current conversational objective; model selection is environment-controlled, but a vendor-neutral implementation was not established. ElevenLabs voices/model/endpoint and Simli session integration were vendor-specific. Deepgram had a conditional route, not demonstrated browser necessity. Supabase scaffolding was not a current turn dependency. Railway was the declared host; Vercel participation was not established from the inspected backend repository.

Environment configurability is not the same as architectural replaceability. Face plus voice plus text to voice plus text to text-only degradation was a target, not an end-to-end demonstrated property. Several apparent fallbacks still shared the model, WebSocket, browser state, and backend process.

### Who carries safeguard costs

| Safeguard | Cost carrier and cost | Useful job of shortcut | How the safer path inherits the job |
|---|---|---|---|
| Content-minimized diagnostics | Engineering builds schema; operators lose easy raw inspection | Raw logs make debugging fast | Turn/stage identifiers, bounded error classes, timings, attempt counts, synthetic reproduction. |
| Pre-release evaluation | Member waits; vendor spend may rise; engineering handles buffering | Streaming conveys responsiveness | Truthful acknowledgment plus measured approved delivery. |
| One regeneration | Vendor cost and extra member delay | Retry can repair a candidate | One checked attempt, then deliberate terminal behavior. |
| Media independence | Engineering handles concurrent/late events | Sequential awaits simplify code | Explicit state transitions and fault tests. |
| Browser verification | Founder/testing time | Server-only tests are easier and faster | Small repeatable browser scenario tied to build identity. |
| Deployment provenance | Operator/reviewer attention | Informal deployment is quick | Minimal revision/configuration/evidence record. |
| Crisis precedence review | Mike and possibly qualified reviewers carry judgment work | Lexical rules are simple | Bounded explicit policy and contrast fixtures. |
| Future memory governance | Engineering plus member review friction | Silent profiles provide easy personalization | Inspectable retained records and meaningful controls. |

Under pressure, bypass becomes attractive when it restores useful debugging, responsiveness, or development speed. Prohibiting shortcuts without replacing their useful function increases that pressure. No measured cost totals or vendor spend were available.

### Incident classifications

| Issue | Class | Next action | Acceptance evidence |
|---|---|---|---|
| Unwired release enforcement | FIX | Implement explicit controller after adopting semantics | Rejected content cannot escape. |
| Raw conversation logging | FIX | Remove unnecessary content from normal/error paths | Synthetic sentinel absence in controlled diagnostics. |
| Live-session privacy boundary | CONTEND | Map vendor/log destinations and restrict exposure | Documented flows plus targeted tests; no blanket privacy claim. |
| Streaming versus full evaluation | CONTEND | Buffer first; measure and revisit | Required checks finish before release. |
| Missing deployed test continuity | FIX | Tie test results to build/configuration | Reproducible identified build. |
| Vendor deprecation/outages | ACCEPT external possibility, CONTEND operational effects | Runbook, bounded failures, configuration discipline | Failure drill, not promise of prevention. |
| Public/demo exposure | FIX | Verify access boundary and resource controls | Unauthorized synthetic request rejected as intended. |
| Missing persistent identity | DEFER now; FIX before private persistence | Define separation contract | Synthetic cross-member isolation tests. |
| Memory not implemented | ACCEPT within Module 4 scope | Describe honestly and defer | No durable-memory claim; no accidental activation. |
| First-output speed as overriding objective | EXIT | Replace with approved-delivery and completion measures | Correctness never bypassed to improve speed. |

### Preserve, release, and transmit

KEEP useful persona assets, meaningful fixtures, correct audio-byte handling, and staged mechanisms that encode important intent. ARCHIVE or DEPRECATE superseded documentation and misleading examples after reference review. DELETE ONLY AFTER CONFIRMATION applies to code with no demonstrated caller; apparent nonuse alone is not sufficient. UNKNOWN applies where another repository, deployment, or operator may depend on a component.

Release the success metric “wire every service,” not the important future functions those services represent. Correct continuity and unsupported latency claims. Keep staged code clearly labeled instead of describing it as live.

The three smallest continuity artifacts are: (1) a runtime/protocol document covering entrypoint, messages, build identity, and failure states; (2) a policy/precedence contract with acceptance fixtures; (3) a short runbook/evidence record covering environment names without values, demonstration steps, logging limits, and recovery. These transmit knowledge that otherwise remains in founder memory, conversations, comments, or dashboards.

## 7. Batch 2: Minds, sources, and structural analogies

Tiers assess the relevant work and the synthesis borrowed from it, not personal fame or an objective measure of intellectual rarity. No person was awarded a universal intelligence rank. No S/S++ tier was justified by this bounded exercise.

### Minds and specific work to study

| Person/work | Domain, Persona iO mechanism, first move | Tier rationale: depth/reach/independence/access | What not to transfer |
|---|---|---|---|
| Nancy Leveson and John Thomas, STPA | Software/system safety. Analyze unsafe control actions, including missing, premature, delayed, or overly persistent release. First: draw one controller/feedback loop for a turn. | A: deep control-based safety practice; spans software and operations; challenges component-only fault framing; grounded in safety analysis. | Industrial certification claims or an oversized safety bureaucracy. |
| Jerome Saltzer and Michael Schroeder, protection principles | Complete mediation and fail-safe defaults. First: enumerate every text/audio release path and required decision. | A: foundational protection mechanisms; broad architectural reach; focuses on enforcement rather than intent; systems design experience. | Treating subjective conversational evaluation as a simple permission bit with perfect accuracy. |
| Mike Ulrich, cascading-failure operations | Dependency and retry amplification. First: stall TTS and observe core completion. | B: operator-level failure knowledge; links load, dependencies, retries; practical production exposure. | A full large-scale SRE organization for a prototype. |
| Dinah McNutt, release engineering | Reproducible build/release identity. First: bind demonstration evidence to revision/configuration. | B: operational depth; development-to-operation continuity; practical release discipline. | Tooling scale beyond the current project. |
| Saleema Amershi and coauthors, human-AI interaction guidelines | Communicate limits, support recovery and user control. First: specify visible thinking/result/failure states. | B: empirical HCI practice; joins technical uncertainty and interaction; operationally useful guidance. | Assuming guidelines prove this interface works without observing it. |
| Marco Tulio Ribeiro, Tongshuang Wu, Carlos Guestrin, Sameer Singh, CheckList | Behavioral evaluation by capability and perturbation. First: build support/violation/mixed and phrasing-variation fixtures. | B: focused evaluation method; moves beyond aggregate score; practical test design. | Treating a fixture bank as exhaustive risk coverage. |
| Helen Nissenbaum, contextual integrity | Privacy as appropriate information flows. First: map member content destinations and purposes. | A: deep privacy framework; connects norms, actors, information and transmission; challenges secrecy-only framing. | Legal compliance claims or a complete implementation recipe. |
| Stephen Levinson and Francisco Torreira, turn-taking timing | Distinguish anticipation, acknowledgment, speech onset, and conversational coordination. First: name each Persona iO timing measure. | A: domain depth joining language production and interaction; empirical access to human conversation. | A universal AI delay threshold or a claim that immediate output is always preferable. |
| Barbara Stanley and Gregory Brown, collaborative safety planning | Human-support continuity and explicit crisis-response structure. First: use the work to formulate questions for qualified review. | B for the bounded transfer: clinical operational method and collaborative practice. | Automating a clinical intervention or claiming chatbot efficacy from that work. |

### Sources and concrete use

These primary sources were consulted in Batch 2. Their mechanisms inform recommendations; they do not independently verify repository facts.

| Source/type | Core mechanism and first concrete move | Limitation | Tier |
|---|---|---|---|
| [STPA Handbook](https://www.flighttestsafety.org/images/STPA_Handbook.pdf), safety manuscript, 2018 | Identify unsafe control actions and missing feedback. Draw policy, release, browser, and operator control relationships. | Primary manuscript accessed through a mirror; the MIT host attempt failed. Do not claim certification. | A |
| [The Protection of Information in Computer Systems](https://www.cs.virginia.edu/~evans/cs551/saltzer/), foundational paper, 1975 | Complete mediation and conservative defaults. Inspect every release route. | Reference-monitor structure does not solve ambiguous policy semantics. | A |
| [Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/), operational manual | Dependency failures and retry amplification. Inject a hung optional dependency. | Large-system examples need scope reduction. | B |
| [Handling Overload](https://sre.google/sre-book/handling-overload/), operational manual | Bound admitted work and recovery load. Explicitly handle busy turns and retries. | No current traffic measurements establish overload as today's bottleneck. | B |
| [Release Engineering](https://sre.google/sre-book/release-engineering/), operational manual | Reproducible release process. Preserve revision/configuration/test identity. | Avoid enterprise tooling for its own sake. | B |
| [Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf), HCI paper, 2019 | Make uncertainty, recovery, and control visible. Define explicit client states. | Guidelines require local observation. | B |
| [Beyond Accuracy: Behavioral Testing of NLP Models with CheckList](https://aclanthology.org/2020.acl-main.442/), research paper, 2020 | Capability-oriented tests and controlled variations. Build contrast sets. | Passing cases do not establish population reliability. | B |
| [Privacy as Contextual Integrity](https://digitalcommons.law.uw.edu/wlr/vol79/iss1/10/), foundational privacy paper, 2004 | Evaluate information flow by context, actors, and transmission. Map diagnostic copies. | Not a legal conclusion or storage implementation. | A |
| [NIST IR 8062](https://nvlpubs.nist.gov/nistpubs/ir/2017/NIST.IR.8062.pdf), privacy engineering publication, 2017 | Predictability, manageability, and disassociability. Translate memory promises into observable controls. | Framework adoption is not proof of compliance. | B |
| [Timing in turn-taking and its implications for processing models of language](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2015.00731/full), research paper, 2015 | Human turn timing involves coordination and prediction. Separate acknowledgment from substantive output. | Human timing is not a universal chatbot service-level objective. | A |
| [Stanley-Brown Safety Planning Intervention](https://suicidesafetyplan.com/) and [training](https://suicidesafetyplan.com/training/), clinical method resources | Collaborative support planning. Identify what needs qualified review. | No autonomous crisis-treatment transfer or efficacy claim. | B |
| [NASA software engineering handbook fault-management material](https://swehb.nasa.gov/pages/viewpage.action?pageId=107053215&showCommentArea=true), operational handbook | Contain faults and preserve reduced useful operation. Define text survival under media failure. | Spacecraft risk models and certification burden do not transfer wholesale. | B |
| [SLSA provenance v1.2](https://slsa.dev/spec/v1.2/provenance), provenance specification | Identify how an artifact was built. Use minimal build/configuration evidence. | Do not claim SLSA compliance from a commit record. | B |
| [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final), incident-response publication, 2025 | Prepare, respond, recover, preserve appropriate evidence. Assign log-handling ownership. | Not authorization to inspect confidential logs broadly. | B |
| [Official Army mission-command explanation](https://www.army.mil/article/220314/tradoc_cg_emphasizes_the_importance_of_mission_command), doctrine explanation | Intent, boundaries, disciplined initiative. Give agents outcomes and acceptance tests. | The full field-manual PDF was not successfully accessed; do not imply it was read. Military authority does not transfer literally. | B |
| [Consensus on Transaction Commit](https://www.microsoft.com/en-us/research/publication/consensus-on-transaction-commit/), research paper, 2006 | Distinguish preparation, commitment, and failure states. Model release transitions explicitly. | Do not install distributed consensus or two-phase commit for a single-turn prototype. | B |

No fiction/media source was retained: none added a sufficiently concrete near-term mechanism beyond these sources.

### Isomorphisms: shared structure, bounded transfer

An isomorphism here means a local structural match, not equivalence of whole systems.

| Other domain | Shared structure and constraint | What transfers / experiment | What does not transfer | Tier |
|---|---|---|---|---|
| Publication authorization/reference monitors | A specific object must receive permission before irreversible publication | Reject a candidate and observe all release paths; changing it invalidates unrelated approval | A perfect binary policy model | A |
| Transaction commitment | Prepared, approved, sent, and observed are different states | Inject late events/disconnects; prevent stale approval or duplicate completion | Two-phase commit/Paxos as an implementation requirement | B |
| Spacecraft fault containment/circuit breakers | Preserve a reduced useful function after a component fails | Stall speech and fail avatar; text still completes | Spacecraft certification, hazard equivalence | B |
| Medical triage | Routing must use relevant risk signals, not an attractive proxy | Contrast intense benign and understated urgent cases | Clinical authority or diagnostic reliability | B |
| Chain of custody/release engineering | An evidence claim must remain attached to the artifact observed | Match revision/configuration to browser demonstration | Provenance as proof of correctness | B |
| Purpose-bounded information handling | Data use depends on who, why, and under what permission | Later revoke derived influence, not only transcripts | One universal privacy policy | A |
| Conversational turn-taking | Acknowledgment and substantive response perform different jobs | Measure them separately; avoid fake understanding during evaluation | Universal human/AI timing threshold | B |
| Mission command | Owner defines intent/limits; implementer chooses bounded method | Agent returns evidence and escalates policy ambiguity | Agent ownership of release or crisis meaning | B |

Air-traffic control, nuclear interlocks, finance, theatrical performance, and game networking offered partial analogies only. They were not treated as whole-system matches or used to justify unnecessary architecture.

## 8. Batch 3: Throughline, hidden wisdom, and weak signals

### Candidate throughlines

| Candidate | What it explains / fails to explain | Mechanism, prediction, falsification, build implication | Tier |
|---|---|---|---|
| Control irreversible commitments | Explains release, logging, retention; underexplains distinct characters and useful presence | Before disclosure/retention, require the relevant decision. Predicts boundary defects matter. Weakened if most harm comes from permitted but poor interaction. Build release control, without claiming a whole product theory. | A |
| Continuity under uncertainty | Explains vendor fallback, human support, persona consistency; can excuse excessive retention/engagement | Preserve useful communication under failure. Weakened when continuity harms agency. Build bounded fallback, not indefinite engagement. | B |
| Preserve agency while increasing context | Explains future memory/consent; does not by itself specify current release authority | More context must not remove correction or choice. Test revocation and informed controls later. | A |
| Preserve member agency while sustaining conversational continuity | Best compression of privacy, crisis presence, memory, embodiment, and prototype scope; does not justify exactly five personas or commercial viability | Keep useful communication and meaningful choice together. Predicts text fallback, visible failure, and revocable memory. Weakened if the framing cannot discriminate a concrete design choice. | A |

Selected throughline: **Preserve member agency while sustaining conversational continuity.** This is a normative analytical synthesis, not a discovered law. Its current engineering rule is to establish control before irreversible release while preserving useful permitted behavior.

### Hidden operational wisdom

| Finding | CRIT, first move, payoff, limitation | Timing |
|---|---|---|
| Safer paths must inherit the useful job of shortcuts | Claim: raw logging persists partly because it diagnoses failures cheaply. Reason: removing it without replacement increases debugging friction. Inference: actual founder pressure unmeasured. Test: diagnose synthetic faults from bounded metadata. First: define useful stage/turn/error telemetry. Tier B. | This week; payoff in debugging and privacy evidence. |
| Approve the exact candidate, not a turn that once passed | Claim: later changed content needs covered approval. Reason: append/regenerate/transform changes object. Test: mutate after pass. First: explicit candidate identity and release transition. Tier A. | This week; evidence in controlled tests. |
| Appropriate support is not a blanket exemption | Claim: precedence repair can create another bypass. Reason: mixed responses may contain both appropriate support and violations. Test three contrasting fixtures. First: adopt mixed-case behavior. Tier A. | This week; policy prerequisite. |
| Visible failure can preserve agency | Claim: honest terminal failure can be more useful than apparent uninterrupted operation. Reason: member can stop/retry instead of waiting indefinitely. Test stalled path and member-visible choices. First: bounded states. Tier B. | This week; browser observation needed. |
| Separate outcome ownership from implementation freedom | Claim: agents can choose code structure without owning policy. Reason: policy ambiguity changes acceptable behavior. Test whether mission order makes escalation clear. First: bounded objective/acceptance contract. Tier B. | This week and month; founder efficiency. |
| Retained influence deserves governance | Claim: deleting text may leave personalization intact. Reason: profiles can carry effects. Test later synthetic revocation. First: retain as future schema/control requirement. Tier A. | Rest of capstone; do not build memory now. |

### Weak signals, not repetitions of headline defects

All implementation anomalies below derive from the earlier local audit and were not retested in Batch 3.

| Specific anomaly | Challenged assumption and mechanism | Alternative explanation | Watch/test and priority | Tier |
|---|---|---|---|---|
| Sanitized persona key coexists with raw identifier logs | Fixing one logging location may leave parallel paths inconsistent | Newer work may have corrected remaining uses | Sentinel every route/error path; supporting containment | B |
| `finalFecWeight` producer versus `finalWeight` consumer | Imports can succeed while defaults hide incompatible contracts | An uninspected adapter might translate fields | Direct contract fixture before future wiring; defer service activation | B |
| Repeated loading can repeat decay | Reading state may change it, so observation influences memory | Intended semantics might differ, but no separate decay timestamp was evident | Freeze time and compare repeated loads; staged future issue | A |
| Aline-specific identity in shared prompt builder | Shared calibration could accidentally replace Chase identity | Builder may be intended for Aline only | Test both personas before integration; preserve persona distinction | B |
| TTS removes whole fenced blocks | Formatting transforms can remove policy-relevant meaning | Such formatting may never be generated in ordinary use | Put important qualification in transformed region and compare text/payload/audio | A |
| Dashboard field mismatch plus neutral defaults | Missing data may look like a healthy measurement | Actual schema could contain both fields | Inject unavailable/error result; show unavailable, not neutral; defer dashboard build | B |

Cross-signal inference: plausible intermediate values can hide broken module contracts. Defaults and neutral values deserve tests because they can convert unavailable information into apparent success. This is not proof that every default is wrong.

## 9. Batch 4: Fool's Probe, extracted systems, and narrative gap

### Absurd scenarios as mechanism tests

All scenarios are HYPOTHETICAL. Connections to existing evidence are explicitly bounded.

| Probe | Structural claim and reason | Inference/test/practical consequence/limitation | Tier |
|---|---|---|---|
| Instant answer plus public conversation billboard | Response success can coexist with privacy failure; logging creates another destination | Publication is more exposed than logs. Test controlled normal/error sentinels; map destinations. Cannot establish historical contents. | C |
| Gate rejects after speech finishes | Late verdict cannot prevent already delivered output | Late monitoring may still aid learning. Force rejection; observe zero candidate content at text and speech. Does not prove decision accuracy. | B |
| Every answer contains support language and automatically passes | Permitted support must not exempt unrelated violations | Proposed exemption, not current fact. Test support/violation/mixed. Preserve help while resolving violation; no clinical efficacy claim. | A |
| Perfect memory assigned to wrong member | Ownership and permission are part of memory correctness | Future risk, not observed live leak. Two-member synthetic isolation before persistence. Isolation is not consent/deletion. | C |
| Avatar smiles forever while TTS stalls and text stops | Presentation can survive while communication fails | Browser effect unknown. Stall TTS/fail avatar and observe bounded text/terminal result. Text does not preserve all accessibility benefits. | B |
| Every message gets maximum weight | A nondiscriminating proxy cannot guide selective action | Known examples challenge severity proxy, not every classifier. Contrast benign intensity/understated urgency/context. No reliability estimate. | C |
| Infinite regeneration until pass | Retry policy controls cost and availability | Future failure mode. Limit to one reevaluated retry and terminal outcome. Fallback quality still needs acceptance. | B |
| Backend success while browser displays nothing | Server completion is not member-visible completion | Observation gap, not established universal browser failure. Interrupt delivery and inspect browser states. Rendering is not benefit. | B |
| Never answer, never release harmful output | A narrow blocking metric can destroy product utility | Universal refusal hypothetical; overblocking plausible. Pair prohibited and permitted fixtures. Small set is not global usefulness. | C |
| Delete transcripts but retain behavioral profiles | Forgetting claims must include governed retained influence | Staged future issue. Revoke synthetic data and test later effects. Behavioral test alone cannot prove complete storage deletion. | A |

### Systems extracted from the strongest probes

| System | Unit/constraint, failure, control | Feedback/cost/use/transfer/limit |
|---|---|---|
| Release authorization, Tier A | Specific candidate; decision before release; stale approval and broad exemptions fail; control candidate-to-releasable transition | Decision metadata plus output-boundary observations. Member buffering delay, Mike policy work, engineering effort. Transfers strongly to publication approval; evaluator quality remains separate. |
| Turn termination and dependency containment, Tier B | Started turn; bounded useful/fallback/error outcome; stalls/retries fail; control waits, attempts, late events | Stage/attempt/elapsed/browser terminal feedback. Vendor spend and member waiting. Strong transfer to circuit breakers/fault containment; deadline cannot make vendor succeed. |
| Evidence continuity, Tier B | Claim tied to build/config/test/outcome; mismatches fail; control allowable release claims | Revision/configuration/test/browser record. Founder/reviewer effort. Strong chain-of-custody transfer; provenance does not validate tests. |
| Information flow and retained influence, Tier A | Information plus derivatives; ownership/purpose/destination/retention; ungoverned copies fail | Sentinel tests now, future permission/revocation tests. Engineering/member review costs. Medium transfer because context determines policy; not legal compliance. |
| Balanced behavioral evaluation, Tier B | Contextual decision; both misses and overblocking matter; proxy or metric gaming fails | Contrast fixtures and reviewed outcomes. Mike and outside-review cost. Medium transfer to triage/quality control; fixture coverage remains limited. |

Combined CRIT: Claim: the prototype needs enforced release, bounded termination, and browser evidence. Reason: each prevents a different failure. Inference: these are necessary for the proposed demonstration, not comprehensive safety. Test: reject a candidate, stall media, interrupt delivery. Practical use: one objective with observable failure conditions. Limit: detector quality, memory governance, and member welfare remain separate.

### Competing narratives and surviving findings

| Narratives | What each gets right and hides | False-equivalence and tribal-capture walls | Finding, test, operational change |
|---|---|---|---|
| “Product works; integration/polish remain” versus “Mostly a design” | First recognizes real backend/persona/media work but hides protection gaps. Second recognizes unfulfilled promises but hides a usable implementation base. | “Partly finished” does not explain missing authority. Neither “almost ready” nor “nothing is real” is adequate. | Conversational capability exists in reports without demonstrated end-to-end control of attached promises. Test a protected turn in a known build. Preserve backend and add release authority. Tier C. |
| “Wire gate, solve safety” versus “Imperfect gate is useless” | First sees reachability requirement but hides policy conflict. Second sees detection limits but hides value of bounded enforceable behavior. | Unenforced and imperfectly enforced rules have different consequences; neither merits blanket safety claims. | Demonstrate authority and acceptable behavior on a stated set. Test support/violation/mixed/failure. Adopt semantics first. Tier B. |
| “Fast streaming creates presence” versus “Buffering solves trust” | First sees interaction delay but hides irreversibility. Second creates decision opportunity but hides bad policy/stalls. | Required checks cannot be traded for speed; delay is not automatically acceptable. | Measure correctness, containment, performance separately. Buffer first and observe timing. Tier B. |
| “Memory creates continuity” versus “No memory preserves privacy” | First sees context value but hides obligations. Second reduces persistence burden but hides logs and unmet continuity promises. | No memory is neither privacy proof nor evidence future memory lacks value. | Permitted context supports continuity; current data flows need containment now. Separate logging tests from later revocation tests. Tier A. |

No S/S++ or H finding was manufactured. Unsupported profundity was discarded rather than retained as a dramatic conclusion.

## 10. Final operating synthesis

### 10.1 Top insights by practical horizon

This week: resolve exposure, establish protected release, observe bounded browser outcomes. Next 30 days: improve gate accuracy, crisis-policy evaluation, reliability, and build-to-release continuity. Rest of capstone: identity/separation before permission-bounded memory and revocation. Rarity and utility are separate; fixing an ordinary error-log leak may outrank a sophisticated future-memory insight.

### 10.2 Effective versus declared system

The reported effective system at the cutoff was a two-persona conversational backend with external generation/media services and connection history, lacking deployed pre-release evaluation and durable memory. The declared system is a private confidante service with continuity, discretion, behavioral discipline, member-controlled memory, and appropriate human-support continuity.

The largest architectural gap is enforceable authority over release. The hidden system includes founder decisions, agent implementation, test selection, configuration, deployment, and browser observation. Evidence shows local/production divergence, but does not establish whether time, access, unresolved policy, or intentional staging caused it.

### 10.3 Binding constraint and migration

Working hypothesis: **No demonstrated policy-correct authority over the release of a complete member turn.** Technical aspect: output precedes checks and media can obstruct completion. Governance aspect: precedence, failure behavior, and approval meaning must be adopted before enforcement is responsible.

Falsification: a current known build blocks rejected content before text/speech and passes observed browser failure tests. Importing a gate does not falsify the hypothesis.

Likely migration: uncontrolled release → policy-correct release with bounded failure → evaluator quality and usable delay → identity/separation before persistence → consent/retrieval/revocation → economics. Measurements, not completion labels, determine the next bottleneck.

### 10.4 One main effort

Build and demonstrate one protected typed-turn path through the actual backend and an identified browser client. Required evaluation controls release. Outcomes are approved useful text, deliberate approved fallback, or explicit bounded failure. Start with full-response buffering. Granular streaming waits for evidence that required checks can safely operate on partial content.

### 10.5 Contain now

Identify current deployed revision and logging configuration; use synthetic conversations while handling remains unresolved; test normal/error diagnostic paths in a controlled environment; establish historical retention/access ownership without exposing member text; verify a restricted application access boundary. Historical-log handling is a separate owner decision, not a recommendation for broad reading or deletion.

### 10.6 Five-session dependency plan

| Session | Task and why now | Evidence required | Unlocks |
|---|---|---|---|
| 1 | Identify build; adopt release/crisis precedence; capture failing fixture | Revision/configuration, policy, reproducible synthetic failure | Bounded implementation objective |
| 2 | Candidate-specific release control | Rejected content absent from text/TTS; permitted behavior preserved | Meaningful fault testing |
| 3 | Bounded retries/failures and independent media | Attempt limits, deadlines, terminal states under faults | Reliable demonstration path |
| 4 | Browser observation, timing, diagnostic leak tests | Rendered result, terminal state, timings, sentinels | Member-facing claims within tested scope |
| 5 | Reproduce identified build and preserve evidence | Repeat test output, browser evidence, limitations, repository links | Module 4 submission |

If frontend access is unavailable, use a minimal test client but label it as such. If credentials/access are unavailable, mocks can establish control logic only. Exact hours and due date remain dependencies, not assumed unlimited capacity.

### 10.7 Maintain, defer, remove

MAINTAIN persona distinctions, useful permitted conversation, appropriate outside support, meaningful fixtures, honest session-history language, and Mike's policy/release authority. DEFER memory, dashboard, Atelier expansion, additional confidantes, expanded analytics, and sophisticated streaming. REMOVE “wire all services,” maximum test count, fastest any-output, no visible errors, and complete institution this week as success metrics.

### 10.8 Latency decision

Latency is a FAILURE-CONTAINMENT ISSUE for indefinite waits, a SUPPORTING MEASUREMENT for acknowledgment/approved text/audio/completion, and a LATER OPTIMIZATION for normal speed. It is not yet demonstrated as the binding constraint. Promote it only when the protected path works and measured delay materially defeats the intended interaction. No universal neurological threshold is established.

### 10.9 Exact acceptance tests

Before execution, record numeric model/evaluator/media/whole-turn limits. These are chosen prototype settings, not biological facts. Use synthetic fixtures. Observe text transport and TTS submissions as well as browser state.

| Test | Required result |
|---|---|
| Rejected candidate | Zero rejected candidate content reaches browser output or TTS payload; approved fallback/error terminates turn. |
| Appropriate support | Support survives evaluation and reaches browser; persona preservation does not remove it. |
| Mixed violation/support | Support phrase is not blanket exemption; final permitted result resolves violation and preserves appropriate support. |
| Classifier failure | No silent low-risk assumption; adopted failure branch, no release with skipped required checks. |
| Gate exception/timeout | No unchecked candidate release; approved fixed fallback or explicit failure within bound. |
| Model error/empty/stall | Visible bounded result; no indefinite thinking state. |
| Regeneration failure | At most one regeneration, independently evaluated; second rejection/error terminates deliberately. |
| TTS stall | Approved text/core completion independent; accurate media status; late media cannot reopen completed turn. |
| Avatar failure | Identified browser still displays approved text/completion or explicitly documents tested limitation. |
| Browser completion | Observe specific turn's rendered result and terminal state; server send alone fails criterion. |
| Logging sentinels | Synthetic member/assistant/provider-error sentinels absent from captured diagnostics; intentional browser delivery excluded. |
| Repeat execution | Run declared suite twice from fresh process with same revision/configuration; report counts/nondeterminism. |
| Build identity | Tested and demonstrated revision/configuration match; deployed claims additionally require deployment evidence. |
| Candidate transformation | Changed candidate cannot inherit unrelated approval; inspect transformed speech content for lost policy meaning. |

These are proposed tests, not results. They do not prove reliable crisis detection or comprehensive safety.

### 10.10 Commander's intent

PURPOSE: Turn behavioral promises into observable control over one conversational path.

KEY TASKS: Adopt precedence, enforce release, bound failure, preserve approved text through optional-media failure, tie browser evidence to build.

END STATE: Synthetic demonstration shows permitted delivery, rejected-content containment, and deliberate failure in a reproducible build.

CONSTRAINTS: No confidential test data, no unchecked release when required evaluation fails, no suppression of appropriate human support, no unsupported production claims, no expansion into memory.

### 10.11 Proposed coding-agent mission order

OBJECTIVE: Implement the protected-turn contract in an isolated identified development build.

BOUNDARIES: Preserve persona distinctions. Do not deploy/change infrastructure/read sensitive logs/decide crisis policy. Escalate policy ambiguity to Mike.

ACCEPTANCE: Satisfy the matrix above, including browser observation and content-minimized diagnostics.

ARTIFACTS: Changed files, exact revision, configuration identity without secrets, commands/results, before/after fixture, browser evidence, timing, limitations.

STOP: Contract demonstrated, or explicit blocking policy/access dependency identified. Do not add subsystems merely because time remains. This mission order is proposed, not executed or newly authorized by export.

### 10.12 Evidence package

Preserve full commit and working-tree differences; demonstrated/deployed build identity as applicable; configuration and policy versions without credentials; original synthetic failing fixture and corrected result; exact test commands/counts/repeats; turn-linked browser evidence; stage-defined timing; logging sentinels; real versus mocked/unavailable/stalled vendors; known misses/untested paths; repository links to implementation/tests/runtime description.

An instructor should be able to distinguish observation from plan without a verbal correction from Mike.

### 10.13 Proposed release conditions

| Exposure | Minimum criteria for Mike's decision |
|---|---|
| Instructor demo | Synthetic data, known build, limitations, protected release, bounded failure, observed browser. |
| Trusted prototype | Restricted access, clear scope, controlled diagnostics, recovery, finding-capture process. |
| Prospect | Verified application access, demonstrated failures, accurate claims, unnecessary content logging resolved. |
| Sensitive real-user test | Identity/separation, understood retention/access/data flows, suitable consent/response procedure, appropriate outside review for claims beyond technical evidence. |
| Persistent memory | Permission-bounded writes/retrieval; inspectable/correctable/redactable/deletable records; revoked influence tests. |
| Paid membership | Evidence for promised experience; operational ownership/support/incidents; sustainable operation; controls for every offered capability. |

These are recommendations, not approvals. Payment does not reduce requirements. Course demonstration does not authorize broader exposure.

### 10.14 Stop rule and next constraint

Stop scope expansion when policy is explicit, mechanism enforces it, failure is bounded, tests reproduce it, browser outcome is observed, build identity is known, and limitations are documented. Preserve the result.

Next likely constraint: evaluator quality, unless measured delay or failure frequency proves more limiting. Test ordinary permitted behavior, support, violations, mixed content, ambiguity, and component failures. More imports or tests do not establish constraint migration.

## 11. Unknowns requiring additional evidence

1. Exact current deployed commit, configuration, and local commit status.
2. Whether reported production verbatim/error logging has stopped.
3. Historical log retention, access, and session exposure, without broadly exposing content.
4. Number of real/prospect sessions, use of demo/unlock paths, and present traffic.
5. Current Simli legacy response fields, lifetime, and any long-lived returned credential.
6. Current frontend source, render behavior, acknowledgment, voice/avatar fallback, bounded errors.
7. Actual model, buffering, regeneration, speech, and completion latency.
8. Adopted crisis precedence and whether any code still treats weight as severity.
9. Gate false-positive/false-negative behavior beyond known fixtures.
10. Which checks need full context and which could operate cumulatively.
11. Current vendor spend, founder time, exact deadline, access and testing capacity.
12. Whether newer changes already resolve any audited issues.
13. Real database schema, RLS, member-scoped queries, and future retrieval contracts.
14. Full reconciliation of 122 reported tests with 52 independently executed unit tests.
15. Real transport security and infrastructure-level controls; encrypted stored memory cannot be inferred to secure live transport, and vice versa.

If production is not running the inspected/reported build, runtime conclusions must be reassessed against the running revision. New evidence may move priorities; it must not be silently assumed.

## 12. Continuity chain and final quality control

CONTROL: Persona iO cannot fully control vendor output, availability, network behavior, or member disclosure because those actors and conditions sit outside the backend's authority.

RESILIENCE: Even when a dependency fails, a useful permitted result, deliberate fallback, or explicit bounded failure must remain possible.

OPTIONALITY: The objective can survive through approved text when optional media fails, but this must be demonstrated in the browser.

BOTTLENECK: The working binding constraint is demonstrated policy-correct release authority over a complete turn.

INTERFACE POWER: Trust depends disproportionately on policy decision to irreversible release, with browser observation needed to establish delivery.

SELECTION: Invest in one protected-turn slice and independent exposure containment; defer persistence and breadth.

RELEASE: Preserve persona, agency, useful communication, and support continuity while releasing module-count and fastest-output success metrics.

TRANSMISSION: Carry intent through executable acceptance tests, explicit precedence, runtime/protocol documentation, and build-linked evidence.

What must remain true if everything changes: the member can receive useful permitted communication, understand failure, and exercise appropriate control over information. The form that needs less protection is the current collection of staged modules and implementation choices. The project need not carry inflated live-capability claims, stale examples, or full-institution scope into Module 4. What deserves preservation is policy intent, known counterexamples, persona distinctions, and reproducible evidence that might otherwise disappear into conversations or founder memory.

The highest-value mission available from the current codebase is a narrow, observable protected-turn prototype. It can establish the development playbook without claiming a complete confidante institution.

ONE VARIABLE TO WATCH: the outcome distribution of started synthetic turns classified as approved useful delivery, deliberate fallback, explicit bounded failure, unchecked release, or unresolved turn, tied to build and browser evidence. If a single scalar is necessary, track the fraction reaching a policy-compliant browser-visible terminal outcome within the adopted bound, but retain categories so excessive fallback cannot masquerade as useful improvement. This is a proposed engineering measure, not a welfare metric.

Quality-control corrections applied: files were not treated as capabilities; documentation was not treated as code; local was not treated as production; prompt influence was not treated as control; tests were not treated as deployed enforcement; transport and storage privacy were not conflated; imagined fallbacks were not called reachable; future memory was not called live; safeguard costs and shortcut functions were identified; unobserved browser results and current deployment remained unknown.

The headline says an AI confidante prototype. The system underneath it is about preserving useful communication and member agency through controlled release, bounded failure, and evidence that follows the build.

Mike should next approve the bounded protected-turn policy and acceptance contract, then authorize one implementation cycle that produces the evidence package before expanding scope.
