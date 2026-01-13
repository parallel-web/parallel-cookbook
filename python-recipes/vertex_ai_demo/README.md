# Vertex AI Gemini with Parallel Web Search Grounding

This integration demonstrates how to use [Parallel's Web Search API](https://parallel.ai) as a grounding source for Gemini models on Google Cloud Vertex AI. Grounding with Parallel enables Gemini to access real-time web information to provide accurate, up-to-date responses.

## Overview

Grounding with Parallel on Vertex AI connects Gemini models to Parallel's LLM-optimized web search index. This ensures responses are:

- **Current**: Access to live information from billions of web pages
- **Accurate**: Responses grounded in verifiable sources
- **Cited**: Sources are returned with each response for verification

### Use Cases

- **Information Enrichment**: Complete or enrich entity data with current web information
- **Multi-hop Agents**: Deep web searches for complex questions
- **Research Assistants**: Employee-facing tools for reports using latest web data
- **Consumer Applications**: Retail and travel apps with informed purchase decisions
- **Automated Agents**: News analysis, KYC checks, and other automated tasks
- **Vertical Agents**: Sales, coding, and finance agents with current context

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Application                          │
│  client.generate("What is the latest news about AI?")       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Vertex AI Gemini API                        │
│  - Receives prompt with Parallel grounding config           │
│  - Model determines search queries needed                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Parallel Web Search API                      │
│  - Executes semantic web searches                           │
│  - Returns LLM-optimized content and citations              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Grounded Response                           │
│  - Generated text with real-time information                │
│  - Source citations for verification                        │
│  - Search queries executed                                  │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **Google Cloud Project** with billing enabled
2. **Vertex AI API** enabled in your project
3. **Parallel API Key** from [parallel.ai/products/search](https://parallel.ai/products/search)
4. **Python 3.10+** and **uv** package manager
5. **Google Cloud authentication** configured

## Quick Start

### 1. Clone and Setup

```bash
cd vertex_ai_demo

# Install dependencies using uv
uv sync

# Or install with pip
pip install -e .
```

### 2. Configure Authentication

```bash
# Authenticate with Google Cloud
gcloud auth application-default login

# Set your project
export GOOGLE_CLOUD_PROJECT="your-gcp-project-id"

# Set your Parallel API key
export PARALLEL_API_KEY="your-parallel-api-key"
```

### 3. Validate Setup

```bash
# Check that everything is configured correctly
python demo.py --check
```

### 4. Try the Quickstart

The fastest way to get started is with our minimal example:

```bash
python quickstart.py
```

Or in Python:

```python
from vertex_parallel import GroundedGeminiClient

client = GroundedGeminiClient()
response = client.generate("Who won the most recent Super Bowl?")
print(response.text)
```

### 5. Run the Full Demo

```bash
# Run with sample questions (shows grounded vs ungrounded comparison)
python demo.py

# Run more sample questions
python demo.py --num 5

# Interactive mode - ask your own questions
python demo.py --interactive

# Use a different model
python demo.py --model gemini-2.5-flash

# Show full responses (not truncated)
python demo.py --full
```

The demo compares responses **with** and **without** Parallel grounding for questions about recent events, showing how grounding provides access to real-time web information.

### 6. Interactive Tutorial

For a step-by-step learning experience, open the Jupyter notebook:

```bash
# Install notebook dependencies
pip install -e ".[notebook]"
# Or with uv
uv sync --extra notebook

# Launch the tutorial
jupyter notebook tutorial.ipynb
```

## Usage

### Basic Usage

```python
from vertex_parallel import GroundedGeminiClient

# Initialize the client
client = GroundedGeminiClient(
    project_id="your-project-id",
    parallel_api_key="your-parallel-api-key",
)

# Generate a grounded response
response = client.generate(
    prompt="Who won the most recent FIFA World Cup?",
    model_id="gemini-2.0-flash",
)

print(response.text)
print(f"Sources: {[s.uri for s in response.sources]}")
```

### With Custom Configuration

```python
from vertex_parallel import GroundedGeminiClient, GroundingConfig

# Configure grounding options
config = GroundingConfig(
    api_key="your-parallel-api-key",
    max_results=5,                    # Max search results (1-20)
    include_domains=["www.example.com"],  # Only these domains
    exclude_domains=[],         # Exclude these domains
)

client = GroundedGeminiClient(
    project_id="your-project-id",
    grounding_config=config,
)

response = client.generate(
    prompt="What is the latest news about AI regulation?",
    temperature=0.2,
    system_instruction="Provide a concise summary with key dates.",
)
```

### Validate Setup

Before running your code, you can validate that all credentials are configured correctly:

```python
from vertex_parallel import validate_setup

status = validate_setup()
print(status)

if not status.is_valid:
    # status shows exactly what's missing and how to fix it
    exit(1)
```

### Convenience Function

```python
from vertex_parallel import generate_grounded_response

# One-off grounded request
response = generate_grounded_response(
    prompt="What are the latest breakthroughs in quantum computing?",
    project_id="your-project",
    parallel_api_key="your-key",
)
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project ID | Yes |
| `PARALLEL_API_KEY` | Parallel API key | Yes |
| `GOOGLE_CLOUD_LOCATION` | GCP region (default: us-central1) | No |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON | No |

### GroundingConfig Options

| Parameter | Description | Default | Range |
|-----------|-------------|---------|-------|
| `api_key` | Parallel API key | Required | - |
| `max_results` | Max search results | 10 | 1-20 |
| `max_chars_per_result` | Max chars per result excerpt | 30,000 | 1,000-100,000 |
| `max_chars_total` | Max total chars from all excerpts | 100,000 | 1,000-1,000,000 |
| `include_domains` | Only search these domains | None | Up to 10 |
| `exclude_domains` | Exclude these domains | None | Up to 10 |

### Supported Models

See the [official documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-parallel) for the latest list.

**Gemini 3 (Preview)**
- `gemini-3.0-flash`
- `gemini-3.0-pro`
- `gemini-3.0-pro-image`

**Gemini 2.5**
- `gemini-2.5-pro`
- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`

**Gemini 2.0**
- `gemini-2.0-flash`

The default model is `gemini-2.5-flash`.

## API Response

The `GroundedResponse` object contains:

```python
@dataclass
class GroundedResponse:
    text: str                           # Generated response text
    sources: list[GroundingSource]      # List of source URLs and titles
    web_search_queries: list[str]       # Queries executed by the model
    raw_response: dict                  # Full API response for debugging
    grounding_supports: list[dict]      # Detailed grounding information
```

## Project Structure

```
vertex_ai_demo/
├── src/vertex_parallel/     # Source code
│   ├── __init__.py         # Package exports
│   └── client.py           # Main client implementation
├── tests/                   # Test suite
│   ├── conftest.py         # Test fixtures
│   └── test_client.py      # Unit tests
├── quickstart.py           # Minimal example (~15 lines)
├── demo.py                  # Full demo script with comparisons
├── tutorial.ipynb          # Interactive Jupyter tutorial
├── pyproject.toml          # Project configuration
├── README.md               # This file
├── .env.example            # Environment variable template
└── .gitignore              # Git ignore patterns
```

## Testing

```bash
# Run all tests
uv run pytest tests/ -v

# Run with coverage
uv run pytest tests/ --cov=src/vertex_parallel

# Run specific test
uv run pytest tests/test_client.py::TestGroundedGeminiClient -v
```

## Pricing

Using Grounding with Parallel incurs the following charges:

| Component | Description |
|-----------|-------------|
| **Gemini tokens** | Prompt, thinking, and output tokens ([Vertex AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)) |
| **Grounding** | Vertex AI grounding charges |
| **Parallel Search** | Per-query pricing ([Parallel pricing](https://parallel.ai/pricing)) |

**Note**: Input tokens provided by Parallel are not charged extra.

## Quota

The default quota is 60 prompts per minute. To increase rate limits, contact [support@parallel.ai](mailto:support@parallel.ai) and your Google account team.

## Troubleshooting

### Common Issues

1. **Authentication Error**
   ```bash
   gcloud auth application-default login
   ```

2. **API Not Enabled**
   ```bash
   gcloud services enable aiplatform.googleapis.com
   ```

3. **Invalid API Key**
   - Verify your Parallel API key at [parallel.ai](https://parallel.ai)
   - Ensure the key has web search permissions

4. **Rate Limiting**
   - Default quota is 60 requests/minute
   - Contact support for higher limits

### Logs and Debugging

```python
# Access raw API response for debugging
response = client.generate("...")
print(response.raw_response)

# Check grounding supports for citation details
print(response.grounding_supports)
```

## Related Resources

- [Vertex AI Grounding Documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/overview)
- [Grounding with Parallel on Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-parallel)
- [Parallel Web Search API](https://docs.parallel.ai)
- [Parallel Pricing](https://parallel.ai/pricing)
- [Google Gen AI SDK](https://googleapis.github.io/python-genai/)

## License

See repository root for license information.

## Terms of Service

Your use of Parallel requires Google Cloud to send certain Customer Data to Parallel for processing. Your use of the Parallel service is governed by:
- [Parallel's Terms of Use](https://parallel.ai/customer-terms)
- [Parallel's Acceptable Use Policy](https://parallel.ai/acceptable-use-policy)
