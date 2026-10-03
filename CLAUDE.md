# Operating doctrine — Persona iO backend

Standing rules for any Claude session working in this repository. They apply
unless a task brief explicitly overrides them. A brief should carry the mission;
this file carries the rules that are the same every time.

Each rule below was extracted from prior task briefs in this repository, not
invented. Where a rule exists because something actually went wrong, the failure
is named.

---

## 1. Start from the real state, not a summary

Before changing anything, check the repository directly: branch, HEAD, and
`git status`. Confirm you are in the repository you think you are in.

Treat handoff notes, prior reports, and remembered line numbers as claims to
verify, not facts. If what you find differs materially from what you were told,
say so before proceeding.

*Why:* a prior session's harness wrote its evidence into a different repository
because a path was assumed rather than checked. The next session searched the
correct repository, found nothing, and nearly reported that the work had never
been done.

## 2. Stay inside the stated scope

Do only what the brief asks. If you notice an adjacent problem, report it;
do not fix it in the same run. Do not refactor unrelated code.

If you cannot complete part of the scope, finish everything else and say plainly
what you left out and why. Narrowing the work is the requester's call.

## 3. Irreversible and outward-facing actions need explicit authorization

Never deploy. Never push. Never merge. Never force-push.

Do not commit unless the brief asks for a commit. When it does, stage by explicit
path. Never `git add .` or `git add -A`.

If you believe one of these should happen, recommend it and stop.

*Note:* across the briefs reviewed, deployment was never once authorized, so
treat any deployment request as unusual and confirm before acting.

## 4. Evidence means the system, not your own account of it

Prefer diffs, test output, build logs, runtime observation, screenshots, and
git state over your own description of what you did.

Label every meaningful claim as one of:

- **verified** — you ran it or read it directly, this session
- **reported** — a document or prior run says so, unconfirmed by you
- **inferred** — reasoned from evidence, going beyond what you observed
- **unknown** — the available evidence cannot settle it

**UNKNOWN is an acceptable answer.** Do not manufacture confidence to avoid it.
Do not describe something as working, fixed, or safe when you have only shown
that a particular check passed in a particular environment.

## 5. Your own tests are not proof

Tests you wrote encode what you already believed, so they cannot contradict you.
A passing suite you authored is evidence that your idea is self-consistent, not
that it is correct.

Before claiming an objective is met, say what an independent check would have to
look at. Where a second reviewer or a clean-checkout rerun is available, prefer it.

*Why:* on one task an implementation passed 184 self-authored checks and was
reported complete. An independent review of the same artifacts returned 13
findings, 6 of them serious. None had been caught by the 184 checks.

## 6. Capture the failure before you fix it

When fixing a defect, first reproduce it and save that evidence. Then fix it.
Then show the same check passing.

A fix with no recorded failing state cannot be distinguished later from a test
written to match the code.

## 7. Never expose secrets

No API key, token, credential, or `.env` value may appear in code, logs,
screenshots, commit messages, reports, or your replies. Refer to them by variable
name only.

You may read a credential from the local environment to run a test. You may not
print it. When checking whether a secret leaked somewhere, report a yes/no or a
count, never the value.

## 8. Never use real member conversations

Use synthetic fixtures for all testing. Do not read production logs. Treat any
real conversational content as off-limits for examples, tests, and reports.

## 9. Leave a durable record

Write run evidence to `agent-runs/<date>-<slug>/`. This repository already
follows that convention.

The record should let a session with no prior context continue: what was intended,
starting branch and HEAD, what changed, where the direct evidence is, what was
verified and how, what remains unresolved, and the next action.

Write it so it survives without the chat it came from. If a run produces only
screenshots and JSON with no written summary, it is not readable later — several
earlier runs have that problem.

## 10. Choose your own method; do not widen your own authority

How you investigate, what order you read files in, which debugging approach you
take, and how you adapt when something does not work are yours to decide.

Changing what you are *permitted* to do is not. Expanding scope, committing when
not asked, or deploying are authority changes and require the requester.

If following the brief's stated method looks wrong, you may use a better method
inside the same boundaries. Say that you did and why.

## 11. Stop rather than guess across a consequential boundary

Stop and report, rather than improvising, when:

- the repository is not in the state the brief assumes
- a stated precondition is false
- completing the task would require an action from section 3
- the evidence does not support the conclusion you were asked to reach
- you would have to fabricate a number, result, or citation to continue

A run that stops with a clear explanation is a successful run.

---

## Where verification lives

`npm test` runs the full suite (`test-mra.js`, `test-runtime.js`,
`test-release.js`). Run it from a clean state; a leaked child process from a
previous run can make the next run fail for unrelated reasons.

There is no CI in this repository. Every test result is produced and reported by
the same session that wrote the code. Section 5 exists because of that.
