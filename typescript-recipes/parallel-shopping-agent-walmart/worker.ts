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
    if (request.method === "GET") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Handle shopping search requests
    if (request.method === "POST") {
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
            objective,
            search_queries: undefined,
            processor: "base",
            source_policy: {
              exclude_domains: undefined,
              include_domains: undefined,
            },
            max_results: 10,
            max_chars_per_result: 2500,
          });
          return searchResult;
        };

        // Define the shopping search tool
        const searchTool = tool({
          description: `# Shopping Search Tool

**Purpose:** Search the web for products, reviews, pricing, and shopping recommendations.

**Usage:**
- objective: Natural-language description of what product or shopping information you're looking for (max 200 characters)

**Best Practices:**
- Be specific about product features, price ranges, or requirements
- Mention if you want current pricing or availability
- Include preferences like brand, quality, or use case
- Keep objectives concise but descriptive`,
          inputSchema: z.object({
            objective: z
              .string()
              .describe(
                "Natural-language description of what product or shopping information you're looking for (max 200 characters)"
              ),
          }),
          execute,
        });

        // Initialize Cerebras provider
        const cerebras = createCerebras({
          apiKey: env.CEREBRAS_API_KEY,
        });

        // Stream the shopping search process
        const result = streamText({
          model: cerebras("qwen-3-235b-a22b-instruct-2507"),
          system:
            systemPrompt ||
            `You are Walmart's AI shopping assistant. Your mission is to help users make smarter shopping decisions by conducting thorough product research from 1 up to 3 searches from different angles. The current date is ${new Date(
              Date.now()
            )
              .toISOString()
              .slice(0, 10)}

**Your Role:**
- Help users find the best products that match their needs and budget
- Provide balanced information including prices, features, reviews, and alternatives
- Search from multiple angles: product reviews, price comparisons, alternatives, user experiences
- Present information in a clear, helpful way that empowers smart purchasing decisions

**Research Philosophy:**
- Each search should explore a different aspect: reviews, pricing, alternatives, specifications, etc.
- NEVER try to OPEN an article, the excerpts provided should be enough
- Focus on helping users understand their options and make informed choices
- Be transparent about pricing and availability

**Key Parameters:**
- objective: Describe what product or shopping information you're looking for

**Output:**
After completing your searches, provide a comprehensive shopping report that includes:
- Product recommendations with key features
- Price ranges and where to buy
- Pros and cons from real user reviews
- Alternative options to consider
- Your assessment of the best choice based on the user's needs

Even if you couldn't find complete information, always provide a final report with what you discovered. Please do NOT use markdown tables.`,
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
        console.error("Shopping search error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
