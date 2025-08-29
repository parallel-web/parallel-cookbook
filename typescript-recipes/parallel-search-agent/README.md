# Building a Web Research Agent with Parallel Search API - A Complete Guide

[![janwilmake/parallel-search-agent context](https://badge.forgithub.com/janwilmake/parallel-search-agent?lines=false)](https://uithub.com/janwilmake/parallel-search-agent?lines=false) [![](https://remix.forgithub.com/badge)](https://remix.forgithub.com/janwilmake/parallel-search-agent) | Discuss: [HN Thread](https://news.ycombinator.com/item?id=45038332) | [X Thread](https://x.com/janwilmake/status/1960669482697023920)

In this guide, we'll demonstrate how to build a sophisticated Web Research Agent using Parallel's Search API and deploy it with a simple frontend interface. By the end of this tutorial, you'll have created a search agent like the one shown in [this demo](https://x.com/janwilmake/status/1960652955251589355) (try it out at https://agent.p0web.com as long as there's still Cerebras & Parallel credit left).

## Why Parallel Search API?

Parallel's Search API introduces a [fundamentally different approach to search](https://parallel.ai/blog/parallel-search-api) that [outperforms traditional methods](https://parallel.ai/blog/search-api-benchmark) in comprehensive benchmarks. Unlike conventional Search APIs such as Exa or Tavily, which require multiple API calls (one for SERP results, another for page content extraction), Parallel delivers all necessary context in a single API call.

This AI-native approach streamlines the entire search process by intelligently identifying and extracting only the most relevant content from all pages immediately, significantly reducing context bloat while maximizing relevance.

## What We'll Build

The Web Research Agent we'll create will feature:

- A clean search homepage interface
- Configurable system prompt via a modal
- Intelligent search capabilities through tool integration
- Real-time streaming of search results and AI reasoning

## Technology Stack

We'll leverage the following modern technologies:

- [Parallel Typescript SDK](https://docs.parallel.ai/home) for search functionality
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction) for AI orchestration
- [Cerebras](https://ai-sdk.dev/providers/ai-sdk-providers/cerebras) for ultra-fast AI responses
- [Cloudflare Workers](https://workers.cloudflare.com) for scalable deployment

# Context Engineering: The Foundation of Effective Agents

**This implementation demonstrates a complete working solution** (available [here](https://github.com/janwilmake/parallel-search-agent)) that was developed through careful context engineering. Understanding how to properly gather context for building AI agents is crucial for building reliable, production-ready systems.

## Gathering Context for the AI SDK

The Vercel AI SDK requires comprehensive context for optimal implementation. The most effective approach involves collecting documentation from multiple authoritative sources:

**Primary Documentation Sources:**

- AI SDK core types: https://unpkg.com/ai@5.0.22/dist/index.d.ts
- Cerebras provider types: https://unpkg.com/@ai-sdk/cerebras@1.0.11/dist/index.d.ts
- Cerebras model specifications: https://inference-docs.cerebras.ai/api-reference/models.md
- Agent implementation patterns: https://uithub.com/vercel/ai/blob/main/content/docs/02-foundations/06-agents.mdx

**Why Agent Documentation Matters:**

Initial attempts based on just the AI SDK types resulted in inconsistent implementations across multiple trials. The [agents documentation](https://ai-sdk.dev/docs/foundations/agents) from the AI SDK proved essential for understanding the optimal approach to building agents capable of multiple tool calls and reasoning steps in a single streamlined interaction.

## Gathering Context for Parallel Search

For comprehensive integration with Parallel's Search API, we gathered documentation from these key sources:

**Essential Documentation:**

- Search API Quickstart: https://docs.parallel.ai/search-api/search-quickstart.md
- Search Processors Guide: https://docs.parallel.ai/search-api/processors.md

**API Definition Strategy:**

Rather than using raw fetch calls or incomplete documentation, we obtained the complete API definition to understand all properties, response shapes, and error handling patterns. This involved using the Search operation OpenAPI spec (available through mintlify at https://docs.parallel.ai/api-reference/search-api/search.md, approximately 1600 tokens).

For SDK-specific implementation, we utilized a comprehensive `.d.ts` file generated using [api-extractor](https://api-extractor.com). The original 18k token file was later [optimized using AI](https://letmeprompt.com/rules-httpsuithu-nzfohl0) to [a focused 1500-token version](https://rules-httpsuithu-nzfohl0.letmeprompt.com/parallel-search.d.ts).

**Industry Recommendation:**

We believe SDK providers should offer optimized context files like these as standard resources, rather than requiring each developer to independently generate them through various strategies.

## Cloudflare Workers Context

Our deployment strategy leverages extensive Cloudflare Workers experience (including reaching the 500 workers limit, which was subsequently increased upon request). This experience informed the creation of [a specialized Cloudflare prompt](https://flaredream.com/system-ts.md) that addresses common knowledge gaps in AI assistants regarding Cloudflare Workers deployment patterns.

This prompt was refined through hundreds of worker deployments and represents battle-tested patterns for Cloudflare Workers development.

## Additional Context Requirements

The implementation specification includes several additional context elements:

- Brand guidelines and assets from https://assets.p0web.com to ensure consistent visual identity
- Tailwind CSS integration via https://cdn.tailwindcss.com for streamlined styling without verbose CSS
- Specific implementation patterns and architectural decisions (Choosing these required several iterations to determine, reviewing the result each time)

# Implementation Process

The complete specification that achieved the desired implementation is available in [SPEC.md](SPEC.md). This represents the culmination of iterative context refinement and can be remixed using the LMPIFY app: [![](https://remix.forgithub.com/badge)](https://remix.forgithub.com/janwilmake/parallel-search-agent). We recommend using Claude Sonnet or equivalent models for optimal results.

## Key Implementation Refinements

The primary challenges resolved through specification iteration involved:

**AI SDK Configuration:**

- Clarifying the use of `createCerebras` over `cerebras`
- Specifying `inputSchema` over `parameters` for tool definitions
- Resolving various SDK-specific naming conventions

**Parallel SDK Integration:**

- Ensuring SDK usage over raw `fetch` implementations
- Addressing confusion from documentation code samples that included `fetch` examples
- Maintaining consistent SDK patterns throughout the implementation

The final [SPEC.md](SPEC.md) provides a complete, working specification.

> [!NOTE]
> Based on community feedback, we've implemented additional iterations available at: https://letmeprompt.com/httpsuithubcomp-lktkuq0

# Architecture Overview

The implementation leverages the Vercel AI SDK's elegant abstraction over `/chat/completions` and tool use patterns. The key advantage lies in the simplified tool integration approach:

```typescript
tools: { search: searchTool },
stopWhen: stepCountIs(10),
```

This configuration enables up to 10 reasoning and tool use steps with streaming responses in a single API call, dramatically reducing boilerplate code compared to manual tool use implementations.

The AI SDK's abstraction layer eliminates the complexity of managing raw stop tokens and tool use patterns, enabling developers to focus on business logic rather than integration mechanics.

# Key Takeaways

This guide demonstrates a systematic approach to software development through:

1. **Comprehensive Context Engineering**: Gathering authoritative documentation from multiple sources
2. **Specification-Driven Development**: Iterating on specifications rather than ad-hoc conversational development, a.k.a. "vibe-coding".
3. **Modern Toolchain Integration**: Leveraging the Vercel AI SDK and Tailwind CSS for minimal, readable code

The resulting implementation comprises under 1000 lines of HTML and TypeScript, showcasing the power of well-chosen abstractions and comprehensive context engineering. This approach prioritizes code readability and maintainability while delivering production-ready functionality.

[Our demo](https://agent.p0web.com) showcases how GPT-OSS120B hosted on Cerebras can be used with Parallel Web Search as a tool creating highly performant agentic web search. Initial tests showcase the performance of GPT-OSS120B is not always perfect, and can likely be further optimized by fine-tuning the model or choosing a bigger, more reliable reasoning model.

The methodology presented here - from context collection through specification refinement to final implementation - provides a replicable framework for building sophisticated AI agents with Parallel's Search API and modern web technologies.
