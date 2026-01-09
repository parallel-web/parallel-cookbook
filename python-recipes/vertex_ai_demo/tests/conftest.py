"""Pytest configuration and fixtures for vertex-parallel tests."""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_credentials():
    """Mock Google Cloud credentials."""
    mock_creds = MagicMock()
    mock_creds.token = "mock-access-token"
    mock_creds.refresh = MagicMock()
    return mock_creds


@pytest.fixture
def mock_auth(mock_credentials):
    """Mock Google auth default."""
    with patch("google.auth.default") as mock:
        mock.return_value = (mock_credentials, "mock-project")
        yield mock


@pytest.fixture
def sample_api_response() -> dict[str, Any]:
    """Sample Vertex AI API response with grounding metadata."""
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": "According to recent reports, the CEO of Example Corp is John Smith. The company was founded in 2010 and specializes in AI technology."
                        }
                    ],
                    "role": "model",
                },
                "finishReason": "STOP",
                "groundingMetadata": {
                    "webSearchQueries": [
                        "Example Corp CEO",
                        "Example Corp company information",
                    ],
                    "groundingChunks": [
                        {
                            "web": {
                                "uri": "https://example.com/about",
                                "title": "About Example Corp",
                            }
                        },
                        {
                            "web": {
                                "uri": "https://news.example.com/example-corp-profile",
                                "title": "Example Corp Company Profile",
                            }
                        },
                    ],
                    "groundingSupports": [
                        {
                            "segment": {
                                "startIndex": 0,
                                "endIndex": 50,
                            },
                            "groundingChunkIndices": [0, 1],
                            "confidenceScores": [0.9, 0.85],
                        }
                    ],
                },
            }
        ],
        "usageMetadata": {
            "promptTokenCount": 50,
            "candidatesTokenCount": 100,
            "totalTokenCount": 150,
        },
    }


@pytest.fixture
def env_vars():
    """Set up environment variables for testing."""
    original_env = os.environ.copy()
    os.environ["GOOGLE_CLOUD_PROJECT"] = "test-project"
    os.environ["PARALLEL_API_KEY"] = "test-api-key"
    os.environ["GOOGLE_CLOUD_LOCATION"] = "us-central1"
    yield
    os.environ.clear()
    os.environ.update(original_env)
