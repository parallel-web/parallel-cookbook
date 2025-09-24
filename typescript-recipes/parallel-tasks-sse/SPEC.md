RULES:
https://uithub.com/janwilmake/gists/tree/main/named-codeblocks.md

PROMPT:
https://docs.parallel.ai/api-reference/task-api-v1/create-task-run.md
https://docs.parallel.ai/api-reference/task-api-v1/stream-task-run-events.md
https://assets.p0web.com
https://uithub.com/janwilmake/parallel-mcp/blob/main/parallel-oauth-provider/README.md
docs: https://pastebin.contextarea.com/e7bqy1n.md

Create a html that:

- first logs in using parallel-oauth-provider and stores api key in localStorage
- has a form to create a new task choosing between the 3 different output types
- links to docs for more info https://docs.parallel.ai/api-reference/task-api-v1/stream-task-run-events
- links to repo for code (use GitHub icon) https://github.com/parallel-web/parallel-cookbook/tree/main/typescript-recipes/parallel-tasks-sse
- after form is submitted, users api to create task, then stores that in localStorage
- renders all created tasks in a table below
- when clicking on a task in the table, calls the events endpoint, and updates the api accordingly, rendering everything in a logical way, and updating it as new events come in
- if the stream times out, restart it.
