# Platform facts (verified)

Steering doc. Checked against developer.atlassian.com on **2026-11-25**. `docs/BRIEF.md` stays the source of truth for *what* we build; this file records *how* the platform spells it. Re-check anything marked **Preview** before the Dec 22 submission.

## Toolchain
- `@forge/cli` 16.0.0 needs Node **^22.23.4 || ^24.22.1 || >=26.12.1**. It hard-fails on older Node, and there is no bypass flag.
- Runtime: `app.runtime.name: nodejs24.x` (recommended; 22.x and 20.x are also accepted). Optional `memoryMB` (128–1024) and `architecture`.

## Modules and exact keys

| Feature | Manifest key | Required properties | Notes |
|---|---|---|---|
| Rovo agent | `rovo:agent` | `key`, `name` (≤30 chars), `prompt` (string or `resource:<key>;<path>`) | Optional: `description`, `icon`, `conversationStarters`, `actions`, `skills`, `followUpPrompt`. |
| Agent / MCP tool | `action` | `key`, `name`, `function`, `actionVerb` (`GET`/`CREATE`/`UPDATE`/`DELETE`/`TRIGGER`), `description`, `inputs` | Inputs: `title`, `type` (`string`/`integer`/`number`/`boolean`), `required`, `description`. Handler gets `(payload, context)`. 5 MB data limit. Automation-triggered agents only call `GET` actions. |
| Skill (**Preview**) | `rovo:skill` | `key`, `source.dir` (directory holding `SKILL.md`) | `dependencies.tools` = list of this app's action keys. `SKILL.md` frontmatter: `name` (matches the dir name, lowercase-hyphen), `description`, `allowed-tools` (must include every dependency). No scripts. Attach with `skills:` on the agent. |
| MCP server (**Preview**) | `rovo:mcp` | `key`, `name` (≤30), `tools` (action keys, ≤50) | One per app. Disabled by default; a site admin enables it. Endpoint `https://mcp.atlassian.com/forge/<appId>`. |
| Issue panel | `jira:issuePanel` | `key`, `title`, `icon`, `resource` | UI Kit: `render: native`. `resolver: { function: … }`. New issue view only. |
| Global page | `jira:globalPage` | `key`, `title`, `resource` | One per app. Custom UI: omit `render`; `layout: native|blank`. |
| Workflow validator (**Preview**) | `jira:workflowValidator` | `key`, `name`, `description`, and `function` **or** `expression` | Handler `args`: `issue.key`, `configuration`, `transition.from.id`, `transition.to.id`, `transition.modifiedFields`. Returns `{ result: boolean, errorMessage?: string }`. Company-managed projects by default (`projectTypes` to widen). |
| Confluence macro | `macro` | `key`, `title`, `resource` | `render: native` for UI Kit; Custom UI omits it. `category` (not the deprecated `categories`): `data-and-charts`. `layout: block`. `config` for parameters. |
| Product events | `trigger` | `key`, `function`, `events` | Optional `filter: { ignoreSelf: true }`. Events can take up to 3 minutes to arrive. Handler `(event, context)`. |
| Scheduled job | `scheduledTrigger` | `key`, `function`, `interval` (`fiveMinute`/`hour`/`day`/`week`) | ≤5 per app, no user context, no retries. |
| Async queue | `consumer` | `key`, `queue`, `function` | `@forge/events`: `new Queue({ key }).push({ body: {...} })`; 50 events / 200 KB per push; handler reads `event.body`. Function `timeoutSeconds` up to 900. |
| SQL | `sql` | `key`, `engine: mysql` | One per app; adding it is a major version bump. |

### Event names used
- `avi:jira:created:issue`, `avi:jira:updated:issue`, `avi:jira:deleted:issue`
- `avi:jira:created:issuelink`, `avi:jira:deleted:issuelink`
- `avi:confluence:created:page`, `avi:confluence:updated:page` (need `read:confluence-content.summary`)
- `avi:forge:installed:app` (used to queue migrations)

## Forge SQL (`@forge/sql`)
- `sql.prepare(q).bindParams(...).execute()` → `{ rows }`; `sql.executeRaw(q)` for statements with no params.
- `migrationRunner.enqueue(name, ddl).run()`; `migrationRunner.list()`. Use idempotent DDL (`CREATE TABLE IF NOT EXISTS`). Run from a queue consumer on install, plus a lazy "ensure schema" call before first use.
- MySQL-compatible (TiDB). **No foreign keys. One statement per query.** SELECT 5 s, DML 10 s, DDL 20 s timeouts; 4 MiB response; 150 DML/s; 25 DDL/min; 128 MiB in development.

## Teamwork Graph (**Preview**)
- `api.asUser().requestTeamworkGraph(query, variables)` from `@forge/api` (backend) or `requestTeamworkGraph` from `@forge/bridge` (frontend, always as user). GraphQL that wraps Cypher.
- New apps use **curated queries** or **persisted Cypher** via `customQuery(queryKey, queryParams, first)`; persisted queries are registered in the TWG Query Builder (`teamwork-graph.atlassian.com/query-builder`). Raw `cypherQuery` is not available to new apps.
- Scopes: `read:graph:<object>:<product>`, one per object type per hop, e.g. `read:graph:issue:jira`, `read:graph:page:confluence`, `read:graph:user:atlassian`, `read:graph:team:atlassian`, `read:graph:project:jira`.
- **A missing scope returns empty rows with no error**, so treat "suspiciously empty" as "fall back to REST and show a setup hint".
- Pushing data in uses the separate `graph:connector` module (stretch goal).

## Deadlines that touch us
- From **2027-01-05**, apps with `rovo:skill` or `rovo:mcp` must define `app.rovo` metadata. After the Codegeist deadline; note it for the Marketplace listing.

## Sources
manifest-reference/modules/{rovo-agent, rovo-action, rovo-skill, rovo-mcp, jira-issue-panel, jira-global-page, jira-workflow-validator, macro, trigger, scheduled-trigger, sql}; storage-reference/{sql, sql-api, sql-api-schema}; runtime-reference/async-events-api; events-reference/{product_events, confluence}; teamwork-graph/{call-the-teamwork-graph-api, scopes, graphql-and-cypher}; manifest-reference (runtime).
