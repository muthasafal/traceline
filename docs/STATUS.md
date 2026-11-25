# Build status (2026-11-25)

## Done
- `docs/PLATFORM.md`: verified Forge manifest keys, events, Forge SQL and Teamwork Graph API.
- `src/domain/`: trace graph, suspect links, IEC 62304 (full) plus ISO 26262 and DO-178C (light) packs, release gate, validator rule, trace-chain statuses, mock audit, impact facts, trace-for-path, and the sample infusion-pump dataset. 38 vitest + fast-check tests pass (`npm test`), covering all four BRIEF section 9 properties.
- `src/storage/`: Forge SQL schema and migrations (BRIEF section 6), a repository, and KVS settings.
- `src/sync/`: Jira/Confluence mapping, incremental sync, full recompute, the sample seeder and its remover.
- `src/index.ts` and `manifest.yml`: issue panel (UI Kit), admin page with "Load sample project", workflow validator, product triggers, nightly trigger, queue consumer, and SQL. The app is registered (the app id is in the manifest).

## Not yet verified (nothing is deployed)
- `forge deploy` and `forge install --site muthasafal.atlassian.net --product jira` (then Confluence), then `forge lint`.
- The Forge CLI in Claude's shell reports "Not logged in" even after Safal's login. Either run `forge login` in the same environment, or set `FORGE_EMAIL` and `FORGE_API_TOKEN`.
- Check on the site:
  - which `issueLink` direction the code assumes (see `linkIssues` in `seed.ts`)
  - the project template creating the PUMP project
  - Confluence space creation
  - the trigger payload shapes (`onLinkEvent`)
  - the validator on a company-managed workflow

## Remaining modules
- Confluence matrix macro with DHF export (Custom UI, pdf-lib).
- Jira global-page cockpit (Custom UI): clause coverage, suspect timeline, release gate plus snapshot. The repo already has `saveSnapshot` and `suspectTimeline`.
- Rovo Auditor agent, with `action` modules and a `rovo:skill`. The domain functions already exist: `evaluateGate`, `impactOfChange`, `traceChain`, `evaluate().coverage`, `draftImpactFacts`, `mockAudit`.
- `rovo:mcp` tools: trace-for-file, impact-of-change, gaps-for-release, what-to-retest.
- Teamwork Graph owner lookup via persisted Cypher, with REST fallback.
- Integration test of the seeder against the dev site; README judge instructions.
