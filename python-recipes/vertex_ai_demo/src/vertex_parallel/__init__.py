"""
Vertex AI + Parallel Web Search Grounding Integration.

This module provides utilities for using Parallel web search as a grounding
source for Gemini models on Vertex AI. Two auth modes are supported:

* **Google Cloud Marketplace**: Subscribe to Parallel Web Search on GCP
  Marketplace and no API key is required in requests.
* **Bring Your Own Key (BYOK)**: Pass a Parallel API key (or set
  ``PARALLEL_API_KEY``) to authenticate requests directly.

Example (Marketplace):
    from vertex_parallel import GroundedGeminiClient

    client = GroundedGeminiClient(
        project_id="your-project",
        location="us-central1",
    )

Example (BYOK):
    from vertex_parallel import GroundedGeminiClient

    client = GroundedGeminiClient(
        project_id="your-project",
        location="us-central1",
        parallel_api_key="your-parallel-key",
    )

    response = client.generate(
        prompt="What are the latest developments in AI?",
        model_id="gemini-2.5-flash"
    )
    print(response.text)
    print(response.sources)
"""

from vertex_parallel.client import (
    GroundedGeminiClient,
    GroundedResponse,
    GroundingConfig,
    GroundingSource,
    SetupStatus,
    generate_grounded_response,
    validate_setup,
)

__all__ = [
    "GroundedGeminiClient",
    "GroundedResponse",
    "GroundingConfig",
    "GroundingSource",
    "SetupStatus",
    "generate_grounded_response",
    "validate_setup",
]

__version__ = "0.1.0"
