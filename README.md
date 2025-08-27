# Parallel AI - Context-aware Cookbook

The following cookbook is designed to get you cooking with Parallel APIs as quickly as possible. It uses a 3-step framework that allows ingesting the right context to ensure maximum LLM output quality:

1. finetuning the scope of your request
2. gathering the right contexts for this
3. creating a full implementation using the right context

You can use this framework with any LLM/IDE that supports URL context expansion or MCP. For your convenience, there are also quick links to view contexts and prompt examples.

## Recipes & Examples

These recipes focus on building full-stack serverless apps on Cloudflare Workers. The recipes are sufficiently small to be taken as context, and refactor as a whole, for example to change the usecase, lay-out, or programming language.

Example Apps are intended to be bigger MIT OSS Apps Powered by Parallel APIs that are more complete (payments, login, etc) and can be used as boilerplate / starting point for new SaaS Products!

| Title                           | Description                              | Repo                                                          | Demo                                       |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| Tasks Playground with Streaming | Using Durable Objects and SSE Events API | [Repo](https://github.com/janwilmake/parallel-tasks-sse)      | [sse.p0web.com](https://sse.p0web.com)     |
| Recurring Tasks and Webhooks    | Active Monitoring using cronjobs and KV  | [Repo](https://github.com/janwilmake/parallel-daily-insights) | [daily.p0web.com](https://daily.p0web.com) |
| Search Agent                    | AI SDK + Parallel SDK Search API as tool | [Repo](https://github.com/janwilmake/parallel-search-agent)   | [agent.p0web.com](https://agent.p0web.com) |

<!--

Recipes TODO:

Tasks using SSE:
- Add source policy


Cool cookbooks

https://github.com/anthropics/anthropic-cookbook
https://cookbook.openai.com
-->

## Awesome Parallel OSS Examples

- [Parallel Spreadsheet](https://github.com/zahidkhawaja/parallel-spreadsheet) by [@chillzaza\_](https://x.com/chillzaza_/status/1958005876918292941) (Next.js, Typescript)
- [Based People](https://github.com/janwilmake/basedpeople) by [@janwilmake](https://x.com/janwilmake/status/1956061673833300443) (Cloudflare, Typescript)

## Contributing

Built something cool with Parallel APIs you want to showcase? The Parallel cookbook welcomes outsider contributions. Also ideas for other examples are welcome.

## Quickstart prompts

The following examples have been tested with [Claude Sonnet 4](https://www.anthropic.com/claude/sonnet) ONLY, which is widely regarded one of the best AI coding models. That said, these prompts will work well with other models too.

### Finetuning the scope of your request and gathering the right contexts for this

You can use this prompt to iteratively get to a better definition of what you want to build, and get the right context for this. Please note that the Python SDK or Typescript SDK aren't included in this quickstart. You can add these if desired.

Before using this prompt, ensure your AI either has access to a tool that can fetch llms.txt urls like [this fetch MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) or [this remote one](https://smithery.ai/server/@jiankaitian/servers)

Alternatively it's possible to use this same prompt to retrieve URLs you can paste in your follow-up message. In this case, be sure to copyt it for the documentation to be included into the context window. This will work in any modern LLM client, see [using context](#using-context) for more details.

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

## Choose Your Context

Depending on your question, please choose the contexts needed:

- [Full Documentation](https://docs.parallel.ai) - [![](https://b.lmpify.com/Select_A_Context)](https://letmeprompt.com?q=https://docs.parallel.ai/llms-full.txt)
- [Parallel API Specification](https://docs.parallel.ai/api-reference/search-api/search) - [![](https://badge.forgithub.com/janwilmake/parallel-openapi/tree/main/openapi.yaml)](https://uithub.com/janwilmake/parallel-openapi?maxTokens=10000000&lines=false) [![](https://b.lmpify.com/Select_A_Context)](https://letmeprompt.com?q=https://parallel.oapis.org/%20%20give%20me%20urls:%20which%20files%20are%20relevant%20for%20...)
- [Parallel Website and Blog](https://parallel.ai) - [![](https://badge.forgithub.com/janwilmake/parallel-website?maxTokens=10000000&lines=false)](https://uithub.com/janwilmake/parallel-website?maxTokens=10000000&lines=false)
- [Python SDK](https://github.com/parallel-web/parallel-sdk-python) - [![](https://badge.forgithub.com/parallel-web/parallel-sdk-python?maxTokens=10000000&lines=false)](https://uithub.com/parallel-web/parallel-sdk-python?maxTokens=10000000&lines=false)

<!--
Note: Why badges?

- Allows showing tokencount
- Allows easy filtering of a context
- Allows quickly seeing a prompt & result and altering the prompt

Other contexts:
- 🟠 Typescript SDK (https://uithub.com/parallel-web/parallel-sdk-typescript)
- 🟠 MCP server to select context (Coming soon!)

# Reduce LLM SDK context

- Check if stainless allows generating pyi stubs: https://letmeprompt.com/what-is-a-dts-file-m18w490
- Create and expose `types.d.ts` file for the Typescript SDK

These would create a much shorter context for libraries that make it much more usable for LLMs. It's interesting to generate it programmatically, but since code is often badly documented or may contain comments that don't end up in the stub but ARE important, it'd also be very interesting to try and generate these files using AI.
-->

## Using Context

How to use context with your LLM/IDE?

- In Claude, Gemini, ChatGPT, or any other LLM of preference: Just copy-paste the context or use a GPT or MCP that can fetch URLs.
- [Cline @ Mentions](https://docs.cline.bot/features/at-mentions/overview)
- [Cursor @ Symbols](https://docs.cursor.com/en/context/@-symbols/overview)
- [Context Management in VSCode](https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context#_add-files-as-context) works with URLs directly
- [Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices) works with URLs directly
- [AmpCode](https://ampcode.com) works with URLs directly
