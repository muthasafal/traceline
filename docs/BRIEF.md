# Traceline: Product and Technical Brief

This is the source of truth. Steering and specs derive from it. Build starts Dec 9; the Codegeist deadline is **Dec 22, 12:00 PM PT**.

---

## 1. One line
**Your audit-ready design history, kept alive by the Teamwork Graph.** Traceline gives teams building safety-critical software living traceability inside Jira and Confluence:
- it flags gaps and stale evidence the moment they appear
- a Rovo auditor agent answers the questions an auditor will ask.

## 2. The problem (domain primer for the agent)
- **The rules:** medical-device software in the EU, the US, India and elsewhere is built under **IEC 62304** (the software life cycle), **ISO 14971** (risk management) and **ISO 13485** (quality system; the US FDA's QMSR now aligns with it).
- **What auditors demand: traceability.** Every link in these chains must exist and be current:
  - system requirement → software requirement → architecture/design item → implementation (code changes) → verification (tests that pass)
  - hazard → risk control measure → the requirement that implements it → its verification.
- **The software safety class** (IEC 62304 §4.3) sets how much is required:
  - **Class A:** no injury possible
  - **Class B:** non-serious injury possible
  - **Class C:** death or serious injury possible
  - Class C needs detailed design and unit verification evidence for every unit; Class A needs much less.
- **How teams do it today:**
  - Requirements live in Confluence, work in Jira, code in Bitbucket or GitHub, and tests in Jira (or a test plugin).
  - The **traceability matrix is maintained by hand in spreadsheets** right before an audit.
  - It goes stale the day it's finished. When a requirement changes, nobody knows which tests need re-running.
  - Audit findings on traceability are among the most common nonconformities.
- **Existing tools** (Ketryx, Matrix Requirements, IBM DOORS, Jama) show the market pays for this, but they're expensive, heavy, and live **outside** where the team works.
- **Gap:** native, always-on, AI-assisted traceability inside Atlassian, with **no data leaving Atlassian**.
- **The same pattern applies to:** automotive (**ISO 26262**, ASIL A to D), avionics (**DO-178C**, DAL A to E) and railway (EN 50128). These are delivered as "standard packs".

## 3. Who it's for
- **Software leads and quality/regulatory engineers** at medtech startups and scale-ups using Jira and Confluence.
- **Developers:** they want to know "what must I re-test if I change this?" without leaving their IDE (the MCP server).
- **Auditors:** they need evidence fast, during audit prep and on the day itself.

## 4. Hackathon constraints (Codegeist 2026)
- **Category:** Apps for Specialized Industries.
- **Bonus prizes** (each needs its write-up and a demo in the video):
  1. **Rovo agents:** a `rovo:agent` with reusable `rovo:skill` and `action` modules.
  2. **Atlassian MCP:** a `rovo:mcp` module exposing tools.
  3. **Teamwork Graph:** consumes data from the Teamwork Graph API (and connects data into it if feasible).
  4. **Marketplace:** published, or submitted for listing (the review ticket link is enough).
- **Judges install the app from an installation link onto their own test site.** It must:
  - work on an **empty site**, hence the in-app **"Load sample project"**
  - include step-by-step setup instructions (enable Rovo; grant Teamwork Graph scopes).
- **Video:** under 5 minutes, public on YouTube, end to end, covering every bonus feature.
- **Judging, 20% each:** Technical implementation (not a shallow wrapper or a single hardcoded path), Design (complete product), Impact (credible real audience), Innovation, Presentation.
- **Lessons from 2025's winners:**
  - polished, practical, permission-aware, Rovo built in
  - unglamorous but painful workflows win in Specialized Industries
  - "Compliant Workflows for Jira" placed 3rd there; **we must look clearly more novel**, through living traceability, suspect links, AI impact analysis and MCP for developers.

## 5. Platform facts (Forge, Nov 2026; verify module keys in the docs before coding)
- **CLI:** `@forge/cli` 16.x (installed). Node.js runtime. Run `forge create`, `forge deploy`, `forge install`, `forge tunnel` in a real terminal (they prompt).
- **Rovo modules:**
  - `rovo:agent`
  - `action` (the tools the agent and MCP call)
  - `rovo:skill` (Preview)
  - `rovo:mcp` (Preview)
  - `rovo:agentConnector`
- **`rovo:mcp`** lists action keys as `tools`. External MCP clients connect at `https://mcp.atlassian.com/forge/<appId>` after a site admin enables each tool (Atlassian Administration → Apps → Sites → Connected apps) and completes OAuth.
  ```yaml
  modules:
    rovo:mcp:
      - key: traceline-mcp
        name: Traceline
        tools: [trace-for-file, impact-of-change, gaps-for-release]
    action:
      - key: impact-of-change
        name: Impact of a change
        function: actions
        actionVerb: GET
        inputs:
          issueKey: { title: Issue key, type: string, required: true }
    function:
      - key: actions
        handler: index.actions
  ```
- **Teamwork Graph API (Preview):**
  - new apps use curated queries or **persisted Cypher queries** (registered in the TWG Query Builder; the returned `queryKey` is called with `customQuery(queryKey, params, first)`)
  - `api.asUser().requestTeamworkGraph(...)`; one scope per object type per hop (for example `read:graph:issue:jira`, `read:graph:page:confluence`)
  - **a missing scope returns EMPTY results with no error,** so always detect "suspiciously empty" and fall back to the Jira and Confluence REST APIs, showing a setup hint.
- **Forge LLMs** cost money (no hackathon credits). **Use Rovo for the AI.** Any non-agent summarisation is done deterministically, or through the Rovo agent.
- **Egress:** none. All compute and storage stay on Atlassian (it qualifies as "Runs on Atlassian", which is a selling point for regulated buyers).
- **Storage:** Forge SQL for the trace graph cache (relational, which fits); Forge KVS for settings.
- **Triggers:** product events (Jira issue created, updated, linked; Confluence page updated) and a scheduled trigger (nightly full recompute).
- **UI:** UI Kit for issue panels (native look); Custom UI (React + Atlassian design tokens) for the cockpit and matrix.

## 6. Domain model
**Artifact types**, mapped onto Atlassian objects; the mapping is configurable in settings and has sensible defaults:
| Traceline type | Default Atlassian representation |
|---|---|
| System requirement (SYS) | Confluence page with label `sys-req` + page properties (ID, title, safety class) |
| Software requirement (SRS) | Confluence page with label `sw-req` or a Jira issue type "Requirement" |
| Design item (DES) | Confluence page labelled `design` |
| Hazard (HAZ) | Jira issue type "Hazard" (fields: severity, probability, risk level) |
| Risk control (RC) | Jira issue type "Risk Control" |
| Implementation (IMP) | Jira Story/Task + its development info (commits, PRs) |
| Verification (VER) | Jira issue type "Test" with status/result fields, or test results imported via a CSV upload |

**Links:**
- Jira issue links of types `implements`, `verifies`, `mitigates`, `derives from`
- Confluence ↔ Jira via remote links or smart links, plus a `trace:` page-property row
- the app also stores a normalised edge table.

**Forge SQL schema (outline):**
```
artifact(id, kind, source:"jira|confluence", sourceId, key, title, safetyClass, version, updatedAt, status)
edge(fromId, toId, rel:"derives|implements|verifies|mitigates|designs", createdAt, verifiedAgainstVersion)
evidence(artifactId, kind:"test-result|review|pr", result, at, ref)
suspect(edgeId, reason, since, clearedBy, clearedAt)
standard_clause(standard, clause, title, requiredFor:"A|B|C", rule)
snapshot(releaseId, createdAt, coverageJson)
```

**Suspect links** (an idea from IBM DOORS; a core feature):
- When an upstream artifact changes **after** a downstream verification passed (the version changed, or it was edited after `verifiedAgainstVersion`), mark the edge **suspect**.
- Show it everywhere until someone re-verifies, or clears it with a recorded justification.

**Gap rules for each standard pack (IEC 62304 example):**
- every SRS has ≥ 1 VER that passed against its current version
- every HAZ has ≥ 1 RC; every RC has ≥ 1 implementing SRS and ≥ 1 passing VER
- Class C: every SRS traces to a DES item; units have unit verification evidence
- no open suspect links in a release you mark "ready".

## 7. Features
1. **Jira issue panel, "Trace":**
   - the chain upstream and downstream with **plain-text statuses** ("verified", "missing test", "suspect since 12 Dec")
   - quick-link actions; a "why is this suspect?" explanation.
2. **Workflow validator:** blocks moving an issue that implements a Class B or C requirement to Done without a linked passing verification. The message says exactly what's missing.
3. **Confluence macro, "Traceability matrix":**
   - a live matrix for a space or release, with filters (class, status, standard clause)
   - gaps highlighted
   - **export a Design History File bundle** (PDF via pdf-lib in the browser + CSV) with the evidence list and timestamps.
4. **Compliance cockpit (Jira global page):**
   - coverage for each standard clause
   - gaps by type
   - suspect links over time
   - the **release gate**: "Can we ship v2.3?" answered green or red, with a list of blocking items and evidence links. Snapshot it for the audit trail.
5. **Rovo agent, "Auditor":** its instructions make it a calm, precise regulatory assistant that cites artifact keys. Its actions (reusable `action` modules, packaged into a `rovo:skill`):
   - `gaps-for-release(release)`
   - `impact-of-change(artifactKey)`: everything downstream that must be re-verified
   - `trace-chain(artifactKey)`
   - `coverage-by-clause(standard)`
   - `draft-impact-analysis(artifactKey)`: returns structured facts for the agent to write the analysis
   - `mock-audit(scope)`: generates likely auditor questions from the current gaps
6. **MCP server (`rovo:mcp`)** for IDE assistants (Claude Code, Cursor, Kiro):
   - `trace-for-file(path or component)`: requirements implemented by the code area (via PR, commit and issue links)
   - `impact-of-change(issueKey)`
   - `gaps-for-release(release)`
   - `what-to-retest(issueKey)`
7. **Teamwork Graph:**
   - persisted queries traverse issue ↔ page ↔ PR ↔ person ↔ team, to find owners ("who signs off on this requirement?") and cross-product links, with REST fallback
   - stretch: a connector that pushes Traceline's verification evidence into the graph.
8. **Standard packs:** IEC 62304 (full), plus ISO 26262 and DO-178C (clause maps and gap rules, lighter).
9. **"Load sample project":** one click creates a clearly labelled **sample** project:
   - "Sample: Infusion pump controller v2.3", Class C
   - about 15 system requirements, 30 software requirements, 8 hazards, 10 risk controls, 35 stories, 40 tests
   - a few **deliberate gaps and one suspect link** to show the value
   - also seeds Confluence pages
   - a "Remove sample data" button cleans it up.
10. **Settings:** artifact mapping, link types, standard pack, safety classes, a validator toggle.

## 8. UX and design
- **Atlassian-native:** use the Atlassian Design System tokens and UI Kit components so it feels built in. Plain-text statuses, clear empty states, and every number in a sentence that explains it.
- **One signature moment:** the **trace chain** visual in the issue panel and cockpit. A horizontal, readable chain of artifacts, each node showing its status. Suspect links pulse once, then stay marked.
- **Accessibility:** keyboard-navigable, with screen-reader labels for matrix cells.

## 9. Engineering
**Repo structure:**
```
traceline/
  .kiro/ (optional for Codegeist, still recommended)
  docs/BRIEF.md
  manifest.yml
  src/resolvers/        Forge functions: triggers, actions, resolvers
  src/domain/           pure TS: graph model, gap rules, suspect logic, standard packs
  src/storage/          Forge SQL repo + migrations, KVS
  src/twg/              Teamwork Graph queries + REST fallback
  static/cockpit/       Custom UI React app
  static/matrix/        Custom UI React app (Confluence macro)
  src/frontend/         UI Kit issue panel
  test/                 jest + fast-check
```

**Tests:**
- property tests for the domain:
  - adding a passing verification never increases gaps
  - editing upstream after verification always creates a suspect edge
  - clearing a suspect edge requires a justification record
  - the gate is green **iff** there are no blocking gaps
- unit tests for every gap rule
- an integration test of the sample seeder against a dev site.

**Performance:** incremental updates on events; a nightly full recompute; paginate Jira and Confluence calls; stay within invocation time limits (use async events for long seeding jobs).

## 10. Submission checklist (Dec 22)
- [ ] Installation link plus detailed judge instructions: install; enable Rovo; grant TWG scopes; click "Load sample project"; where to find each feature
- [ ] Video under 5 minutes showing: issue panel → suspect link → validator → matrix and DHF export → cockpit release gate → Rovo Auditor → MCP from an IDE → the TWG owner lookup
- [ ] Category: Specialized Industries; all four bonus write-ups
- [ ] Marketplace listing submitted (privacy policy, support contact, listing copy, screenshots)
- [ ] Description, including how it meets the Forge requirement
