RULES:
https://uithub.com/janwilmake/gists/tree/main/named-codeblocks.md

PROMPT:
In this guide, we'll build a Web Research Agent accessible over a simple frontend.

This application will:

- Show a simple search interface that interacts with the Vercel AI SDK
- Connect the agent with the Parallel Search API through tool use. the agent is instructed to perform extensive research with multiple searches. the characters per result should be low to save token cost
- Allow user to edit system prompt in config modal

Parallel's Search API has a [different take on search](https://parallel.ai/blog/parallel-search-api) that [beats competition](https://parallel.ai/blog/search-api-benchmark) in benchmarks - a more AI native search, which is very exciting to me.

Technology Stack we'll use:

- Parallel Typescript SDK
- Vercel AI SDK with Cerebras
- Cloudflare to deploy it

# Defining our context

- Parallel SDK: https://uithub.com/parallel-web/parallel-cookbook/blob/main/typescript-sdk-types.d.ts
- AI SDK stubs file: https://unpkg.com/ai@5.0.22/dist/index.d.ts
- Cerebras types: https://unpkg.com/@ai-sdk/cerebras@1.0.11/dist/index.d.ts
- Cerebras models: https://inference-docs.cerebras.ai/api-reference/models.md
- Search Docs: https://docs.parallel.ai/search-api/search-quickstart.md
- Search Processors Docs: https://docs.parallel.ai/search-api/processors
- Cloudflare: https://flaredream.com/system-ts.md
- How to use agents in AI SDK: https://uithub.com/vercel/ai/blob/main/content/docs/02-foundations/06-agents.mdx

Finish the guide and finally give me the code for the cloudflare worker

Please note:

- No Durable objects needed, just return the text string back from the worker to the html directly
- Don't use fetch, rather , use search from the parallel-web typescript SDK
- use CEREBRAS_API_KEY and PARALLEL_API_KEY in .env
- use https://assets.p0web.com for branding, and cdn.tailwindcss.com for styling
- ensure to define `inputSchema` for the tool, not `parameters`
- use `createCerebras` with the API key to get a cerebras provider
- define the HTML in a separate file
- use stopWhen: stepCountIs(10)
- the layout should be simple, with a nice centered search input first, and a result page where the result is rendered after showing loading indicator.
- use streamText and stream fullStream back, rendering tool calls and results in an elegant way.
