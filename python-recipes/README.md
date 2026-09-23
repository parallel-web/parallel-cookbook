# Python Recipes

This directory contains Python recipes demonstrating different patterns and use cases for the Parallel AI platform.

## Available Recipes

### 🔍 [Deep Research Recipe](./Deep_Research_Recipe.ipynb)

Interactive market research tool using Parallel's Deep Research API

A comprehensive Jupyter notebook that demonstrates how to build an AI-powered market research tool. Features both text and structured JSON outputs with citations, confidence scores, and reasoning. Includes interactive user input collection and shows how to implement webhooks for asynchronous processing.

**Key Features:**

- Interactive market research report generation
- Both text and JSON output formats
- Citation tracking and reasoning
- Webhook integration for scalable processing
- Industry-agnostic flexible research capabilities

### ⚡ [Task Group Temporal Recipe](./Task_Group_Temporal_Recipe.py)

Parallel Task Groups integrated with Temporal workflows

Shows how to combine Parallel's Task Group API with Temporal's workflow orchestration platform. Demonstrates parallel processing of multiple companies to check if they use Looker BI tool, with proper error handling and result aggregation.

**Key Features:**

- Temporal workflow integration
- Parallel task execution using Task Groups
- Structured data processing with confidence scoring
- Asynchronous activity patterns
- Enterprise workflow orchestration

### 📊 [Large Scale Tasks Recipe](./Large_Scale_Tasks_Recipe.py)

Resumable batch processing for large CSVs with Task Groups

One file, four commands: `plan` sizes the job with no API calls, `submit` adds runs 1,000 per request at a steady rate under your quota and checkpoints every run id before the next request, `status` polls group summaries, and `export` streams results to JSONL and checks that every input row came back exactly once. Re-running any command is safe.

**Key Features:**

- Paced submission against your Tasks rate limit (runs per minute)
- Crash-safe resume from an append-only run log
- Task Group sharding with `refresh_status=False`
- JSONL export with per-field basis and a validation report
- Notes on what the API will not do (no cancel, rate limit is intake not throughput)

## Getting Started

Each recipe includes detailed setup instructions and dependencies. Install the Parallel Python SDK to get started:

```bash
pip install parallel-web
```

Set your API key as an environment variable:

```bash
export PARALLEL_API_KEY="your_api_key_here"
```
