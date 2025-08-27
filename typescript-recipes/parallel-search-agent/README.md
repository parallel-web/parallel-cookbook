# After hours of iteration, I one-shotted my Search Agent - A short guide about context engineering and building agents

[![janwilmake/parallel-search-agent context](https://badge.forgithub.com/janwilmake/parallel-search-agent?lines=false)](https://uithub.com/janwilmake/parallel-search-agent?lines=false) [![](https://remix.forgithub.com/badge)](https://remix.forgithub.com/janwilmake/parallel-search-agent) | Discuss: [HN Thread](https://news.ycombinator.com/item?id=45038332) | [X Thread](https://x.com/janwilmake/status/1960669482697023920)

In this guide, we'll build a Web Research Agent accessible over a simple frontend. By the end of this guide, you'll know how to build a search agent like in [this demo](https://x.com/janwilmake/status/1960652955251589355) (try it out at https://agent.p0web.com as long as there's still Cerebras & Parallel credit left).

Parallel's Search API has a [different take on search](https://parallel.ai/blog/parallel-search-api) that [beats competition](https://parallel.ai/blog/search-api-benchmark) in benchmarks - a more AI native search. The key difference between other Search Agents such as Exa or Tavily, is that it gives all required context in a single API call, whereas other search agents still function the traditional way of search, where it's split up into 2 API calls - one for getting the SERP, one for getting the pages that seem relevant. Parallel smoothens this process and has build a system that finds the most relevant context of all pages immediately, but only the relevant stuff, to reduce context bloat.

The Search Agent we're building will:

- Show a simple search homepage
- Allow user to edit system prompt in config modal
- Connect the agent with search through tool use
- Stream back search results and the AI reasoning upon that

The Technology Stack we'll use:

- [Parallel Typescript SDK](https://docs.parallel.ai/home)
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction)
- [Cerebras](https://ai-sdk.dev/providers/ai-sdk-providers/cerebras) for fast AI responses
- [Cloudflare Workers](https://workers.cloudflare.com) to deploy it

# Defining our context

**I'm writing this after having one-shotted a full implementation** (which can be found [here](https://github.com/janwilmake/parallel-search-agent)) - but I wasn't able to one-shot this immediately. It took me a while to gather all needed context for the LLM to make zero mistakes. In this section I'll dive in how I found that context.

## Context for the AI SDK

The AI SDK is not easy to get context for. After some digging I found that the docs are exposed at https://github.com/vercel/ai/blob/main/content/docs so we can get those via [uithub](https://uithub.com), and the NPM packages contain pretty good `.d.ts` type files. Unlike many other pacakages, the main `.d.ts` file for the packages we'll be using are pretty complete, although some things were still missing. We can access the raw file context of NPM packages through https://unpkg.com/{package}/{...path}.

All in all this was the context I went with:

- AI SDK stubs file: https://unpkg.com/ai@5.0.22/dist/index.d.ts
- Cerebras types: https://unpkg.com/@ai-sdk/cerebras@1.0.11/dist/index.d.ts
- Cerebras models: https://inference-docs.cerebras.ai/api-reference/models.md
- How to use agents in AI SDK: https://uithub.com/vercel/ai/blob/main/content/docs/02-foundations/06-agents.mdx

First I tried without the agents docs, but found the implementation was done in different ways over several trials and all of them were lacking something, meaning there's probably not enough information in the SDK doc-comments to understand the best approach. Since I'm looking to build an agent that could do multiple tool calls and reasoning steps in a single simple call, I ended up adding the [agents docs](https://ai-sdk.dev/docs/foundations/agents) of the AI SDK.

## Context for Parallel Search

For proper use of the Search API of Parallel, I needed at least the following docs which could be found by appending `.md` to the docs URL (this is a mintlify feature not linked to by Parallel themselves yet):

- Search Docs: https://docs.parallel.ai/search-api/search-quickstart.md
- Search Processors Docs: https://docs.parallel.ai/search-api/processors.md

Also I need to have the full API definition for the Paralel API to know all properties and how they work, and the exact response shape (with all possible sad paths). For this I would normally use the Search operation OpenAPI spec (Available through mintlify at https://docs.parallel.ai/api-reference/search-api/search.md, 1600 tokens) but since I want to use the SDK, I started looking for a great context for that.

I outline more on what I did [in this thread](https://x.com/janwilmake/status/1960395242391093620). **Tl;dr: It wasn't easy** but ended up using a 18k tokens `.d.ts` file generated using [api-extractor](https://api-extractor.com). I later [used AI](https://letmeprompt.com/rules-httpsuithu-nzfohl0) to reduce this further to [just 1500 tokens](https://rules-httpsuithu-nzfohl0.letmeprompt.com/parallel-search.d.ts).

Key takeaway is that I think it'd be huge if SDK Companies would provide the best of these files for us once, rather than all developers using different coding agents or other strategies independently to get this for us. My hope is this thread will spark some attention to this topic.

## Context for Cloudflare

Over the last 12 months I've built and deployed hundreds of workers on Cloudflare. I've recently even [hit the 500 workers limit](https://x.com/janwilmake/status/1954895768617361827), which luckily got increased after a request. After all of this, I created [this Cloudflare prompt](https://flaredream.com/system-ts.md) that works wonders for me. I use it all the time when I want to create a new worker. This prompt mainly addressses the knowledge gaps of Claude Sonnet regarding Cloudflare. I made this by iterating on building Cloudflare workers, and added and removed bits and pieces many times until I got to this.

## Additional requirements

In my specification I've listed a few more requirements and contexts, among others, I used https://assets.p0web.com to ensure AI followed my branding guidelines and used some assets, and instructed it to use https://cdn.tailwindcss.com to use Tailwind over regular CSS. This saves lots of lines!

# Building the app

Just to be clear, I didn't one-shot it at once, it took me many trial and error, and adopting the prompt. But after a few hours of improving context, [this was the prompt that did the job for me](SPEC.md). Remix it using my app LMPIFY using this button: [![](https://remix.forgithub.com/badge)](https://remix.forgithub.com/janwilmake/parallel-search-agent) - be sure to use Claude Sonnet or better/similar.

The main things I added iterating where things where there were multiple options and the AI didn't know which one to use. Primarily the Vercel AI SDK was confusing; Claude got confused because it used `cerebras` over `createCerebras` and `parameters` over `inputSchema`, and a few other things.

Using Parallel went quite well, although I had to be explicit for it not to use raw `fetch`, probably because my SDK context was quite bloated, and the docs included some `fetch` codesamples? This led the AI to choose the wrong implementation a few times, even after specifically requesting using the SDK, it still randomly made mistakes.

But in the end, [SPEC.md](SPEC.md) was all it took.

# How it works?

The AI SDK elegantly allows to use `/chat/completions` and other endpoints and tool use through an SDK that abstracts away a lot into a easier to use interface. The main benefit here is how tool-use is elegantly simplified. Within the `streamText` function we just need to specify this to perform up to 10 reasoning and tool use steps and stream back everything into a single stream. This really reduces boilerplate, a lot!

```ts
tools: { search: searchTool },
stopWhen: stepCountIs(10),
```

Trust me, I've done it without before (even before tool-use, using raw stop tokens) and if you don't want fine-grained control, it's better to just go with the AI SDK. You'll be done much faster.

# Takeaway

In this guide I showed you my process of collecting the right context and iterating over a specification rather than having a vibe conversation like most developers do. The resulting worker is an elegant implementation of under 700 lines of HTML and Typescript, especially leveraging the Vercel AI SDK (and Tailwind) to really reduce these amount of lines, making the code much more readable and editable for humans.
