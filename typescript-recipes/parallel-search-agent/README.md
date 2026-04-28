# Parallel Search Agent

This recipe was split into model-specific variants. Pick the one that fits your use case:

- **[parallel-search-agent-cerebras](../parallel-search-agent-cerebras/)** — Cerebras (GPT-OSS / Qwen). Fastest inference for short-to-medium agent loops.
- **[parallel-search-agent-groq](../parallel-search-agent-groq/)** — Groq (Llama 4 Maverick, 128k context). Best for long agent sessions.

Both share the same architecture (Cloudflare Worker + Vercel AI SDK + Parallel Search API as a tool) and ship to the same demo at [oss.parallel.ai/agent](https://oss.parallel.ai/agent/).
