# Change My Mind - Using Reddit MCP with Parallel's Task API is a Great Idea

Live Demo: https://changemymind.p0web.com

How it was made:

- Using tool calling with the Task API (https://docs.parallel.ai/features/mcp-tool-call)
- Using this MCP with keys in the URL to not need to do the oauth flow, making it a secret (https://server.smithery.ai/@ruradium/mcp-reddit)
- Using webhook to retrieve result
- Using Cloudflare Workers with Durable Object for SQLite storage
- Using https://github.com/janwilmake/simplerauth-provider/tree/main/simplerauth-client for simple minimal X Login

The relevant code that runs the task with MCP tool calling:

```ts
const taskRun = await parallel.taskRun.create(
  {
    input: `Statement to counter-argue: "${statement}"`,
    processor: "base",
    task_spec: {
      output_schema: {
        json_schema: {
          type: "object",
          properties: {
            counterpoints: {
              type: "array",
              items: { type: "string" },
              description:
                "3-5 compelling counter-arguments from Reddit discussions, each 2-3 sentences long",
            },
            roast: {
              type: "string",
              description:
                "A witty, humorous roast of the original statement (1-2 sentences, keep it playful)",
            },
          },
          required: ["counterpoints", "roast"],
          additionalProperties: false,
        },
        type: "json",
      },
    },
    metadata: { slug },
    mcp_servers: [
      {
        name: "Reddit",
        url: env.MCP_URL,
        type: "url",
      },
    ],
    webhook: {
      url: `${url.protocol}//${url.host}/webhook`,
      event_types: ["task_run.status"],
    },
  },
  {
    headers: {
      "parallel-beta": "mcp-server-2025-07-17,webhook-2025-08-12",
    },
  }
);
```

For more details, see the specification
