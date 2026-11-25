# Build status (2026-11-25, checkpoint)

## Built and verified on muthasafal.atlassian.net (development environment)
- **Deployed and installed** in Jira and Confluence. Version 2.x qualifies for "Runs on Atlassian".
- **Domain layer** (`src/domain/`): 38 vitest + fast-check tests pass (`npm test`), covering all four BRIEF section 9 properties.
- **Sample loader** (Jira global page: Apps → Traceline, Dev):
  - Created project PUMP and Confluence space PUMPSAMPLE: 150 artifacts.
  - It found exactly the 6 planned gaps and 3 suspect links.
  - Release gate: "Not yet: v2.3 has 9 blocking items, including 3 suspect links."
  - Jira link direction is correct; Confluence pages appear as remote links.
- **Issue panel "Trace"** (on PUMP-4): chain, plain-text statuses, suspect explanations and actions, and the §5.7 gap.
- **Product triggers**: editing PUMP-3's description logged `version bump PUMP-3 {"newSuspects":3}`, and the panel showed the 3 new suspect links.

## Waiting on the user (manual)
1. **Add the validator to PUMP's Done transition**, then test it:
   - Go to Project settings → Workflows (`/plugins/servlet/project-config/PUMP/workflows`), edit the workflow, and select the transition into Done.
   - Under Rules, add the rule (validator) "Requires passing verification (Traceline)". Save and publish.
   - Try moving **PUMP-69** (IMP-021, which implements SRS-021, whose test is failing) to Done. It should be blocked with a Traceline message.
2. Not yet tested by hand: "Record pass/fail" on a test issue, "Mark link reviewed", "Clear with justification", and "Remove sample data".

## Known issues
- The `jira:adminPage` link from `forge install` returns 404. The same UI is on the global page (`/jira/apps/<appId>/<envId>`). Check the admin page URL, or drop the module.
- The trace chain is wider than the issue panel (horizontal scroll). Consider a compact mode.
- The seed job does not log its steps; progress is only visible in the UI.

## Next, in order (BRIEF section 7)
1. Confirm the validator works (above).
2. Rovo Auditor agent: `rovo:agent` plus `action` modules packaged as a `rovo:skill`. The domain functions already exist: `evaluateGate`, `impactOfChange`, `traceChain`, `evaluate().coverage`, `draftImpactFacts`, `mockAudit`.
3. `rovo:mcp` tools: trace-for-file (`traceForPath`), impact-of-change, gaps-for-release, what-to-retest.
4. Compliance cockpit as Custom UI on the global page: clause coverage, suspect timeline (`repo.suspectTimeline`), release gate with snapshot (`repo.saveSnapshot`). Keep the sample loader on it.
5. Confluence matrix macro with DHF export (pdf-lib + CSV).
6. Teamwork Graph owner lookup (persisted Cypher via `requestTeamworkGraph`, with REST fallback and a setup hint).
7. README judge instructions; Marketplace listing (ask the user first).

## How to resume
- Forge credentials live in `Hackathon\.env` (FORGE_EMAIL, FORGE_API_TOKEN).
- **Always run Forge through the wrapper. Never run bare `forge` in the sandboxed Bash tool**: its credential-file check fails there and deletes the saved login.
  ```powershell
  & C:\Users\notch\OneDrive\Desktop\Hackathon\forge.ps1 lint --non-interactive
  & C:\Users\notch\OneDrive\Desktop\Hackathon\forge.ps1 deploy --non-interactive -e development
  & C:\Users\notch\OneDrive\Desktop\Hackathon\forge.ps1 install --non-interactive --upgrade --site muthasafal.atlassian.net --product jira -e development
  & C:\Users\notch\OneDrive\Desktop\Hackathon\forge.ps1 logs -e development --since 15m --non-interactive
  ```
- Tests and type checks: `npm test` and `npm run typecheck`.
- Issue key map for the sample: SRS-n = PUMP-n (1–30); HAZ = PUMP-31..38; RC = PUMP-39..48; IMP = PUMP-49..83; VER = PUMP-84..123.
- App URL: `https://muthasafal.atlassian.net/jira/apps/93b72ef4-1337-46ac-b78e-3cbad7877ede/e0df3588-2233-468f-8d44-6209ee33c18d`
