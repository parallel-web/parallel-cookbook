# Parallel + Vercel Template

A Next.js template demonstrating how to integrate Parallel's web research APIs with Vercel. This template provides a complete demo application showcasing the Search, Extract, and Tasks APIs with real-time SSE streaming.

View the demo at:
[https://parallel-vercel-template-cookbook.vercel.app/](https://parallel-vercel-template-cookbook.vercel.app/)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fparallel-web%2Fparallel-cookbook%2Ftree%2Fmain%2Ftypescript-recipes%2Fparallel-vercel-template&project-name=parallel-vercel-template&repository-name=parallel-vercel-template&demo-title=Parallel%20Vercel%20Demo&demo-description=Explore%20Parallel's%20Search%2C%20Extract%2C%20and%20Tasks%20APIs%20with%20this%20interactive%20demo.&demo-url=https%3A%2F%2Fparallel-cookbook-parallel-ai.vercel.app&demo-image=https%3A%2F%2Fassets.parallel.ai%2Fcookbook%2Fvercel_cookbook_picture.png&integration-ids=oac_qjiYAM8BTtX0UDS6HEPY97nU)

## Features

| Feature                 | Description                                                                     |
| ----------------------- | ------------------------------------------------------------------------------- |
| **Search API**          | Natural language web search with mode selection (one-shot vs agentic)           |
| **Extract API**         | Content extraction from URLs with objective-focused filtering                   |
| **Tasks API**           | Deep research tasks with real-time SSE event streaming                          |
| **Session Persistence** | Search/Extract results persist in sessionStorage, Tasks persist in localStorage |
| **Status Recovery**     | Automatically checks and updates pending task statuses on page reload           |

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React UI      │────▶│  Next.js API    │────▶│  Parallel API   │
│   Components    │     │  Routes         │     │  (parallel-web) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        │ sessionStorage        │ SDK calls
        │ localStorage          │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  SearchDemo     │     │  /api/search    │  → client.beta.search()
│  ExtractDemo    │     │  /api/extract   │  → client.beta.extract()
│  TasksDemo      │     │  /api/tasks     │  → client.taskRun.create()
└─────────────────┘     │  /api/tasks/[id]/status  │  → client.taskRun.retrieve()
                        │  /api/tasks/[id]/events  │  → client.beta.taskRun.events()
                        └─────────────────┘
```

### How It Works

1. **Search**: User enters a search objective and optional queries → API calls `client.beta.search()` → Returns ranked results with excerpts
2. **Extract**: User enters URLs and optional objective → API calls `client.beta.extract()` → Returns extracted content
3. **Tasks**: User enters a research task → API calls `client.taskRun.create()` → SSE stream delivers real-time progress → Final output displayed on completion

## Quick Start

### Prerequisites

- Node.js 18+
- A [Parallel API key](https://vercel.com/marketplace/parallel) (via Vercel Integration)

### 1. Clone and Install

```bash
cd typescript-recipes/parallel-vercel-template
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Parallel API key:

```
PARALLEL_API_KEY=your-api-key-here
```

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the demo.

## Project Structure

```
parallel-vercel-template/
├── app/
│   ├── api/
│   │   ├── search/route.ts        # Search API endpoint
│   │   ├── extract/route.ts       # Extract API endpoint
│   │   └── tasks/
│   │       ├── route.ts           # Create task endpoint
│   │       └── [runId]/
│   │           ├── status/route.ts  # Task status polling
│   │           └── events/route.ts  # SSE event streaming
│   ├── components/
│   │   ├── SearchDemo.tsx         # Search UI with mode toggle
│   │   ├── ExtractDemo.tsx        # Extract UI
│   │   └── TasksDemo.tsx          # Tasks UI with SSE streaming
│   ├── page.tsx                   # Main page with tabs
│   ├── layout.tsx                 # App layout
│   └── globals.css                # Tailwind styles
├── .env.example                   # Environment template
├── package.json
└── README.md
```

## Deploying to Vercel

1. Push to your GitHub repository
2. Import the project in [Vercel](https://vercel.com/new)
3. Add `PARALLEL_API_KEY` to Environment Variables
4. Deploy

### Using Vercel Integration

The easiest way to get an API key is through the [Parallel Vercel Integration](https://vercel.com/marketplace/parallel):

1. Install the integration on your Vercel project
2. The `PARALLEL_API_KEY` environment variable is automatically added
3. Access the Parallel playground by clicking "Open in Parallel Web Systems"

## Exploring More APIs

Want to try the **Monitor** or **FindAll** APIs?

Go to your [Vercel Integration page](https://vercel.com/marketplace/parallel), select a project, and click **"Open in Parallel Web Systems"** to access the full playground.

## Resources

- [Parallel Documentation](https://docs.parallel.ai)
- [Search API Reference](https://docs.parallel.ai/api-reference/search-beta/search)
- [Extract API Reference](https://docs.parallel.ai/api-reference/extract-beta/extract)
- [Tasks API Reference](https://docs.parallel.ai/api-reference/tasks-v1/create-task-run)
- [SSE Streaming Guide](https://docs.parallel.ai/task-api/task-sse)
- [Pricing](https://docs.parallel.ai/resources/pricing)
- [parallel-web npm package](https://www.npmjs.com/package/parallel-web)
- [Vercel Integration](https://vercel.com/marketplace/parallel)

## License

MIT
