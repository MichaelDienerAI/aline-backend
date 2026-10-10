# The Two-Layer Problem

## Why apparent success is not verified success

**Status:** Public case-study draft. This document describes local synthetic observations and an unresolved audit-tooling limitation; it is not a production safety certification.

The Night Shift is a human-directed, AI-agent-assisted development and verification workflow used to investigate Persona iO's Aline backend. Michael directs the requirements, delegates bounded implementation and testing, evaluates the evidence, and retains authority over consequential changes.

### The central distinction

Erving Goffman's distinction between front-stage and backstage behavior in *The Presentation of Self in Everyday Life* offers an analogy, not a software verification theorem: the visible report of an activity is not a complete account of the processes that produced it.

A test can report success while lacking enough evidence to justify its conclusion. The engineering response is to distinguish (1) what the system claims, (2) what the instrument observed, (3) what evidence was required, and (4) what remains unknown.

### Observed case: authorization versus outbound speech

In historical local, provider-mocked tests of Aline, spoken-text normalization was applied before authorization and again before the outbound text-to-speech request. In a documented fixture, the policy evaluated `# A gentle thought.` while the outbound request contained `A gentle thought.`. The representations differed across an authorization boundary.

A subsequent correction at commit `c99d01f490e23c957a426fe34a74ea6c37e3923a` made normalization stable before approval. Recorded bounded fixtures supported matching authorized and outbound speech text. These records do not establish production deployment identity or universal safety.

### The verifier's blind spot: D5

A later audit altered a *copy of synthetic evidence*: one whole final speech segment was removed from the authorization and request records. The original fixture involved three displayed segments; the altered record retained three display frames but only two authorization/request groups. An audit checker compared the surviving groups, returned `ACCEPT`, and exited successfully.

**The checker returned ACCEPT, but the surviving evidence did not justify a completeness claim.** This shows a weakness in the evidence checker; it does **not** show that real users experienced missing speech.

The defect is mechanistic: matching the records received is not proof that every required record was received.

### Three complementary lenses

- **Erving Goffman — presentation versus process.** A report's public-facing status does not disclose the full process that produced it. This is an analogy, not a historical claim about software engineering.
- **Michel de Montaigne — self-examination and bounded judgment.** The v5 audit raised the possibility that its own instruments shared an omission blind spot. That broader possibility was identified by inspection, not confirmed by the separately proposed negative-control experiment.
- **Albert O. Hirschman — exit, voice, and loyalty.** In *Exit, Voice, and Loyalty* (1970), Hirschman examines how dissent and alternatives affect institutions. Applied here as a contemporary analogy, a verifier's dissent must be able to challenge acceptance. An enforceable `FAIL`/`INCOMPLETE` gate has been proposed but not implemented.

These are applications of historical ideas, not claims that those authors developed or anticipated this particular engineering approach.

### An engineering rule

A system can correctly evaluate every record it receives while failing to establish that it received every required record.

For a **declared test scope**, a proposed improvement is to write an expected-event ledger independently of the records being checked, have a qualified reviewer inspect it, freeze it before a future run, and reconcile it against observed authorization and request events. A three-verdict checker would distinguish `PASS`, `FAIL`, and `INCOMPLETE`. Both adverse outcomes would block acceptance.

**That ledger has not yet been independently reviewed, frozen for a new run, or implemented.** A frozen hash would detect subsequent change, not prove that the expected events were correctly specified.

### Five questions for future investigations

1. What does the system claim happened?
2. What did the instruments actually observe?
3. What must have been observed within the declared test scope?
4. What counterexample could defeat the reported conclusion?
5. What decision authority, if any, does incomplete evidence justify?

These questions are an author's synthesis of the investigation, not a quoted historical framework.

### Limits and next steps

- The historical fix and audit observations concern finite, local, synthetic, provider-mocked tests.
- The D5 omission was introduced in a preserved evidence copy; it is not a report of real user-facing speech loss.
- The proposed evidence-completeness correction remains **unimplemented**.
- External human critique for the next SMU Module 6 iteration remains pending.
- Production source/build/deployment provenance remains unverified. No production release is recommended by this case study.

**Status of this page:** Documentation draft published on a review branch; not an assertion that the broader Night Shift documentation package or an Iteration 3 implementation has been reviewed or released.
