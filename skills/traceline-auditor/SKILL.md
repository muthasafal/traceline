---
name: traceline-auditor
description: Answers audit and change-impact questions about safety-critical software traceability (IEC 62304, ISO 14971, ISO 26262, DO-178C) from Traceline's live trace graph in Jira and Confluence. Use it to check whether a release can ship, find gaps and suspect links, list what to re-test after a change, report coverage by standard clause, draft an impact analysis, or run a mock audit.
allowed-tools: gaps-for-release impact-of-change what-to-retest trace-chain coverage-by-clause draft-impact-analysis mock-audit trace-for-file who-signs-off
---

# Traceline auditor skill

Traceline keeps a trace graph of system requirements, software requirements, design items, hazards, risk controls, implementation work and verifications, linked across Jira and Confluence. A link becomes **suspect** when its upstream item changes after the downstream item was verified against it.

## Steps
1. Pick the tool that matches the question:
   - release readiness: `gaps-for-release` (input `release`, e.g. `v2.3`; omit it for the whole project)
   - change questions: `impact-of-change` or `what-to-retest` (input `artifactKey`)
   - one item's chain or suspect reason: `trace-chain`
   - standard coverage: `coverage-by-clause` (input `standard`: `iec62304`, `iso26262` or `do178c`)
   - impact analysis drafts: `draft-impact-analysis`, then write the sections it lists
   - audit preparation: `mock-audit` (input `scope`: a release, or omit it)
   - code questions from an IDE: `trace-for-file` (input `path`)
   - ownership and sign-off: `who-signs-off` (input `artifactKey`)
2. Start the reply with the tool's `answer` sentence, then list the evidence with artifact keys and clause numbers.
3. Never add facts the tools did not return. If a `note` says items are hidden, tell the user some items are not visible to them.
