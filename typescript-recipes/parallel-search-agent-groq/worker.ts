/// <reference types="@cloudflare/workers-types" />
import { Parallel } from "parallel-web";
import { createGroq } from "@ai-sdk/groq";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod/v4";
import { rateLimitMiddleware } from "./ratelimit";
//@ts-ignore
import indexHtml from "./index.html";

export interface Env {
  PARALLEL_API_KEY: string;
  GROQ_API_KEY: string;
  RATE_LIMIT_KV: KVNamespace;
}

function getClientIP(request: Request): string {
  const cfConnectingIP = request.headers.get("CF-Connecting-IP");
  if (cfConnectingIP) return cfConnectingIP;

  const xForwardedFor = request.headers.get("X-Forwarded-For");
  if (xForwardedFor) return xForwardedFor.split(",")[0].trim();

  const xRealIP = request.headers.get("X-Real-IP");
  if (xRealIP) return xRealIP;

  return "unknown";
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Ensure required environment variables are present
    if (!env.PARALLEL_API_KEY || !env.GROQ_API_KEY) {
      return new Response("Missing required API keys", { status: 500 });
    }

    if (!env.RATE_LIMIT_KV) {
      return new Response("Rate limiting service unavailable", { status: 500 });
    }

    // Serve the HTML page
    if (request.method === "GET") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Handle research requests with rate limiting
    if (request.method === "POST") {
      // Apply rate limiting - config builder gets access to request
      const rateLimitResponse = await rateLimitMiddleware(env.RATE_LIMIT_KV, {
        limits: [
          {
            name: "IP hourly",
            requests: 100,
            windowMs: 60 * 60 * 1000, // 1 hour
            limiter: getClientIP(request), // Actual IP address
          },
          {
            name: "Global per minute",
            requests: 100,
            windowMs: 60 * 1000, // 1 minute
            limiter: "global", // Hardcoded global limiter
          },
          {
            name: "Global daily",
            requests: 10000,
            windowMs: 24 * 60 * 60 * 1000, // 1 day
            limiter: "global", // Hardcoded global limiter
          },
        ],
      });

      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      try {
        const { query, systemPrompt } = await request.json<any>();
        console.log({ query });
        if (!query) {
          return new Response("Query is required", { status: 400 });
        }

        const execute = async ({ objective }) => {
          const parallel = new Parallel({
            apiKey: env.PARALLEL_API_KEY,
          });

          const searchResult = await parallel.beta.search({
            // Choose objective or search queries. We choose objective because it allows natural language way of describing what you're looking for
            objective,
            search_queries: undefined,
            // "base" works best for apps where speed is important, while "pro" is better when freshness and content-quality is critical
            processor: "base",

            source_policy: {
              exclude_domains: undefined,
              include_domains: undefined,
            },
            max_results: 10,
            // Keep low to save tokens
            max_chars_per_result: 2500,
          });
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
              .describe(
                "Natural-language description of your research goal (max 200 characters)"
              ),
          }),
          execute,
        });

        // Initialize Groq provider
        const groq = createGroq({
          apiKey: env.GROQ_API_KEY,
        });

        // Stream the research process
        const result = streamText({
          model: groq("meta-llama/llama-4-maverick-17b-128e-instruct"),
          system:
            systemPrompt ||
            `You are a search agent with access to a web search tool. You MUST use the search tool to gather information before providing your final answer.

Instructions:
1. For ANY user query, first use the search tool with a relevant objective
2. You can make 1-3 searches from different angles if needed
3. After gathering search results, provide a comprehensive final answer

The current date is ${new Date(Date.now()).toISOString().slice(0, 10)}

IMPORTANT: Always start by using the search tool - do not provide answers without first searching!`,
          prompt: query,
          tools: { search: searchTool },
          toolChoice: "auto",
          stopWhen: stepCountIs(25),
          maxOutputTokens: 8000,
        });

        // Return the streaming response
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of result.fullStream) {
                const data = `data: ${JSON.stringify(chunk)}\n\n`;
                controller.enqueue(encoder.encode(data));
              }
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            } catch (error) {
              console.error("Stream error:", error);
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "error",
                    error: error.message || "Unknown error occurred",
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
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      } catch (error) {
        console.error("Research error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
