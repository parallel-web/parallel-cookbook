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

Production-ready batch processing for large datasets

A robust script for processing large batches of CSV files using Parallel's Task Group API. Handles product matching across multiple e-commerce domains with comprehensive error handling, validation, and resumable operations.

**Key Features:**

- Batch processing of 1000+ row CSV files
- Three-stage pipeline: enqueue → fetch → merge
- Comprehensive error handling and retry logic
- Dry-run mode for validation
- Idempotent operations for production reliability
- File validation and state management

## Getting Started

Each recipe includes detailed setup instructions and dependencies. Install the Parallel Python SDK to get started:

```bash
pip install parallel-web
```

Set your API key as an environment variable:

```bash
export PARALLEL_API_KEY="your_api_key_here"
```
