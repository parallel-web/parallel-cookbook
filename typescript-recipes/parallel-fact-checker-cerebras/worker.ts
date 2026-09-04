/// <reference types="@cloudflare/workers-types" />
import { Parallel } from "parallel-web";
import { createCerebras } from "@ai-sdk/cerebras";
import { streamText } from "ai";
// @ts-ignore
import indexHtml from "./index.html";

export interface Env {
  PARALLEL_API_KEY: string;
  CEREBRAS_API_KEY: string;
}

// Constants
const MAX_CONTENT_LENGTH = 5000;

// Types for fact checking
interface Fact {
  id: string;
  text: string;
  sourceSpan: string;
  status: "pending" | "searching" | "verified" | "unsure" | "false";
  verdict?: string;
  explanation?: string;
  references?: Array<{
    title: string;
    url: string;
    excerpt?: string;
  }>;
}

// Generate unique IDs
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// SSE helper to send events
function sendSSE(controller: ReadableStreamDefaultController, encoder: TextEncoder, data: object) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

// Only these errors contain messages intended for the public demo UI.
class DemoError extends Error {}

function publicErrorMessage(error: any): string {
  if (error instanceof DemoError) return error.message;
  const cause = error?.lastError ?? error;
  const status = cause?.statusCode ?? cause?.status;
  if (status === 429) return "Service is currently rate limited. Please try again in a moment.";
  if (status === 401 || status === 403) {
    return "The demo cannot access an upstream service. Please contact the demo owner.";
  }
  if (status === 402) return "The demo's service credits are unavailable. Please contact the demo owner.";
  return "The fact-checking service is unavailable. Please try again later.";
}

// AI SDK textStream filters out error events. Consume fullStream so a failed
// inference request cannot look like empty content or an unsupported claim.
async function* modelText(result: ReturnType<typeof streamText>): AsyncGenerator<string> {
  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error;
    if (part.type === "text-delta") yield part.text;
  }
}

// Parse a fact line with format: FACT: [source span] ||| [claim]
function parseFactLine(line: string): { sourceSpan: string; text: string } | null {
  const factContent = line.replace("FACT:", "").trim();
  if (!factContent) return null;

  const separatorIndex = factContent.indexOf("|||");
  if (separatorIndex === -1) {
    return { sourceSpan: factContent, text: factContent };
  }

  const sourceSpan = factContent.substring(0, separatorIndex).trim();
  const text = factContent.substring(separatorIndex + 3).trim();

  if (!sourceSpan || !text) return null;
  return { sourceSpan, text };
}

// Extract facts from content using LLM streaming
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

CRITICAL: The text before ||| must be COPIED CHARACTER-FOR-CHARACTER from the input. Do not paraphrase, summarize, or modify it in any way. Copy-paste the exact substring.

RULES:
- Extract all verifiable claims (numbers, events, people, places) with meaningful content.
- Skip opinions and predictions
- Skip code
- Skip self-referential claims about the article itself (e.g., its publication date or authors)
- Do not verify the publish dates of referenced articles
- The quote before ||| will be highlighted in the UI, so it MUST match exactly
- The claim after ||| can be rephrased for clarity`,
      prompt: `Extract facts from this content. COPY the exact text for each quote:\n\n${content}`,
      maxOutputTokens: 2000,
    });

    let currentText = "";
    let totalResponse = "";

    for await (const chunk of modelText(factsResult)) {
      currentText += chunk;
      totalResponse += chunk;

      const lines = currentText.split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (line.startsWith("FACT:")) {
          const parsed = parseFactLine(line);
          if (parsed && !extractedFacts.some(f => f.sourceSpan === parsed.sourceSpan)) {
            const fact: Fact = {
              id: generateId(),
              text: parsed.text,
              sourceSpan: parsed.sourceSpan,
              status: "pending",
            };
            extractedFacts.push(fact);
            sendSSE(controller, encoder, { type: "fact_extracted", fact });
          }
        }
      }
      currentText = lines[lines.length - 1];
    }

    // Process remaining text
    if (currentText.trim().startsWith("FACT:")) {
      const parsed = parseFactLine(currentText.trim());
      if (parsed && !extractedFacts.some(f => f.sourceSpan === parsed.sourceSpan)) {
        const fact: Fact = {
          id: generateId(),
          text: parsed.text,
          sourceSpan: parsed.sourceSpan,
          status: "pending",
        };
        extractedFacts.push(fact);
        sendSSE(controller, encoder, { type: "fact_extracted", fact });
      }
    }

    // If no facts were found, throw so outer handler can deal with it
    if (extractedFacts.length === 0) {
      console.log("No facts extracted. Response length:", totalResponse.length);
      throw new DemoError("No verifiable claims were found in the content.");
    }
  } catch (error: any) {
    console.error("Error extracting facts:", error);
    // Re-throw to let outer handler deal with it
    throw error;
  }

  return extractedFacts;
}

// Verify a single fact using Parallel search and LLM
async function verifyFact(
  fact: Fact,
  parallel: Parallel,
  cerebras: ReturnType<typeof createCerebras>,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<void> {
  try {
    sendSSE(controller, encoder, { type: "fact_status", factId: fact.id, status: "searching" });

    // Search for evidence
    const searchResult = await parallel.search({
      objective: `Find reliable sources to verify or refute this claim: "${fact.text}"`,
      search_queries: [fact.text],
      mode: "basic",
      advanced_settings: {
        max_results: 5,
        excerpt_settings: { max_chars_per_result: 2000 },
      },
    });

    // Get verdict from LLM
    const verdictResult = streamText({
      model: cerebras("gpt-oss-120b"),
      temperature: 0,
      system: `You are a fact-checking expert. Analyze the provided evidence and determine if the claim is:
- VERIFIED: The evidence strongly supports the claim
- FALSE: The evidence contradicts the claim
- UNSURE: The evidence is insufficient or conflicting

Provide your response in this exact format:
VERDICT: [VERIFIED/FALSE/UNSURE]
EXPLANATION: [Brief 1-2 sentence explanation of your reasoning]`,
      prompt: `Claim to verify: "${fact.text}"

Evidence from web search:
${JSON.stringify(searchResult.results?.slice(0, 3).map((r: any) => ({
  title: r.title,
  excerpt: r.excerpts?.join("\n").slice(0, 2000)
})), null, 2)}

Analyze this evidence and provide your verdict.`,
      maxOutputTokens: 500,
    });

    let verdictText = "";
    for await (const chunk of modelText(verdictResult)) {
      verdictText += chunk;
    }

    const verdictMatch = verdictText.match(/^VERDICT:\s*(VERIFIED|FALSE|UNSURE)\s*$/im);
    const explanationMatch = verdictText.match(/^EXPLANATION:[ \t]*(.+)/im);
    if (!verdictMatch || !explanationMatch) {
      throw new DemoError("The fact-checking service returned an incomplete verdict. Please try again.");
    }
    const status = verdictMatch[1].toLowerCase() as Fact["status"];
    const explanation = explanationMatch[1].trim();

    const references = searchResult.results?.slice(0, 3).map((r: any) => ({
      title: r.title || "Source",
      url: r.url,
      excerpt: r.excerpts?.[0] || '',
    })) || [];

    sendSSE(controller, encoder, {
      type: "fact_verdict",
      factId: fact.id,
      status,
      explanation,
      references,
    });
  } catch (error: any) {
    console.error(`Error verifying fact ${fact.id}:`, error);

    const explanation = publicErrorMessage(error);

    sendSSE(controller, encoder, {
      type: "fact_verdict",
      factId: fact.id,
      status: "unsure",
      explanation,
      references: [],
    });
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    // Ensure required environment variables are present
    if (!env.PARALLEL_API_KEY || !env.CEREBRAS_API_KEY) {
      return new Response("Missing required API keys", { status: 500 });
    }

    const url = new URL(request.url);

    // Normalize pathname - strip base path if present
    const basePath = "/agents/cerebras-fact-checker";
    let pathname = url.pathname;

    if (pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length) || "/";
    }

    // Serve the HTML page
    if (request.method === "GET" && pathname === "/") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Handle content extraction from URL - streams cleaned content + fact checking
    if (request.method === "POST" && pathname === "/extract") {
      try {
        const { url: extractUrl } = await request.json() as { url: string };

        if (!extractUrl) {
          return new Response("URL is required", { status: 400 });
        }

        const parallel = new Parallel({ apiKey: env.PARALLEL_API_KEY });
        const cerebras = createCerebras({ apiKey: env.CEREBRAS_API_KEY });
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          async start(controller) {
            try {
              // Phase 1: Extract content from URL using Parallel
              sendSSE(controller, encoder, { type: "phase", phase: "extracting_url" });

              const extractResult = await parallel.extract({
                urls: [extractUrl],
                objective: "Extract the article text and key claims from this webpage",
                advanced_settings: { full_content: false },
              });

              if (!extractResult.results || extractResult.results.length === 0) {
                throw new DemoError("Could not extract content from URL");
              }

              const rawContent = extractResult.results[0].full_content ||
                extractResult.results[0].excerpts?.join('\n\n') || '';

              if (!rawContent) {
                throw new DemoError("No content found at URL");
              }

              // Truncate content if needed
              const wasTruncated = rawContent.length > MAX_CONTENT_LENGTH;
              const content = rawContent.slice(0, MAX_CONTENT_LENGTH);

              // Send truncated content
              sendSSE(controller, encoder, { type: "content_chunk", chunk: content });
              sendSSE(controller, encoder, {
                type: "content_complete",
                content: content,
                sourceUrl: extractUrl
              });

              // Warn if content was truncated
              if (wasTruncated) {
                sendSSE(controller, encoder, {
                  type: "warning",
                  message: "Content was truncated for this demo"
                });
              }

              // Phase 2: Extract facts
              sendSSE(controller, encoder, { type: "phase", phase: "extracting" });
              const extractedFacts = await extractFacts(content, cerebras, controller, encoder);

              // Phase 3: Verify facts in parallel
              sendSSE(controller, encoder, { type: "phase", phase: "verifying" });
              await Promise.all(
                extractedFacts.map(fact => verifyFact(fact, parallel, cerebras, controller, encoder))
              );

              sendSSE(controller, encoder, { type: "complete" });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            } catch (error: any) {
              console.error("Stream error:", error);
              sendSSE(controller, encoder, { type: "error", error: publicErrorMessage(error) });
              sendSSE(controller, encoder, { type: "complete" });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      } catch (error: any) {
        console.error("Extract error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Handle fact checking for pasted text content
    if (request.method === "POST" && pathname === "/check") {
      try {
        const { content } = await request.json() as { content: string };

        if (!content) {
          return new Response("Content is required", { status: 400 });
        }

        const parallel = new Parallel({ apiKey: env.PARALLEL_API_KEY });
        const cerebras = createCerebras({ apiKey: env.CEREBRAS_API_KEY });
        const encoder = new TextEncoder();

        const truncatedContent = content.slice(0, MAX_CONTENT_LENGTH);
        const wasTruncated = content.length > MAX_CONTENT_LENGTH;

        const stream = new ReadableStream({
          async start(controller) {
            try {
              // Warn if content was truncated
              if (wasTruncated) {
                sendSSE(controller, encoder, {
                  type: "warning",
                  message: "Content was truncated for this demo"
                });
              }

              // Phase 1: Extract facts
              sendSSE(controller, encoder, { type: "phase", phase: "extracting" });
              const extractedFacts = await extractFacts(truncatedContent, cerebras, controller, encoder);

              // Check if any facts were extracted - error already sent from extractFacts
              if (extractedFacts.length === 0) {
                sendSSE(controller, encoder, { type: "complete" });
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                return;
              }

              // Phase 2: Verify facts in parallel
              sendSSE(controller, encoder, { type: "phase", phase: "verifying" });
              await Promise.all(
                extractedFacts.map(fact => verifyFact(fact, parallel, cerebras, controller, encoder))
              );

              sendSSE(controller, encoder, { type: "complete" });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            } catch (error: any) {
              console.error("Stream error:", error);
              sendSSE(controller, encoder, { type: "error", error: publicErrorMessage(error) });
              sendSSE(controller, encoder, { type: "complete" });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      } catch (error: any) {
        console.error("Fact check error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
