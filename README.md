<div align="center">

# Parallel Cookbook

**Full-stack recipes, examples, and templates for building with the [Parallel Web APIs](https://docs.parallel.ai).**

[Docs](https://docs.parallel.ai) · [API Reference](https://docs.parallel.ai/api-reference) · [Platform](https://platform.parallel.ai) · [@p0](https://x.com/p0)

</div>

---

The Parallel Cookbook is a curated set of recipes that show how to build real applications on Parallel's web research stack — **Search**, **Extract**, **Task**, **Ingest**, and **MCP**. Each recipe is a working app with a live demo, a deploy button, and prose that explains the design decisions.

> **New here?** Start with the [Vercel Template](typescript-recipes/parallel-vercel-template) (TypeScript) or the [Deep Research notebook](python-recipes/Deep_Research_Recipe.ipynb) (Python) for an end-to-end tour of the platform.

## Contents

- [Quick Start](#quick-start)
- [Recipes by Category](#recipes-by-category)
  - [Templates & Starters](#templates--starters)
  - [Agents & Search](#agents--search)
  - [Data Enrichment](#data-enrichment)
  - [Realtime Streaming (SSE)](#realtime-streaming-sse)
  - [Scheduled Research & Webhooks](#scheduled-research--webhooks)
  - [Deep Research & Notebooks](#deep-research--notebooks)
  - [Identity & Entity Resolution](#identity--entity-resolution)
  - [Fact Checking](#fact-checking)
  - [Cloud Provider Integrations](#cloud-provider-integrations)
- [Community Examples](#community-examples)
- [Resources & Utilities](#resources--utilities)
- [Machine Quickstart (MCP)](#machine-quickstart-mcp)
- [Contributing](#contributing)

## Quick Start

Get an API key at [platform.parallel.ai](https://platform.parallel.ai), then pick your stack.

**TypeScript / Node**

```bash
npm install parallel-web
```

```ts
import Parallel from "parallel-web";
const client = new Parallel({ apiKey: process.env.PARALLEL_API_KEY });

const result = await client.beta.search({
  objective: "Find the latest funding round announcements for AI startups in 2026",
});
console.log(result.results);
```

**Python**

```bash
pip install parallel-web
```

```python
from parallel import Parallel
client = Parallel()  # reads PARALLEL_API_KEY from env

run = client.task_run.create(
    input="What is the latest revenue figure for Anthropic?",
    processor="core",
)
print(run.output)
```

## Recipes by Category

Every recipe in this repo is listed below, grouped by what you're trying to build. Looking for a specific API surface? Search for the badge — `Search`, `Extract`, `Task`, `SSE`, `Webhooks`, `MCP`, `OAuth`, `Ingest`.

### Templates & Starters

Multi-API starter projects — fork these first.

| Recipe | Description | APIs | Stack | Demo |
| --- | --- | --- | --- | --- |
| [**Vercel Template**](typescript-recipes/parallel-vercel-template) | Next.js demo of Search + Extract + Tasks with SSE in a single app. Includes Vercel marketplace integration for one-click API key. | `Search` `Extract` `Task` `SSE` | Next.js · Vercel | [Live](https://parallel-vercel-template-cookbook.vercel.app/) · [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fparallel-web%2Fparallel-cookbook%2Ftree%2Fmain%2Ftypescript-recipes%2Fparallel-vercel-template&project-name=parallel-vercel-template&repository-name=parallel-vercel-template&integration-ids=oac_qjiYAM8BTtX0UDS6HEPY97nU) |

### Agents & Search

LLM agents that use Parallel's Search API as a tool with the Vercel AI SDK.

| Recipe | Description | APIs | Stack | Demo |
| --- | --- | --- | --- | --- |
| [**Search Agent (Cerebras)**](typescript-recipes/parallel-search-agent-cerebras) | Multi-turn web research agent backed by Cerebras (GPT-OSS / Qwen). Iterative multi-angle searches, full-stack with vanilla JS frontend. | `Search` | Cloudflare Workers · Cerebras · AI SDK | [Live](https://oss.parallel.ai/agent/) |
| [**Search Agent (Groq)**](typescript-recipes/parallel-search-agent-groq) | Same agent shape, Llama 4 Maverick on Groq with 128k context for long sessions. | `Search` | Cloudflare Workers · Groq · AI SDK | [Live](https://oss.parallel.ai/agent/) |

### Data Enrichment

Take a thin input (a name, a domain) and return structured, cited fields.

| Recipe | Description | APIs | Stack | Demo |
| --- | --- | --- | --- | --- |
| [**Supabase Enrichment**](typescript-recipes/parallel-supabase-enrichment) | Real-time enrichment pipeline — INSERT a company, an Edge Function fires a Task, results stream back via Supabase Realtime. | `Task` `Webhooks` | Next.js · Supabase Edge Functions · Postgres | – |
| [**Large-Scale Tasks**](python-recipes/Large_Scale_Tasks_Recipe.py) | Production batch script for 1k+ row CSVs — three-stage enqueue → fetch → merge with retry, dry-run, and idempotent state. | `Task Group` | Python | – |
| [**Task Group + Temporal**](python-recipes/Task_Group_Temporal_Recipe.py) | Combine Task Groups with Temporal workflow orchestration for enterprise-grade durability. | `Task Group` | Python · Temporal | – |

### Realtime Streaming (SSE)

Stream task progress to a UI in real time.

| Recipe | Description | APIs | Stack | Demo |
| --- | --- | --- | --- | --- |
| [**Tasks Playground (SSE)**](typescript-recipes/parallel-tasks-sse) | Full-featured task manager that exercises every processor (lite → ultra8x) with live SSE events. OAuth 2.1 with PKCE & dynamic client registration. | `Task` `SSE` `OAuth` | Cloudflare Workers · Durable Objects | [Live](https://oss.parallel.ai/tasks-sse/) |

### Scheduled Research & Webhooks

Recurring research, cron jobs, and webhook delivery.

| Recipe | Description | APIs | Stack | Demo |
| --- | --- | --- | --- | --- |
| [**Daily Insights**](typescript-recipes/parallel-daily-insights) | Cron-triggered daily research feed — runs Tasks on a schedule, persists to KV, publishes a public data feed. Includes a `SPEC.md` showing the task spec used. | `Task` `Webhooks` `Cron` | Cloudflare Workers · KV | – |
| [**n8n Vendor Risk Monitoring**](typescript-recipes/parallel-n8n-procurement) | Procurement workflow that researches vendors, deploys monitors, scores risk, routes Slack alerts, and logs an audit trail. | `Task` `Monitors` `Webhooks` | n8n · TypeScript · Google Sheets · Slack | – |

### Deep Research & Notebooks

Long-running, exploratory research with structured outputs and citations.

| Recipe | Description | APIs | Stack | Demo |
| --- | --- | --- | --- | --- |
| [**Market Analysis Demo**](python-recipes/market-analysis-demo) | Flask app that turns a market-research prompt into a streamed report with email delivery. SSE progress + webhook completion. | `Task` `Deep Research` `SSE` `Webhooks` | Python · Flask · Postgres · Resend | [Live](https://market-analysis-demo.parallel.ai) |
| [**Deep Research Notebook**](python-recipes/Deep_Research_Recipe.ipynb) | Interactive Jupyter walkthrough of Deep Research — text + JSON outputs, citations, confidence scores, webhook patterns. | `Deep Research` `Webhooks` | Jupyter · Python | – |

### Identity & Entity Resolution

Matching real-world entities across sources.

| Recipe | Description | APIs | Stack | Demo |
| --- | --- | --- | --- | --- |
| [**Entity Resolution**](typescript-recipes/parallel-entity-resolution) | Find every social profile for a single person across platforms in one Task. | `Task` `OAuth` | Cloudflare Workers | [Live](https://entity-resolution-demo.parallel.ai) |

### Fact Checking

Claim extraction + verification with cited evidence.

| Recipe | Description | APIs | Stack | Demo |
| --- | --- | --- | --- | --- |
| [**Fact Checker (Cerebras)**](typescript-recipes/parallel-fact-checker-cerebras) | Extracts claims from a passage, runs Search per claim, streams verdicts in real time. | `Search` `Extract` | Cloudflare Workers · Cerebras · AI SDK | – |

### Cloud Provider Integrations

How Parallel composes with cloud AI platforms.

| Recipe | Description | APIs | Stack | Demo |
| --- | --- | --- | --- | --- |
| [**Vertex AI Grounding**](python-recipes/vertex_ai_demo) | Ground Gemini on Vertex AI with the Parallel Search API for current, cited responses. Supports both GCP Marketplace and BYOK auth. | `Search` | Python · Google Vertex AI | – |
| [**Competitive Analysis**](https://github.com/parallel-web/competitive-analysis-demo) | Web Enrichment + Reddit MCP combined to produce competitive briefs. | `Task` `MCP` | Python | [Live](https://competitive-analysis-demo.parallel.ai/) |

## Community Examples

Built something you want featured? [Open a PR](CONTRIBUTING.md).

| Project | Author | Stack |
| --- | --- | --- |
| [Parallel Spreadsheet](https://github.com/zahidkhawaja/parallel-spreadsheet) | [@chillzaza_](https://x.com/chillzaza_/status/1958005876918292941) | Next.js · TypeScript |
| [Scira (10k+ ⭐)](https://github.com/zaidmukaddam/scira) | [@zaidmukaddam](https://x.com/zaidmukaddam/status/1958583204635439264) | Next.js · Vercel |
| [Based People](https://github.com/janwilmake/basedpeople) | [@janwilmake](https://github.com/janwilmake) | Cloudflare Workers · TypeScript |
| [Tasks via MCP + OAuth](https://github.com/janwilmake/universal-mcp-oauth/tree/main/examples/parallel-tool-calling) | [@janwilmake](https://github.com/janwilmake) | Cloudflare Workers · TypeScript |

## Resources & Utilities

- **[Task Best Practices](task-best-practices.md)** — schema design, processor selection, common pitfalls, source policy.
- **[ADR](ADR.md)** — architectural decisions made while building this cookbook.
- **[task_library_trimmed.json](task_library_trimmed.json)** — curated example task specs for the MCP quickstart below.
- **[typescript-sdk-types.d.ts](typescript-sdk-types.d.ts)** — flattened TypeScript SDK types, useful for ingesting into LLM context.
- **[parallel-flatten](https://github.com/janwilmake/parallel-flatten)** — community utility for flattening Task outputs for easier rendering.

## Machine Quickstart (MCP)

The fastest way to get an LLM building with Parallel is to clone this repo and install [our MCPs](https://docs.parallel.ai/integrations/mcp/getting-started). The **llms.txt MCP** is ideal for asking questions about Parallel — it has full context. The other MCPs let you experiment with our APIs without writing code.

## Contributing

Built something with Parallel? Got an idea for a recipe? See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the submission guide. Quick recipe ideas, design suggestions, and bug reports are welcome as [issues](https://github.com/parallel-web/parallel-cookbook/issues).

---

<div align="center">

Made with [Parallel](https://parallel.ai) · [Docs](https://docs.parallel.ai) · [@p0](https://x.com/p0)

</div>
