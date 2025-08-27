# Recurring Tasks Using cronjobs and KV

Stack: cloudflare typescript worker with static HTML with cdn.tailwindcss.com script for style.
http://flaredream.com/system-ts.md

APIs:
@https://docs.parallel.ai/api-reference/task-api-v1/create-task-run.md
@https://docs.parallel.ai/task-api/features/webhooks.md
@https://docs.parallel.ai/task-api/core-concepts/choose-a-processor.md
@https://docs.parallel.ai/api-reference/task-api-v1/retrieve-task-run-result.md
@https://docs.parallel.ai/resources/warnings-and-errors.md

I want to build a full-stack application with Cloudflare Specification:

Recurring Tasks Using cronjobs and KV

# `tasks.json`:

- 5 examples of different tasks with different configurations that look up different things online.
- Processor: core or pro.
- Focus on 5 examples inspired by these: https://pastebin.contextarea.com/evCgBln.md but that likely have different results every day.
- ensure the schema for each task is a flat object with 3-10 properties
- First, generate a JSON for this. Ensure to use the same format of schema definition as the API requires.

# `worker.ts`:

- Uses `env.PARALLEL_API_KEY` for the API, `env.PARALLEL_WEBHOOK_SECRET` for the webhook, `env.ASSETS` to fetch assets
- Daily cronjob at 3AM that can also be ran by admin using `/run?key=PARALLEL_API_KEY`.
- Uses webhook callback to know when status is complete, then retrieve the reuslt, then store result in kv under key `task:{slug}:{YYYY-MM-DD}`. NB: use `/v1beta` appropriately. use the Web Crypto API for verification.
- Make the last 10 results of each example available at `/{slug}` in reverse-chronological order (look up keys of last 10 dates). Inject this data and the task data itself (`{ task, results }`), and respond with `feed.html`

`index.html`:

- List all tasks on homepage in html stuyled with the styleguide
- Links of tasks go to `/{slug}`
- Styleguide: https://assets.p0web.com/llms.txt
- Use CSS to adjust theme based on system theme
- Add gh icon that links to https://github.com/janwilmake/parallel-daily-insights
- Use parallel icon and logo.

`feed.html`:

- Using same styleguide
- Shows each task result property as text with its basis confidence and references.
- Use https://www.google.com/s2/favicons?domain={hostname}&sz=32 to use icons for each reference.
