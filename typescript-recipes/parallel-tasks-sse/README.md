# Building a Parallel Task Playground with streaming

## Introduction

Parallel has a few [great playgrounds](https://platform.parallel.ai/play) for deep research and enrichment, but how does it work under the hood, and how can we build one ourselves?

This recipe highlights:

- how the different core features of the Task API can be used
- what the different task modes are
- how we use streaming events to show the user intermittent updates
- how we can render the results into a simple UI.

The key difference of this "playground" to the official Parallel playgrounds is that here, you get a better feel of how the actual API works, and it's possible to see the results in both JSON and as a table.

Check out the playground [here](https://oss.parallel.ai/tasks-sse). After entering your API key, you'll be able to submit any task with any configuration. The results will be streamed to a JSON blob that is publicly accessible to anyone.

For this recipe, we're using [Cloudflare Workers](https://workers.cloudflare.com) with [Durable Objects](https://developers.cloudflare.com/durable-objects/) to deploy this app into the Cloud.

## Concepts

### Durable Objects on Cloudflare Workers

Cloudflare Workers is a serverless platform that allows to create highly scalable stateless APIs and websites (static assets) with ease. Durable Objects is one of Cloudflare's most core primitves on which a lot of other Cloudflare services got built - it allows adding stateful objects to your serverless apps because it allows creating an unlimited amount of tiny SQLite databases. It also allows making ongoing activity in the worker addressable because every durable object can have its own identifier.

What's important is that we want to be able to run an infinite amount of tasks in Parallel. We also want the user to be able to leave the website and come back any time to see the progress. This is where durable objects come in. Where a regular cloudflare worker is limited in how long the requests can take and will stop executing when the user aborts the connection, durable objects can keep going after even if the user isn't connected to it. Even with DO's you'll run into the problem that a regular DO times out [after using 30 seconds of CPU](https://developers.cloudflare.com/durable-objects/platform/limits/). However, we can reset this limitation by calling an [alarm](https://developers.cloudflare.com/durable-objects/api/alarms/) during task streaming. Every time an alarm is ran, the CPU limitation is reset.

Would a single durable object be enough? No. We'd run into the Cloudflare limitation of max 6 concurrent fetch requests. This would mean we could only receive streaming updates for 6 tasks concurrently, which wouldn't be very scalable, a single user can already exceed this. This is why we'll use a master-slave architecture where there's a `TaskManager` DO that maintains all state, and a `TaskRunner` that executes a task, maintaining the streaming connecion with the Parallel API.

### Parallel Tasks with SSE

Tasks in Parallel can take up to an hour, and with [streaming updates](https://docs.parallel.ai/task-api/features/task-sse) it's possible to get intermediate status updates during task execution. This allows you to inform the user what's happening as the task is being executed, something that's often a great way to improve UX.

We're using 3 APIs in this recipe:

1. The [Create Task Run API](https://docs.parallel.ai/api-reference/task-api-v1/create-task-run) to create the task
2. The [Events API](https://docs.parallel.ai/task-api/features/task-sse) to receive events
3. The [Task Result API](https://docs.parallel.ai/api-reference/task-api-v1/retrieve-task-run-result) to receive the final result.

It's important to note that event streams only remain open for 570 seconds tops, after which they'll be automatically closed. Because a task can take maximum up to an hour, we'll need to reopen the stream request every time it gets closed, until we're in a terminal state (completed, failed or cancelled).

There are three Task output modes that are specified in `task_spec.output_schema.type`: `text`, `auto`, or `json`. Text returns a single string as output, JSON returns a JSON object in a pre-specified shape, and auto returns a JSON object without having to specify the exact shape. Auto is great for deep research tasks to get more fine-grained output basis, while text or JSON is better if you are doing multiple tasks for enrichment of one or multiple predetermined datapoints.

## Fontend

After the backend-architecutre is there, the frontend was easy. It just needs a form to submit an API key and a new task, a list to view all tasks in our database, and buttons to show the tasks as JSON or as a table.

For this I set up the API as follows:

- `POST /api/tasks`: Create new task with chosen schema mode
- `GET /api/tasks`: List all tasks with status and metadata
- `GET /task/{id}`: JSON showing complete task details and event history

The frontend can now be built using a single HTML file that uses these three endpoints. Using frameworks like React we can potentially make a bit more composable, but for this example that's not really needed. That's really all there is to it! Our final HTML just has [560 lines of code](https://github.com/janwilmake/parallel-tasks-sse/blob/main/index.html)

## Building this recipe

Building the recipe was straightforward - I collected all context from the docs and api reference by going to the above mentioned API and doc pages and appending `.md` to the URL. Also, I used [this Cloudflare system prompt](https://flaredream.com/system-ts.md) to ensure my LLM understands Cloudflare Durable Objects, and this [branding prompt](https://assets.p0web.com/llms.txt) to ensure I followed the Parallel style-guide. After describing what needed to be built, Claude Sonnet was able to pretty much one-shot it. See [the cookbook](https://github.com/parallel-web/parallel-cookbook) for more information on the methodology here.

## Result

You can view the result on https://oss.parallel.ai/tasks-sse
