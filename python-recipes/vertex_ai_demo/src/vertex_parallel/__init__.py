"""
Vertex AI + Parallel Web Search Grounding Integration.

This module provides utilities for using Parallel web search as a grounding
source for Gemini models on Vertex AI.

Example usage:
    from vertex_parallel import GroundedGeminiClient

    client = GroundedGeminiClient(
        project_id="your-project",
        location="us-central1",
        parallel_api_key="your-parallel-key"
    )

    response = client.generate(
        prompt="What are the latest developments in AI?",
        model_id="gemini-2.0-flash"
    )
    print(response.text)
    print(response.sources)
"""

from vertex_parallel.client import (
    GroundedGeminiClient,
    GroundingConfig,
    GroundedResponse,
)

__all__ = [
    "GroundedGeminiClient",
    "GroundingConfig",
    "GroundedResponse",
]

__version__ = "0.1.0"
