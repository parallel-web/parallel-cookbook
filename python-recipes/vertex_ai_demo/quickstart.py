#!/usr/bin/env python3
"""
Quickstart: Vertex AI + Parallel Web Search Grounding

This minimal example shows how to get started in ~10 lines of code.

Prerequisites:
    1. pip install vertex-parallel-grounding
    2. export GOOGLE_CLOUD_PROJECT="your-project-id"
       (or set in .env file)
    3. export PARALLEL_API_KEY="your-api-key"
       (or set in .env file)
    4. gcloud auth application-default login
"""

from dotenv import load_dotenv

load_dotenv()

from vertex_parallel import GroundedGeminiClient

# Initialize client (uses environment variables by default)
client = GroundedGeminiClient()

# Ask a question that benefits from real-time web data
response = client.generate("Who won the most recent Super Bowl?")

# Print the answer and sources
print(f"Answer: {response.text}\n")
print(f"Sources ({len(response.sources)}):")
for source in response.sources[:3]:
    print(f"  - {source.title}: {source.uri}")
