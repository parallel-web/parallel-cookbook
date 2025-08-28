# Parallel AI Cookbook

The following cookbook is designed to get you cooking with Parallel APIs as quickly as possible. Explore and remix recipes and OSS projects using Parallel, use useful utilities, and try the machine quickstart to get cooking immediately.

## Recipes & Examples

These recipes focus on building full-stack serverless apps on Cloudflare Workers. The recipes are sufficiently small to be taken as context, and refactor as a whole, for example to change the usecase, lay-out, or programming language.

Example Apps are intended to be bigger MIT OSS Apps Powered by Parallel APIs that are more complete (payments, login, etc) and can be used as boilerplate / starting point for new SaaS Products!

| Title                           | Description                              | Code                                                 | Demo                                       |
| ------------------------------- | ---------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| Tasks Playground with Streaming | Using Durable Objects and SSE Events API | [Recipe](typescript-recipes/parallel-tasks-sse)      | [sse.p0web.com](https://sse.p0web.com)     |
| Recurring Tasks and Webhooks    | Active Monitoring using cronjobs and KV  | [Recipe](typescript-recipes/parallel-daily-insights) | [daily.p0web.com](https://daily.p0web.com) |
| Search Agent                    | AI SDK + Parallel SDK Search API as tool | [Recipe](typescript-recipes/parallel-search-agent)   | [agent.p0web.com](https://agent.p0web.com) |

<!--

Recipes TODO:

Tasks using SSE:
- Add source policy


Cool cookbooks

https://github.com/anthropics/anthropic-cookbook
https://cookbook.openai.com
-->

## Awesome Parallel OSS Examples

- [Parallel Spreadsheet](https://github.com/zahidkhawaja/parallel-spreadsheet) by [@chillzaza\_](https://x.com/chillzaza_/status/1958005876918292941) (Vercel, Typescript)
- [Based People](https://github.com/janwilmake/basedpeople) by [@janwilmake](https://x.com/janwilmake/status/1956061673833300443) (Cloudflare, Typescript)
- [Scira (10k+ stars)](https://github.com/zaidmukaddam/scira) by [@zaidmukaddam](https://x.com/zaidmukaddam/status/1958583204635439264) (Vercel, Typescript)

## Resources & Utitlies

- https://github.com/janwilmake/parallel-flatten - Utility for getting flat outputs for easier rendering

## Contributing

Built something cool with Parallel APIs you want to showcase? The Parallel cookbook welcomes community contributions. Also ideas for other recipes are welcome. See [contributing](CONTRIBUTING.md) for more details.

## Machine Quickstart

> [!NOTE]
> The following examples have been tested with [Claude Sonnet 4](https://www.anthropic.com/claude/sonnet) ONLY, which is widely regarded one of the best AI coding models. That said, these prompts will work well with other models too.
>
> Please note that the Python SDK isn't included in this quickstart as of yet. You can add these if desired.
>
> Before using these prompts, ensure your AI either has access to a tool that can fetch llms.txt urls like [this fetch MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) or [this remote one](https://smithery.ai/server/@jiankaitian/servers)

<!--
Note: Why badges?

- Allows showing tokencount
- Allows easy filtering of a context
- Allows quickly seeing a prompt & result and altering the prompt

-->

For quick questions you may use the following prompt in your LLM client. You can use this prompt with any LLM/IDE that supports URL context expansion or MCP. For your convenience, there are also quick links to view contexts and prompt examples. please note it's best to filter on more specific information before asking the LLM to implement anything, for optimal output quality. See the [advanced machine start](#advanced-machine-start-2-step-with-mcp) for more info on that.

```md
Here is all information available about parallel:

- Full documentation: @https://docs.parallel.ai/llms-full.txt
- API specification: @https://uithub.com/janwilmake/parallel-openapi/tree/bdbb361f194b761bbe8220faf5beba33e3ba70e1/tags?lines=false
- Website and blog: @https://uithub.com/janwilmake/parallel-website?maxTokens=10000000&lines=false
- Typescript SDK summary: @https://rules-httpsuithu-s10son0.letmeprompt.com/parallel-sdk.d.ts

Answer the users prompt based on available information. Do not make up anything, fetch URLs needed incase you need more context, or respond with the URLs if you can't reach them yourself.
```

Depending on your question, please choose the contexts needed:

- [Full Documentation](https://docs.parallel.ai) - [llms-full.txt](https://docs.parallel.ai/llms-full.txt)
- [API Specification](https://docs.parallel.ai/api-reference) - [![](https://badge.forgithub.com/janwilmake/parallel-openapi/tree/main/openapi.yaml)](https://uithub.com/janwilmake/parallel-openapi?maxTokens=10000000&lines=false) [![](https://b.lmpify.com/Select_A_Context)](https://letmeprompt.com?q=https://parallel.oapis.org/%20%20give%20me%20urls:%20which%20files%20are%20relevant%20for%20...)
- [Website and Blog](https://parallel.ai) - [![](https://badge.forgithub.com/janwilmake/parallel-website?maxTokens=10000000&lines=false)](https://uithub.com/janwilmake/parallel-website?maxTokens=10000000&lines=false)
- [Python SDK](https://github.com/parallel-web/parallel-sdk-python) - [![](https://badge.forgithub.com/parallel-web/parallel-sdk-python?maxTokens=10000000&lines=false)](https://uithub.com/parallel-web/parallel-sdk-python?maxTokens=10000000&lines=false)
- [Typescript SDK (coming soon)](#) - [Raw Context](https://rules-httpsuithu-s10son0.letmeprompt.com/parallel-sdk.d.ts)

## Advanced Machine Start (2-step, with MCP)

The advanced machine quickstart uses a 3-step framework that allows ingesting the right context to ensure maximum LLM output quality:

1. finetuning the scope of your request
2. gathering the right contexts for this
3. creating a full implementation using the right context

You can use this prompt to iteratively get to a better definition of what you want to build, and get the right context for this. Alternatively it's possible to use this same prompt to retrieve URLs you can paste in your follow-up message. In this case, be sure to copyt it for the documentation to be included into the context window. This will work in any modern LLM client, see [using context](#using-context) for more details.

```txt path="relevant-context-prompt.txt"
Docs: @https://docs.parallel.ai/llms.txt
Website: @https://uithub.com/janwilmake/parallel-website/tree/main?omitFiles=true

Consider these resources and determine which ones are necessary to complete the users task.
If possible, fetch useful URLs, then respond with a bulletted list of raw urls (prepended with @) that are relevant.

I want to build a full-stack application.

Technology: [YOUR TECH STACK]
Specification:
[YOUR SPECIFICATION]
```

The LLM should fetch URLs and respond with the URLs that are deemed useful. You can now either continue prompting to perform the implementation, or take the URLs as context into a fresh prompt.

## Using Context

How to use context with your LLM/IDE?

- In Claude, Gemini, ChatGPT, or any other LLM of preference: Just copy-paste the context or use a GPT or MCP that can fetch URLs.
- [Cline @ Mentions](https://docs.cline.bot/features/at-mentions/overview)
- [Cursor @ Symbols](https://docs.cursor.com/en/context/@-symbols/overview)
- [Context Management in VSCode](https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context#_add-files-as-context) works with URLs directly
- [Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices) works with URLs directly
- [AmpCode](https://ampcode.com) works with URLs directly

Please be aware that some providers/clients (such as Cursor or ChatGPT) may intelligently choose to truncate context from the window using their own context-engine, for higher control, use a client that gives you full control over the context window.
