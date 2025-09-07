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

    if (url.pathname === "/agent") {
      // redirect from oss.p0web.com/agent to /agent/ to ensure api call works
      return new Response(null, {
        status: 302,
        headers: { Location: "/agent/" },
      });
    }
    // Needed to host on subpath
    const pathname = url.pathname.startsWith("/agent/")
      ? url.pathname.slice("/agent".length)
      : url.pathname;

    // Serve the HTML page
    if (request.method === "GET" && pathname === "/") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Handle research requests
    if (request.method === "POST" && pathname === "/api/research") {
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

        // Initialize Cerebras provider
        const cerebras = createCerebras({
          apiKey: env.CEREBRAS_API_KEY,
        });

        // Stream the research process
        const result = streamText({
          model: cerebras("qwen-3-235b-a22b-instruct-2507"),
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
