# Build status (2026-11-25, late evening)

All BRIEF section 7 modules are built and deployed to the **development** environment on muthasafal.atlassian.net (installed in Jira and Confluence, Teamwork Graph scopes granted). "Verified" below means it was checked on the site; "deployed" means it was accepted by Forge and still needs a look.

| Module | State |
|---|---|
| Domain layer (`src/domain/`) | 38 vitest + fast-check tests pass (all four BRIEF section 9 properties) |
| Sample loader / remover | **Verified**: 150 artifacts, the 6 planned gaps, 3 suspect links, v2.3 gate red with 9 blockers. Remover not yet clicked. |
| Jira issue panel "Trace" | **Verified** on PUMP-4 and PUMP-3 |
| Product triggers + suspect detection | **Verified**: editing PUMP-3 logged `version bump PUMP-3 {"newSuspects":3}` |
| Workflow validator | Deployed; **waiting on the user** to add it to PUMP's Done transition |
| Compliance cockpit (Jira global page, Custom UI) | **Verified** in a browser: gate (13 blockers after the PUMP-3 edit), clause coverage, gaps by type, suspect timeline, trace explorer (resolves `SRS-004`), owner lookup, sample card |
| Traceability matrix (Confluence macro and space page, Custom UI) | **Verified** space page: 40 rows, 6 with gaps, the 'Has gaps' filter. DHF PDF/CSV are unit-tested (valid multi-page PDF); the iframe sandbox allows downloads; the click-to-download was not checked by eye |
| Rovo agent "Traceline Auditor" | Deployed, with 9 actions and the attached `rovo:skill`. **Blocked: Rovo is not enabled for this org** (the chat URL redirects to the Rovo marketing page) |
| `rovo:mcp` "Traceline" | Deployed, with 7 tools (trace-for-file, impact-of-change, gaps-for-release, what-to-retest, trace-chain, coverage-by-clause, who-signs-off) |
| Teamwork Graph owner lookup | **Verified** fallback path: the graph returned no people for the app-created sample pages, so the cockpit showed Jira/Confluence owners plus the hint. A Teamwork Graph hit is not yet seen |

Permission awareness: every person-facing answer (panel, cockpit, matrix, Rovo, MCP) is computed on the full graph, then redacted to the issues and pages that person can see (`src/resolvers/visibility.ts`).

## To verify on the site (needs a person in a browser)
1. **Cockpit**: Jira → Apps → Traceline. Check the gate, coverage, timeline, "Snapshot for audit trail", and "Trace any item" (PUMP-4) with "Who signs off".
2. **Matrix**: in the PUMPSAMPLE space, either the sidebar "Traceability matrix" page, or insert the "Traceability matrix (Traceline)" macro on the DHF overview page. Then test the filters, Export DHF (PDF) and both CSVs. Downloads from the Custom UI iframe are untested.
3. **Rovo**: open Rovo chat → Agents → Traceline Auditor. Ask "Can we ship v2.3?", "What must be re-tested if PUMP-4 changes?", "Who signs off on PUMP-4?" and "Run a mock audit for v2.3". If Rovo is not enabled on the site, an org admin enables it in Atlassian Administration → Apps → AI settings / Rovo.
4. **MCP**: Atlassian Administration → Apps → Sites → Connected apps → Traceline → enable the MCP tools. Then connect an IDE to `https://mcp.atlassian.com/forge/93b72ef4-1337-46ac-b78e-3cbad7877ede` and call `trace-for-file` with `src/occlusion-monitor/`.
5. **Validator**: add "Requires passing verification (Traceline)" to PUMP's Done transition, then try moving PUMP-69 to Done.
6. **Optional TWG persisted query**: register the Cypher in `docs/TEAMWORK_GRAPH.md` in the Query Builder; saving its key in settings is not yet exposed in the UI (resolver `saveTwgQueryKey` exists).

## Architecture note: storage is per installation
The Jira and Confluence installations have separate Forge SQL/KVS. The Jira installation is the source of truth and publishes `traceline-row` (issue) and `traceline-meta` (project) entity properties. The Confluence matrix reads them with a user-context Jira search. Confluence page edits are picked up by a 5-minute Jira-side CQL poll. Rovo/MCP actions read the local graph, so if Rovo runs them in the Confluence installation they will see an empty graph; check this once Rovo is on.

## Rovo is not enabled: options
- **Recommended:** `forge site provision` creates a free 90-day demo development site with enterprise Jira, Confluence and Rovo. Then:
  1. `forge install --demo-site` (Jira and Confluence)
  2. Click "Load sample project".
- Or an org admin enables Rovo for muthasafal.atlassian.net in admin.atlassian.com → "AI and Rovo", if the site's plan allows it. Free developer sites may not.
- MCP tools: Atlassian Administration → Apps → Sites → (site) → Connected apps → Traceline → View app details → Tools selection.

## Known issues
- `forge deploy` sometimes fails with "Agent not allowed" with no manifest change; retrying succeeds (loop in the resume commands).
- The `jira:adminPage` link from `forge install` returns 404. Everything it offers is on the cockpit, except the settings UI (pack, default level, validator levels), which is still only in the admin page. Move the settings into the cockpit, then drop the admin page.
- The issue-panel chain is wider than the panel (horizontal scroll).
- Seeder steps aren't logged; progress is only shown in the UI.

## Next
1. Verify the items above and fix what breaks.
2. Move settings (including the TWG query key) into the cockpit; remove `jira:adminPage`.
3. README judge instructions (install link, enabling Rovo, granting Teamwork Graph scopes, sample loader, where each feature is).
4. Production deploy, distribution link, video, and Marketplace listing (**ask the user first**).

## How to resume
- Forge credentials live in `Hackathon\.env`. **Always** run Forge through the wrapper; never run bare `forge` in the sandboxed Bash tool (it deletes the saved login).
  ```powershell
  npm run predeploy
  & C:\Users\notch\OneDrive\Desktop\Hackathon\forge.ps1 deploy --non-interactive -e development
  & C:\Users\notch\OneDrive\Desktop\Hackathon\forge.ps1 install --upgrade --non-interactive --site muthasafal.atlassian.net --product jira -e development
  & C:\Users\notch\OneDrive\Desktop\Hackathon\forge.ps1 logs -e development --since 15m --non-interactive
  ```
- `npm run predeploy` typechecks, runs the tests and builds both Custom UI apps (`static/*/build` is gitignored, so build before every deploy).
- Sample key map: SRS-n = PUMP-n (1–30); HAZ = PUMP-31..38; RC = PUMP-39..48; IMP = PUMP-49..83; VER = PUMP-84..123.
- Cockpit URL: `https://muthasafal.atlassian.net/jira/apps/93b72ef4-1337-46ac-b78e-3cbad7877ede/e0df3588-2233-468f-8d44-6209ee33c18d`
