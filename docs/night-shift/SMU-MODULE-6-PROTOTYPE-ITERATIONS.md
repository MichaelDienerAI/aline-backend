# Persona iO — Iterative Prototype Development

**SMU Creative Technology Capstone | Prototype iteration and production potential**

**Project repository:** [aline-backend](https://github.com/MichaelDienerAI/aline-backend)  
**Related research case study:** [The Two-Layer Problem](the-two-layer-problem.md)  
**Project role:** Michael Diener — product direction, behavioral requirements, agent briefs, evidence design, review, and approval; AI coding agents assisted with implementation and testing.

> **Scope statement.** This page documents two bounded prototype states and the continuing evaluation of Persona iO. The recorded tests used synthetic inputs and mocked providers. It does not claim that the current production deployment is identified, that all safety mechanisms are enforced in production, or that the prototype is production-ready.

## 1. Project and iterative-cycle approach

Persona iO explores conversational AI confidantes with on-screen and synthesized speech. The Aline backend includes a WebSocket conversational pipeline. The prototype addresses not only how an AI companion responds, but whether the spoken representation crossing the delivery boundary agrees with the version reviewed by its behavioral-release mechanism.

Development uses **The Night Shift**, a human-directed workflow:

**Define requirement → delegate bounded work → run synthetic tests → challenge evidence → human review → decide next iteration.**

This sequence is dispatched manually. It is not an unattended autonomous orchestration system.

## 2. Prototype iteration A — historical behavior and problem discovery

**Source revision:** [`7b1034af35a54de42060a8a1a27a84de58e3654a`](https://github.com/MichaelDienerAI/aline-backend/commit/7b1034af35a54de42060a8a1a27a84de58e3654a)

The original spoken-text pipeline could apply a normalization operation *after* behavioral authorization. A documented synthetic fixture produced:

| Boundary | Captured text |
|---|---|
| Approved spoken representation | `# A gentle thought.` |
| Outbound text-to-speech request | `A gentle thought.` |

The two representations differed. That matters because authorization of one representation does not automatically authorize a transformed version. The original behavior was reproduced under bounded local provider mocks. A separate synthetic masked-refusal example revealed that this general mismatch could also affect a safety-relevant phrase; no production occurrence is established by those tests.

**Design lesson:** inspect the *actual approval and outbound request values*, not only a reconstructed prediction of what a normalizer should produce.

## 3. Prototype iteration B — stabilized normalization and verification

**Source revision:** [`c99d01f490e23c957a426fe34a74ea6c37e3923a`](https://github.com/MichaelDienerAI/aline-backend/commit/c99d01f490e23c957a426fe34a74ea6c37e3923a)

The change makes spoken normalization reach a stable representation before authorization. In the recorded local synthetic fixture set, comparisons of captured policy-approved text against captured outbound TTS text improved from **2/6 matching fixtures at baseline** to **6/6 at the corrected revision**.

The corrected revision's recorded test suites reported:

| Test suite | Recorded result |
|---|---:|
| Unit | 52/52 |
| Runtime | 70/70 |
| Release | 64/64 |

These are bounded reports from preserved local execution records, not tests newly executed for this document. The historical baseline also passed its own release suite despite the boundary defect. Therefore the specific before/after boundary observations, rather than raw pass totals alone, support the correction.

**Design lesson:** passing a broad regression suite is useful for detecting other breakage, but does not substitute for a test of the exact behavioral requirement.

## 4. Additional critique of the verification method — finding D5

A later AI-agent audit challenged the evidence checker itself. In an explicitly altered **copy of a synthetic record**, a final expected speech segment was removed from authorization and outbound request evidence. The record retained **three display frames but only two authorization groups and two request records**. The checker compared surviving captured lists, returned `ACCEPT`, and exited successfully.

This demonstrates a weakness of that audit checker: **internally consistent observations need not constitute a complete observation population**. It does *not* demonstrate that a real member lost speech or that a live service dropped a sentence.

A future bounded verification design has been proposed: predefine a three-event expectation independently from the observed trace, have a qualified reviewer inspect it, bind it to the test fixture, and reconcile every expected event against observed authorization and request evidence. The proposed verdicts are `PASS`, `FAIL`, and `INCOMPLETE`, with the latter two blocking acceptance.

**The expected ledger has not yet been independently reviewed or frozen for a future execution. The enhanced checker has not been implemented.** This is a candidate *next* refinement, not a completed third iteration.

## 5. External critique — current status and next step

External human feedback is a separate assignment requirement. AI-agent auditing is a useful source of technical dissent but **does not constitute an external human critique**. At the time this page was prepared, there was no confirmed external human feedback record. No feedback, quotations, or critique-driven implementation are invented here.

The planned five-minute reviewer demonstration will show: (1) the historical boundary mismatch, (2) the corrected synthetic result, (3) the D5 missing-evidence control, and (4) the proposed bounded verifier response. Review questions will ask what has genuinely been proved, what remains uncertain, which evidence would increase trust, what one change matters most, and how to measure success.

**Next action:** obtain consented reviewer feedback, record the actual comments and the artifacts viewed, select one testable improvement informed by that feedback, and request explicit permission before implementing it.

## 6. Prototype scope and potential for production

The prototype has sufficient technical scope to explore conversational interaction, streamed text, synthesized speech, behavioral evaluation at the inspected source revision, and evidence-based iteration. Its production *potential* comes from having inspectable components and identifiable failure modes, not from claiming completed production qualification.

Key unresolved work includes the D5 evidence-completeness limitation, broader runtime path coverage, independently verified control enforcement, external human validation, and source→build→deployment→recovery traceability. In particular, the source revision currently deployed is **unknown** in the supplied audit records, and the repository root README may describe an older source state.

## 7. What a stakeholder can examine

- [Historical source revision](https://github.com/MichaelDienerAI/aline-backend/commit/7b1034af35a54de42060a8a1a27a84de58e3654a) and [corrected revision](https://github.com/MichaelDienerAI/aline-backend/commit/c99d01f490e23c957a426fe34a74ea6c37e3923a)
- [The Two-Layer Problem](the-two-layer-problem.md), an essay explaining the difference between a passing report and justified confidence
- This iteration report, including the before/after fixture and documented limits

Raw local agent-run files, private execution logs, and any reviewer-identifying details are intentionally excluded from this public page.

## 8. Reflection

The first refinement corrected a mismatch between what the system approved and what it attempted to send. The later audit exposed a second-order weakness: a verifier could report success without accounting for every required observation. Together these findings changed the development focus from **making a particular output correct** to **making claims about correctness inspectable and appropriately limited**.

**Submission status:** Two prototype states documented. External human critique and a critique-driven additional refinement remain pending. This page is a review-branch academic artifact, not a claim that all rubric elements are complete.
