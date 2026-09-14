# Building a Real-Time Fact Checker with Parallel and Cerebras

This guide demonstrates how to build a fact-checking application that extracts verifiable claims from text or URLs and validates them using web search. By the end, you'll have a complete streaming fact checker with a polished frontend that shows claims being extracted and verified in real-time.

## How It Works

1. User pastes text or enters a URL
2. Content is extracted (for URLs) and truncated if needed
3. LLM extracts verifiable factual claims from the content
4. Each claim is searched on the web using Parallel's Search API
5. LLM analyzes the search results to determine if each claim is Verified, Unsure, or False
6. Results stream to the UI in real-time with source citations

## The Architecture

The fact checker combines several technologies:

- [Parallel TypeScript SDK](https://www.npmjs.com/package/parallel-web) for Search and Extract APIs
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction) for LLM orchestration and streaming
- [Cerebras](https://ai-sdk.dev/providers/ai-sdk-providers/cerebras) for fast inference
- [Cloudflare Workers](https://workers.cloudflare.com/) for serverless deployment

### Why Parallel's Search API?

Traditional fact-checking approaches require multiple API calls: one to search, another to scrape relevant pages. Parallel's Search API combines these into a single call that returns relevant content directly, reducing latency and token usage.

The Search API is designed for machine consumption, returning only the most relevant context from found pages rather than raw HTML. This makes it ideal for feeding into LLMs for analysis.

## Implementation

### Dependencies

```bash
npm install parallel-web @ai-sdk/cerebras ai
```

### Configuration

The app uses a constant for content length limits:

```typescript
const MAX_CONTENT_LENGTH = 5000;
```

### Core Types

The application tracks facts through various states:

```typescript
interface Fact {
  id: string;
  text: string;           // The claim to verify
  sourceSpan: string;     // Exact text from source (for highlighting)
  status: "pending" | "searching" | "verified" | "unsure" | "false";
  explanation?: string;
  references?: Array<{
    title: string;
    url: string;
    excerpt?: string;
  }>;
}
```

### Extracting Facts from Content

Facts are extracted using streaming LLM inference with `temperature: 0` for consistent results. The prompt asks for exact quotes from the source text (for UI highlighting) paired with the claim to verify:

```typescript
async function extractFacts(
  content: string,
  cerebras: ReturnType<typeof createCerebras>,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<Fact[]> {
  const extractedFacts: Fact[] = [];

  try {
    const factsResult = streamText({
      model: cerebras("gpt-oss-120b"),
      temperature: 0,
      system: `You are a claim extraction expert. Extract verifiable claims from content.

OUTPUT FORMAT - use this EXACT format for each fact (one per line):
FACT: [EXACT QUOTE] ||| [claim to verify]

CRITICAL: The text before ||| must be COPIED CHARACTER-FOR-CHARACTER from the input.

RULES:
- Extract all verifiable claims (dates, numbers, events, people, places)
- Skip opinions and predictions
- Skip self-referential claims about the article itself
- The quote before ||| will be highlighted in the UI, so it MUST match exactly
- The claim after ||| can be rephrased for clarity`,
      prompt: `Extract facts from this content:\n\n${content}`,
      maxOutputTokens: 2000,
    });

    // Stream facts as they're extracted
    for await (const chunk of modelText(factsResult)) {
      // Parse complete FACT: lines and emit them immediately
      // ...
    }
  } catch (error) {
    // Handle rate limits and other errors
    // ...
  }

  return extractedFacts;
}
```

### Verifying Facts with Web Search

Each fact is verified by searching for evidence and having the LLM analyze the results:

```typescript
async function verifyFact(
  fact: Fact,
  parallel: Parallel,
  cerebras: ReturnType<typeof createCerebras>,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<void> {
  try {
    // Search for evidence using Parallel
    const searchResult = await parallel.search({
      objective: `Find reliable sources to verify or refute this claim: "${fact.text}"`,
      search_queries: [fact.text],
      mode: "basic",
      advanced_settings: {
        max_results: 5,
        excerpt_settings: { max_chars_per_result: 2000 },
      },
    });

    // Have LLM analyze the evidence
    const verdictResult = streamText({
      model: cerebras("gpt-oss-120b"),
      temperature: 0,
      system: `You are a fact-checking expert. Analyze the provided evidence and determine if the claim is:
- VERIFIED: The evidence strongly supports the claim
- FALSE: The evidence contradicts the claim
- UNSURE: The evidence is insufficient or conflicting

Provide your response in this exact format:
VERDICT: [VERIFIED/FALSE/UNSURE]
EXPLANATION: [Brief 1-2 sentence explanation]`,
      prompt: `Claim to verify: "${fact.text}"

Evidence from web search:
${JSON.stringify(searchResult.results?.slice(0, 3).map(r => ({
  title: r.title,
  excerpt: r.excerpts?.join("\n").slice(0, 2000)
})), null, 2)}`,
      maxOutputTokens: 500,
    });

    // Parse verdict and send to client...
  } catch (error) {
    // Handle rate limits gracefully
    // ...
  }
}
```

### Parallel Verification for Speed

Facts are verified concurrently to minimize total latency:

```typescript
await Promise.all(
  extractedFacts.map(fact => verifyFact(fact, parallel, cerebras, controller, encoder))
);
```

### URL Extraction with Parallel Extract API

When a user provides a URL, we extract the content using Parallel's Extract API:

```typescript
const extractResult = await parallel.extract({
  urls: [extractUrl],
  objective: "Extract the article text and key claims from this webpage",
  advanced_settings: { full_content: false },
});

const rawContent = extractResult.results[0].full_content ||
  extractResult.results[0].excerpts?.join('\n\n') || '';

// Truncate content if needed
const wasTruncated = rawContent.length > MAX_CONTENT_LENGTH;
const content = rawContent.slice(0, MAX_CONTENT_LENGTH);

if (wasTruncated) {
  sendSSE(controller, encoder, {
    type: "warning",
    message: "Content was truncated for this demo"
  });
}
```

### Streaming with Server-Sent Events

Results stream to the frontend using SSE for real-time updates:

```typescript
function sendSSE(controller: ReadableStreamDefaultController, encoder: TextEncoder, data: object) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

// Usage in the stream
sendSSE(controller, encoder, { type: "fact_extracted", fact });
sendSSE(controller, encoder, { type: "fact_verdict", factId, status, explanation, references });
sendSSE(controller, encoder, { type: "warning", message: "Content was truncated for this demo" });
sendSSE(controller, encoder, { type: "error", error: "Demo is experiencing high traffic. Please try again later." });
```

The `modelText` helper consumes the AI SDK's `fullStream` and throws on error events. Reading `textStream` alone silently filters those events out, which can make failed inference look like content with no claims. Only an actual empty response should be reported as having no verifiable claims.

The frontend handles these events to update the UI in real-time, showing facts as they're extracted and verdicts as they arrive.

## Setup

### Install Dependencies

```bash
npm install
```

### Configure API Keys

Create a `.dev.vars` file for local development:

```
PARALLEL_API_KEY=your_parallel_api_key_here
CEREBRAS_API_KEY=your_cerebras_api_key_here
```

Get your API keys:
- [Parallel API Key](https://platform.parallel.ai/)
- [Cerebras API Key](https://cloud.cerebras.ai/)

### Development

```bash
npm run dev
```

## Deployment (Cloudflare Workers)

1. Login to Cloudflare:
   ```bash
   npx wrangler login
   ```

2. Add secrets:
   ```bash
   npx wrangler secret put PARALLEL_API_KEY
   npx wrangler secret put CEREBRAS_API_KEY
   ```

3. Deploy:
   ```bash
   npm run deploy
   ```

## API Endpoints

### `POST /check`
Fact-check pasted text content. Content is truncated to 5,000 characters.

**Request:**
```json
{ "content": "Text to fact check..." }
```

**Response:** SSE stream with fact extraction and verification events.

### `POST /extract`
Extract content from URL and fact-check it. Content is truncated to 5,000 characters.

**Request:**
```json
{ "url": "https://example.com/article" }
```

**Response:** SSE stream including content extraction, fact extraction, and verification.

## SSE Event Types

| Event Type | Description |
|------------|-------------|
| `phase` | Current processing phase (extracting_url, extracting, verifying) |
| `content_chunk` | Streamed content chunk (URL extraction only) |
| `content_complete` | Full content ready |
| `fact_extracted` | New fact identified |
| `fact_status` | Fact status update (e.g., "searching") |
| `fact_verdict` | Final verdict with explanation and sources |
| `warning` | Warning message (e.g., content truncated, rate limit hit) |
| `error` | Error occurred |
| `complete` | Processing finished |

## Validation and operations

Run `npm test` for regression tests and `npm run typecheck` for TypeScript validation. Test both pasted text and URL input with working keys before deployment.

The public demo runs as the `cerebras-fact-checker` Cloudflare Worker. Worker invocation logs are enabled in `wrangler.jsonc`. In Cloudflare, use Workers & Pages to inspect this Worker's Metrics and Observability views. Request counts include page loads and API requests; filter by `/check` and `/extract` where possible. A streamed application error can still return HTTP 200, so HTTP success counts alone do not measure successful fact checks.

There is no browser analytics or conversion-event instrumentation in this recipe. Cloudflare traffic and logs can help diagnose usage and failures, but they do not provide a visitor-to-successful-check funnel. Parallel org usage counts API calls, which can include several searches per fact-checking session.

If the deployed demo fails while local tests work, inspect the deployed Worker's inference errors and the credentials in the correct environment. Do not copy a personal key into the public demo. Provision the demo's own service credentials, then test both input paths again.

## Demo Limitations

This demo has several limitations:

- **Content truncation**: Text is limited to 5,000 characters
- **Rate limiting**: May experience rate limits during high traffic
- **No authentication**: No user authentication implemented
- **No caching**: Results are not cached

## Resources

- [Parallel API Documentation](https://docs.parallel.ai/)
- [Get Parallel API Keys](https://platform.parallel.ai/)
- [Cerebras Documentation](https://inference-docs.cerebras.ai/)
- [Vercel AI SDK](https://ai-sdk.dev/)
