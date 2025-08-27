/// <reference types="@cloudflare/workers-types" />
import { Parallel } from "parallel-web";
import { createCerebras } from "@ai-sdk/cerebras";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod/v4";
//@ts-ignore
import indexHtml from "./index.html";

export interface Env {
  PARALLEL_API_KEY: string;
  CEREBRAS_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Ensure required environment variables are present
    if (!env.PARALLEL_API_KEY || !env.CEREBRAS_API_KEY) {
      return new Response("Missing required API keys", { status: 500 });
    }

    const url = new URL(request.url);

    // Serve the HTML page
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Handle research requests
    if (request.method === "POST" && url.pathname === "/api/research") {
      try {
        const { query, systemPrompt } = await request.json<any>();

        if (!query) {
          return new Response("Query is required", { status: 400 });
        }

        // Initialize Parallel client
        const parallel = new Parallel({
          apiKey: env.PARALLEL_API_KEY,
        });

        // Initialize Cerebras provider
        const cerebras = createCerebras({
          apiKey: env.CEREBRAS_API_KEY,
        });

        // Define the search tool
        const searchTool = tool({
          description: `# Web Search Tool - Simplified

**Purpose:** Perform web searches and return LLM-friendly results.

**Usage:**
- objective: Natural-language description of your research goal (max 200 characters)
  - Specify what you want to learn or find
  - Include any source preferences or freshness requirements
  - Focus on the end goal, not implementation details

**Examples:**
- "Find the latest developments in AI safety research from 2024"
- "Get current stock price and recent news for Tesla"
- "Compare features of top 3 project management tools"

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
          execute: async ({ objective }) => {
            const searchResult = await parallel.beta.search({
              objective,
              processor: "base",
              max_results: 5,
              max_chars_per_result: 800, // Keep low to save tokens
            });

            return searchResult;
          },
        });

        // Stream the research process
        const result = streamText({
          model: cerebras("gpt-oss-120b"),
          system:
            systemPrompt ||
            `Use the search tool to access web information. Scale the number of calls based on complexity - single call for simple questions, multiple calls for complex research.

**Key Parameters:**
- objective: Describe what you're trying to accomplish. This helps the search engine understand intent and provide relevant results.

**Query Tips:**
- Keep queries concise (1-6 words)
- Start broad, then narrow down
- Never repeat similar queries - make each unique
- If initial results insufficient, reformulate with different angles

**Usage Pattern:**
- Simple queries: One call usually sufficient
- Complex research: Multiple unique queries to gather comprehensive information`,
          prompt: query,
          tools: {
            search: searchTool,
          },
          stopWhen: stepCountIs(10),
          maxOutputTokens: 16000,
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
