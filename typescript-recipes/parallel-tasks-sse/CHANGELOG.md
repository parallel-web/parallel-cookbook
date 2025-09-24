# CHANGELOG

## Improvements (2025-09-18)

- Ensure HTML renders on server-side from `/task/{id}.html` and JSON renders at `/task/{id}.json`
- Ensure the table that lists previous tasks links to the correct html and json (copy for JSON column: "Raw JSON Output"). Remove HTML column; clicking the row goes to `/task/{id}.html`
- Improve the styling of the SSE app to align with parallel branding
- The only streaming updates in sse demo seem to be "status" updates. We should expand this so that all event updates show clearly -- including the "message" text that shows for updates on pro + processors.
- Run IDs should be "copy"-able

Context:

- https://uithub.com/parallel-web/parallel-cookbook/tree/main/typescript-recipes/parallel-tasks-sse
- https://assets.p0web.com
- https://docs.parallel.ai/api-reference/task-api-v1/stream-task-run-events.md
- https://docs.parallel.ai/task-api/features/task-sse.md

## Tasks with SSE Recipe (2025-09-24)

- make SSE events actually stream. the sse events aren't the easiest to read in this format, my suggestion would be to change the UI for streaming so that its a scorecard of sources considered & read, where the numbers update, rather than progress update events showing like this. showing off the sources we read right at the top of the sse events page would be valuable for a demo
- Get back to it in slack https://wilmake.slack.com/archives/C09807JBB26/p1758041651707579

##

Discovered statefulness of stream api and improved docs with that: https://letmeprompt.com/rules-httpsuithu-2k8wr80

Discovered browser-based use of the API isn't allowed due to CORS issue.
