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

<!--
this is confusing and I should be more clear how this works for conversation flows
https://wilmake.slack.com/archives/C09807JBB26/p1756138137492169
-->

You can use this prompt to iteratively get to a better definition of what you want to build, and get the right context for this. Please note that the Python SDK is not included in this quickstart. You can add it if desired, you can also let it generate an ad-hoc client more tailored for your specific use-case. The latter requires less context for the same information and is recommended.

<!-- Note: this openapi llms.txt is not really needed since docs.parallel.ai already has references to them. The only thing it adds now is the decision logic that i put into the openapi manually-->

```txt path="relevant-context-prompt.txt"
OpenAPI: @https://parallel.oapis.org/llms.txt
Docs: @https://docs.parallel.ai/llms.txt
Website: @https://uithub.com/janwilmake/parallel-website/tree/main?omitFiles=true

First, reason about the different choices that need to be made and ask the user a set of questions.
Respond with a bulletted list of raw urls (prepended with @) that might be relevant, depending on the decisions of the user.

I want to build a full-stack application with [your-technology]. Specification:

[your-spec]
```

### Creating a full implementation using the right context

After you have the URLs of the right context, it's a matter of providing that togethr with your spec. To optimize for output quality, it's crucial to have complete context when prompting without providing too much irrelevant information to the model.

```txt path="full-implementation-prompt.txt
[Context URLs]

[Your Full Spec]
```

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
