# Teamwork Graph in Traceline

Traceline uses the Teamwork Graph (Preview) for **"who signs off on this requirement?"**. Everything runs as the current user, so answers are permission-filtered by Atlassian.

## What works with no setup (curated queries)
For each Confluence page a requirement traces up to (system requirements, design items), Traceline calls the curated queries `confluencePageOwners` and `confluencePageContributors`. Page owners are treated as the people who sign off.

## Optional: issue assignee and team (persisted Cypher query)
Curated queries cannot go from a Jira work item to its people, so this part uses a persisted query owned by the Traceline app. Registering it is a one-time step for an app contributor:

1. Open the TWG Labs Query Builder: https://teamwork-graph.atlassian.com/query-builder
2. Paste this Cypher, validate it, and submit it for the Traceline app (`ari:cloud:ecosystem::app/93b72ef4-1337-46ac-b78e-3cbad7877ede`):
   ```cypher
   MATCH (item:JiraWorkItem {ari: $itemAri})<-[:atlassian_user_assigned_jira_work_item]-(user:AtlassianUser)
   OPTIONAL MATCH (user)-[:atlassian_user_is_in_atlassian_team]->(team:AtlassianTeam)
   RETURN user, collect(distinct team) as teams
   ```
   Parameter: `itemAri` (type `ARI`).
3. Copy the returned `queryKey` (a UUID) and save it in Traceline (cockpit → Settings → Teamwork Graph query key). It takes about a minute to propagate.

The relationship names come from the Teamwork Graph relationship index. The direction of the assignee pattern is derived from the documented user → work item example; the Query Builder validates it at submission.

## Scopes and the fallback
- The manifest requests `read:graph:issue:jira`, `read:graph:page:confluence`, `read:graph:user:atlassian` and `read:graph:team:atlassian`. A site admin approves them when installing or upgrading Traceline.
- **A missing scope returns empty results with no error.** When the graph returns no people for an item that REST shows has an owner, Traceline:
  - falls back to Jira (`assignee`, `reporter`) and Confluence (`ownerId`, `authorId`)
  - labels the answer "Jira/Confluence REST (fallback)"
  - shows a setup hint asking an admin to approve the read:graph scopes.
