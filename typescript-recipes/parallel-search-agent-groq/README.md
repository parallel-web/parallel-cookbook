# Building a Full-Stack Search Agent with Parallel and Groq

[![janwilmake/parallel-search-agent context](https://badge.forgithub.com/janwilmake/parallel-search-agent?lines=false)](https://uithub.com/janwilmake/parallel-search-agent?lines=false) [![](https://remix.forgithub.com/badge)](https://remix.forgithub.com/janwilmake/parallel-search-agent)

This guide demonstrates how to build a web research agent that combines Parallel's GA Search API with streaming AI inference. By the end, you'll have a complete search agent that shows searches, results, AI responses, measured retrieval and model usage, and clearly labeled cost estimates as they stream in real time.

Complete app available at: https://oss.parallel.ai/agent/

## The Architecture

The search agent we're building includes:

- A simple search homepage
- User-editable system prompt in config modal
- Agent connection through Parallel Search API tool use
- Streaming searches, search results, AI reasoning, and AI responses
- Measured Search latency and context volume, provider-reported model tokens, and configurable cost assumptions
- Clean rendering of results as they arrive

Our technology stack:

- [Parallel TypeScript SDK](https://www.npmjs.com/package/parallel-web) for the Search API
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction) for AI orchestration
- [Groq](https://ai-sdk.dev/providers/ai-sdk-providers/groq) with Llama 4 Maverick 17B for fast responses
- [Cloudflare Workers](https://workers.cloudflare.com/) for deployment

## Why This Architecture Works

### Search API vs Traditional Agent Search Architecture

Parallel's Search API is designed for machines from first principles. The key difference from other search APIs like Exa or Tavily is that it provides all required context in a single API call. Other search approaches typically require two separate calls - one for getting the search engine results page (SERP), another for scraping the relevant pages. This traditional approach is slower and more token-heavy for the LLM.

Parallel streamlines this by finding the most relevant context from all pages immediately, returning only the relevant content to reduce context bloat. Our Search API [benchmark](https://parallel.ai/blog/search-api-benchmark) demonstrates that the Parallel Search API being used in an agentic workflow can translate to up to 20% gains in accuracy vs other Search providers.

The diagram also illustrates how the AI agent can iteratively call the Search API multiple times, allowing it to explore different angles and gather comprehensive information before providing a final response. This multi-step capability is essential for true agentic behavior.

<img width="500" height="1000" alt="image" src="https://github.com/user-attachments/assets/6cdcab20-5a03-427d-9dfd-7966cc0d554b" />

### Choosing the Vercel AI SDK

Most AI providers ship models with built-in tool calling via /chat/completions endpoints. However, doing tool calling in a streaming fashion requires working with Server-Sent Events and multiple API round trips, which is complex to implement correctly.

The Vercel AI SDK elegantly abstracts provider-specific quirks and allows calling most providers with most of their features from a unified interface. This eliminates the need to work directly with raw API specifications and handle the back-and-forth tool calling manually.

The SDK offers multiple approaches for building this agent. While we use vanilla HTML/JavaScript for simplicity, the same backend can work with React frontends using AI SDK UI components for more sophisticated interfaces. The streaming approach we demonstrate works across different frontend frameworks, giving you flexibility in your implementation choice.

## Implementation

Now that we understand the architectural advantages, let's walk through building this search agent step by step.

### Dependencies and Setup

```bash
cd typescript-recipes/parallel-search-agent-groq
npm install
cp .env.example .dev.vars
```

Add your `PARALLEL_API_KEY` and `GROQ_API_KEY` to `.dev.vars`. Then run the deterministic economics tests and start the existing local worker:

```bash
npm test
npm run dev
```

Open the Wrangler URL printed in your terminal, normally `http://localhost:8787`, or inspect the complete event stream directly:

```bash
curl -N http://localhost:8787/ \
  -H 'Content-Type: application/json' \
  -d '{"query":"What recent product changes should an AI developer know about Parallel Search?"}'
```

The final `finish` event includes an `economics` object. Each invocation makes real model and Search API calls, so latency, returned context, token usage, and estimated cost vary. The tests require no API keys, network access, or model calls.

To prevent TypeScript's "Type instantiation is excessively deep" error, zod requires a version suffix. Import the required functions:

```typescript
import Parallel from "parallel-web";
import { createGroq } from "@ai-sdk/groq";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod/v4";
import { createEconomicsTracker, readEconomicsConfig } from "./economics";
```

### Defining the Search Tool

This section covers setting up the core search functionality that will power our AI agent:

```typescript
const economicsConfig = readEconomicsConfig(env);
const economics = createEconomicsTracker(economicsConfig);

const execute = async ({ objective }) => {
  const parallel = new Parallel({
    apiKey: env.PARALLEL_API_KEY,
  });

  const startedAt = performance.now();
  const searchResult = await parallel.search({
    objective,
    search_queries: [objective],
    mode: economicsConfig.searchMode,
    max_chars_total: 25_000,
    advanced_settings: {
      max_results: 10,
      excerpt_settings: { max_chars_per_result: 2_500 },
    },
  });

  economics.recordSearch(searchResult, performance.now() - startedAt);
  return searchResult;
};

// Define the search tool
const searchTool = tool({
  description: `# Web Search Tool

**Purpose:** Perform web searches and return LLM-friendly results.

**Usage:**
- objective: Natural-language description of your research goal (max 200 characters)

**Best Practices:**
- Be specific about what information you need
- Mention if you want recent/current data
- Keep objectives concise but descriptive`,
  inputSchema: z.object({
    objective: z
      .string()
      .max(200)
      .describe(
        "Natural-language description of your research goal (max 200 characters)"
      ),
  }),
  execute,
});
```

### Key implementation choices:

- The model writes a natural-language objective, and the Search tool also supplies it as the nonempty `search_queries` array required by GA Search.
- `basic` preserves the closest GA equivalent to the legacy one-shot integration. Set `PARALLEL_SEARCH_MODE=turbo`, `fast`, `basic`, or `advanced` to compare modes on your own workload.
- The existing limit of ten sources with at most 2,500 excerpt characters each remains in place. Character and byte measurements describe retrieved context, not tokenizer output.

## Creating the Streaming Agent

Here we set up the core AI agent with multi-step reasoning capabilities:

```typescript
// Initialize Groq provider
const groq = createGroq({
  apiKey: env.GROQ_API_KEY,
});

// Stream the research process
const result = streamText({
  model: groq("meta-llama/llama-4-maverick-17b-128e-instruct"),
  system:
    systemPrompt ||
    `You are a simple search agent. Your mission is to comprehensively fulfill the user's search objective by conducting 1 up to 3 searches from different angles until you have gathered sufficient information to provide a complete answer. The current date is ${new Date(
      Date.now()
    )
      .toISOString()
      .slice(0, 10)}

**Research Philosophy:**
- Each search should explore a unique angle or aspect of the topic
- NEVER try to OPEN an article, the excerpts provided should be enough

**Key Parameters:**
- objective: Describe what you're trying to accomplish. This helps the search engine understand intent and provide relevant results.

**Output:**
After doing the searches required, write up your 'search report' that answers the initial search query. Even if you could not answer the question ensure to always provide a final report! Please do NOT use markdown tables. 
`,
  prompt: query,
  tools: { search: searchTool },
  stopWhen: stepCountIs(25),
  maxOutputTokens: 20000,
});
```

### Important configuration details:

The `stepCountIs(25)` parameter allows the agent to make multiple search calls and reasoning steps, enabling thorough research across different angles before providing a comprehensive response.

The system prompt guides the agent to conduct multiple searches from different perspectives, which is crucial for comprehensive research.

`.dev.vars`

```bash
GROQ_API_KEY=YOUR_KEY
PARALLEL_API_KEY=YOUR_KEY
PARALLEL_SEARCH_MODE=basic
```

## Measure the actual integration economics

Every completed agent response reports:

- **Measured:** successful Search calls, Search mode, per-call and aggregate client-side Search latency, returned source and excerpt counts, Unicode excerpt characters, serialized tool-result bytes, and total wall-clock workflow duration.
- **Provider-reported:** aggregated model input, output, and total token counts from the AI SDK's final `totalUsage` event. A missing count remains `null`; excerpt characters and bytes are never presented as tokens.
- **Assumed and estimated:** Search and model costs derived from your configured per-unit rates. The total remains `null` until both model rates and actual input/output token counts are available.

Search prices default to the [published Parallel pricing](https://docs.parallel.ai/getting-started/pricing): `turbo` and `fast` are `$1 / 1,000 requests`, while `basic` and `advanced` are `$5 / 1,000 requests`, each including ten results. These defaults are pricing assumptions, not billing receipts. Verify current pricing and override them if your plan differs:

```bash
# Example configuration only. Replace the model rates with your actual plan.
PARALLEL_SEARCH_MODE=turbo
PARALLEL_SEARCH_USD_PER_1K=1
MODEL_INPUT_USD_PER_1M=YOUR_INPUT_PRICE_PER_MILLION
MODEL_OUTPUT_USD_PER_1M=YOUR_OUTPUT_PRICE_PER_MILLION
```

The estimate uses `search calls × Search price / 1,000` and `(input tokens × input price + output tokens × output price) / 1,000,000`. This recipe requests at most the ten results included in the published Search price. It does not estimate cache discounts, reasoning-specific token rates, taxes, provider credits, unsuccessful requests, or contractual discounts. No benchmark, competitor comparison, or representative latency is implied: run the workflow with your own keys and inputs to collect real measurements.

For a credential-free, reproducible check of Unicode context measurement, multi-call aggregation, GA mode pricing, missing provider usage, invalid configuration, and model-cost arithmetic:

```bash
npm test
```

The fixture values in those tests are deterministic arithmetic examples, not live benchmark results.

## Streaming Response Handler

This section handles the real-time streaming of agent responses to the frontend:

```typescript
// Return the streaming response
const encoder = new TextEncoder();
const stream = new ReadableStream({
  async start(controller) {
    try {
      for await (const chunk of result.fullStream) {
        const event =
          chunk.type === "finish"
            ? { ...chunk, economics: economics.summarize(chunk.totalUsage) }
            : chunk;
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    } catch (error) {
      console.error("Stream error:", error);
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "error",
            error: error.message,
          })}\n\n`
        )
      );
    } finally {
      controller.close();
    }
  },
});

return new Response(stream, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  },
});
```

## Cloudflare Workers Deployment

### Configuration

```json
{
  "$schema": "https://unpkg.com/wrangler@latest/config-schema.json",
  "name": "web-research-agent",
  "main": "worker.ts",
  "compatibility_date": "2025-07-14",
  "route": { "custom_domain": true, "pattern": "yourdomain.com" }
}
```

## Deployment Process

Requirements:

- Node.js
- Wrangler CLI
- Cloudflare account

Before deploying, submit your secrets:

```bash
wrangler secret bulk .env
```

Deploy with:

```bash
wrangler deploy
```

## Frontend Implementation

The worker also serves the frontend at the root path:

```
import indexHtml from "./index.html";

// in your handler:
if (request.method === "GET" && url.pathname === "/") {
  return new Response(indexHtml, {
    headers: { "Content-Type": "text/html" },
  });
}
```

### Handling the Stream

The frontend processes the streaming responses in real-time:

```typescript
async function startResearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  showLoadingState();
  currentMode = "text";

  // Abort any existing request
  if (abortController) {
    abortController.abort();
  }

  abortController = new AbortController();

  try {
    const response = await fetch("/api/research", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: query,
        systemPrompt: currentSystemPrompt || undefined,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error("No response body");
    }

    let buffer = "";
    showResults(); // Show results interface when stream starts

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep the last incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            return;
          }

          try {
            const chunk = JSON.parse(data);
            handleStreamChunk(chunk);
          } catch (error) {
            console.error("Error parsing chunk:", error, data);
          }
        }
      }
    }
  } catch (error) {
    if (error.name === "AbortError") {
      console.log("Request was aborted");
    } else {
      console.error("Research error:", error);
      showError(`Research failed: ${error.message}`);
    }
  } finally {
    abortController = null;
  }
}

function handleStreamChunk(chunk) {
  switch (chunk.type) {
    case "text-delta":
      if (currentMode === "reasoning") {
        finalizeCurrentSection();
        currentMode = "text";
      }
      appendText(chunk.text || "");
      break;
    case "reasoning-delta":
      if (currentMode === "text") {
        finalizeCurrentSection();
        currentMode = "reasoning";
      }
      appendReasoning(chunk.text || "");
      break;
    case "tool-call":
      finalizeCurrentSection();
      addToolCall(chunk);
      break;
    case "tool-result":
      addToolResult(chunk);
      break;
    case "error":
      showError(chunk.error?.message);
      break;
    case "finish":
      finalizeCurrentSection();
      addFinishIndicator(chunk.finishReason, chunk.economics);
      console.log("Research completed with reason:", chunk.finishReason);
      break;
  }
}
```

## Styling and Dependencies

The frontend uses https://cdn.tailwindcss.com for styling, which reduces the lines needed for clean design without additional dependencies. The implementation uses regular HTML rather than React or other frameworks, making it accessible and easy to understand.

## Development Context and Resources

The complete source files provide essential context for both backend logic and frontend streaming:

Essential source files:

- `worker.ts` - Complete backend implementation
- `economics.ts` - Measured retrieval, provider usage, and explicit pricing assumptions
- `economics.test.mjs` - Deterministic, credential-free regression coverage
- `index.html` - Frontend with streaming UI

These files contain the complete TypeScript definitions and HTML implementation that are essential for understanding the full integration between the Parallel Search API and the streaming frontend.

When altering the front-end implementation, having proper Typescript context is crucial for developer experience. The AI SDK Stubs file (https://unpkg.com/ai@5.0.22/dist/index.d.ts) was used to overcome the limited dev tooling for plain-HTML front-ends. More context can be found in `SPEC.md`.

## Model Considerations

The guide uses Llama 4 Maverick 17B on Groq, which provides excellent speed and tool-calling capabilities with extended context length (128k tokens). This newer model offers improved performance while maintaining fast inference speeds on Groq's platform.

> This version uses Groq's Llama 4 Maverick 17B model with 128k context length, providing excellent tool-calling capabilities with fast inference speeds and extended context understanding for complex search tasks.

## Production Considerations

This demonstration omits several production requirements:
Authentication: No user authentication is implemented

- Rate limiting: Uses the configured Cloudflare KV namespace; configure your own namespace for deployment
- Error handling: Basic error handling is shown but could be expanded
- Monitoring: No observability or logging beyond basic console output

Adding these features would be important next steps for enterprise deployment.

The resulting agent demonstrates real-time streaming of search operations, multi-step AI reasoning with tool use, clean separation of search logic and presentation, and serverless deployment ready for scaling. The architecture shows how modern AI SDKs can simplify complex multi-step agent workflows while maintaining performance and user experience quality.

Resources:

- [Complete source code](https://github.com/parallel-web/parallel-cookbook/tree/main/typescript-recipes/parallel-search-agent)
- [Parallel API documentation](https://docs.parallel.ai/)
- [Search migration guide](https://docs.parallel.ai/search/search-migration-guide)
- [Current Search pricing](https://docs.parallel.ai/getting-started/pricing)
- [Get Parallel API keys](https://platform.parallel.ai/)
