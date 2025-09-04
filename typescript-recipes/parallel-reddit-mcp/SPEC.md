# Specification

FILES

- index.html
- result.html
- worker.ts
- wrangler.json
- package.json
- .env

SPEC

- endpoint `GET /new?statement=string`
  - performs x oauth redirect before submission with `redirect_to` containing same url.
  - after login checks user generations (pending or done) to be under 5 total and slug to be nonexistent
  - if so, execute task with webhook leading to `/webhook` and metadata `{slug}`. insert it into tasks (pending)
- `GET /webhook` should retrieve result and then insert it into task with slug from metadata
- endpoint `GET /result/{slug}` should increase visits by one each request and responds with HTML:
  - meme up top and author with pfp
  - if pending, show loading indicator and that it may take up to 10 minutes
  - if error, show error
  - if result, show roast and each counterpoint in a card with links to its sources.
- endpoint `GET /` shows index but injects 6 popular (most visits) debates and 30 recent ones

CONFIG

- import the html files using `import index from "./index.html"` etc (before you inject things)
- hosted at https://oss.parallel.ai/changemymind/ (remove first segment from pathname for routing)
- DO with SQL table: `tasks: { slug (primary key, unique), statement, status:"pending"|"done", username, profile_image_url, created_at, updated_at, visits, result, error }`
- use `pro` task processor with json schema `{counterpoints:string[], roast:string}`
- use env `PARALLEL_API_KEY`, `PARALLEL_WEBHOOK_SECRET`, `MCP_URL`
- hardcode mcp name "Reddit"

CONTEXT NEEDED

- how to cloudflare: https://flaredream.com/system-ts.md
- simplerauth-client https://unpkg.com/simplerauth-client/README.md
- parallel docs on task spec https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md
- parallel docs on webhooks https://docs.parallel.ai/task-api/features/webhooks.md
- typescript sdk for task creation and task result https://letmeprompt.com/httpsuithubcomp-1qyxfp0?key=result
- `index.html` https://pastebin.contextarea.com/N4J55eQ.md

<!-- https://letmeprompt.com/files-indexhtml-hap5fr0 -->
