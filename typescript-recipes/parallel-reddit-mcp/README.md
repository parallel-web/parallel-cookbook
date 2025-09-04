# Change My Mind - Using Reddit MCP with Parallel's Task API is a Great Idea

Live: https://changemymind.p0web.com

How it was made:

- Using tool calling with the Task API (https://docs.parallel.ai/features/mcp-tool-call)
- Using this MCP with keys in the URL to not need to do the oauth flow, making it a secret (https://server.smithery.ai/@ruradium/mcp-reddit)
- Using webhook to retrieve result
- Using Cloudflare Workers with Durable Object for SQLite storage
- Using https://github.com/janwilmake/simplerauth-provider/tree/main/simplerauth-client for simple minimal X Login

For more details, see the specification
