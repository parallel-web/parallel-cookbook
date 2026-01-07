"""Tests for the GroundedGeminiClient."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from vertex_parallel import GroundedGeminiClient, GroundingConfig, GroundedResponse


class TestGroundingConfig:
    """Tests for GroundingConfig."""

    def test_default_config(self):
        """Test default configuration values."""
        config = GroundingConfig(api_key="test-key")
        assert config.api_key == "test-key"
        assert config.max_results == 10
        assert config.max_chars_per_result == 30000
        assert config.max_chars_total == 100000
        assert config.include_domains is None
        assert config.exclude_domains is None

    def test_custom_config(self):
        """Test custom configuration values."""
        config = GroundingConfig(
            api_key="test-key",
            max_results=5,
            max_chars_per_result=10000,
            max_chars_total=50000,
            include_domains=["example.com"],
            exclude_domains=["blocked.com"],
        )
        assert config.max_results == 5
        assert config.max_chars_per_result == 10000
        assert config.max_chars_total == 50000
        assert config.include_domains == ["example.com"]
        assert config.exclude_domains == ["blocked.com"]

    def test_to_grounding_spec_minimal(self):
        """Test conversion to grounding spec with minimal config."""
        config = GroundingConfig(api_key="test-key")
        spec = config.to_grounding_spec()

        assert "parallelAiSearch" in spec
        assert spec["parallelAiSearch"]["api_key"] == "test-key"
        # Default values should not be included in customConfigs
        assert "customConfigs" not in spec["parallelAiSearch"]

    def test_to_grounding_spec_full(self):
        """Test conversion to grounding spec with all options."""
        config = GroundingConfig(
            api_key="test-key",
            max_results=5,
            max_chars_per_result=10000,
            max_chars_total=50000,
            include_domains=["example.com", ".edu"],
            exclude_domains=["blocked.com"],
        )
        spec = config.to_grounding_spec()

        parallel_config = spec["parallelAiSearch"]
        assert parallel_config["api_key"] == "test-key"
        assert "customConfigs" in parallel_config
        custom = parallel_config["customConfigs"]
        assert custom["max_results"] == 5
        assert custom["excerpts"]["max_chars_per_result"] == 10000
        assert custom["excerpts"]["max_chars_total"] == 50000
        assert custom["source_policy"]["include_domains"] == ["example.com", ".edu"]
        assert custom["source_policy"]["exclude_domains"] == ["blocked.com"]


class TestGroundedResponse:
    """Tests for GroundedResponse."""

    def test_from_api_response(self, sample_api_response):
        """Test parsing an API response."""
        response = GroundedResponse.from_api_response(sample_api_response)

        assert "CEO of Example Corp" in response.text
        assert len(response.sources) == 2
        assert response.sources[0].uri == "https://example.com/about"
        assert response.sources[0].title == "About Example Corp"
        assert len(response.web_search_queries) == 2
        assert "Example Corp CEO" in response.web_search_queries
        assert len(response.grounding_supports) == 1

    def test_from_empty_response(self):
        """Test parsing an empty response."""
        response = GroundedResponse.from_api_response({"candidates": []})

        assert response.text == ""
        assert response.sources == []
        assert response.web_search_queries == []

    def test_from_response_without_grounding(self):
        """Test parsing a response without grounding metadata."""
        api_response = {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": "Some text without grounding"}],
                        "role": "model",
                    },
                }
            ]
        }
        response = GroundedResponse.from_api_response(api_response)

        assert response.text == "Some text without grounding"
        assert response.sources == []
        assert response.web_search_queries == []


class TestGroundedGeminiClient:
    """Tests for GroundedGeminiClient."""

    def test_init_with_params(self, mock_auth):
        """Test client initialization with explicit parameters."""
        client = GroundedGeminiClient(
            project_id="test-project",
            location="us-central1",
            parallel_api_key="test-key",
        )

        assert client.project_id == "test-project"
        assert client.location == "us-central1"
        assert client.grounding_config.api_key == "test-key"

    def test_init_with_env_vars(self, mock_auth, env_vars):
        """Test client initialization from environment variables."""
        client = GroundedGeminiClient()

        assert client.project_id == "test-project"
        assert client.grounding_config.api_key == "test-api-key"

    def test_init_missing_project(self, mock_auth):
        """Test that missing project ID raises error."""
        with pytest.raises(ValueError, match="project_id must be provided"):
            GroundedGeminiClient(parallel_api_key="test-key")

    def test_init_missing_api_key(self, mock_auth, monkeypatch):
        """Test that missing API key raises error."""
        # Clear the environment variable if set
        monkeypatch.delenv("PARALLEL_API_KEY", raising=False)
        with pytest.raises(ValueError, match="parallel_api_key must be provided"):
            GroundedGeminiClient(project_id="test-project")

    def test_get_endpoint_url(self, mock_auth):
        """Test endpoint URL generation."""
        client = GroundedGeminiClient(
            project_id="my-project",
            location="us-central1",
            parallel_api_key="test-key",
        )

        url = client._get_endpoint_url("gemini-2.0-flash")
        expected = "https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/gemini-2.0-flash:generateContent"
        assert url == expected

    @patch("requests.post")
    def test_generate(self, mock_post, mock_auth, sample_api_response):
        """Test the generate method."""
        mock_response = MagicMock()
        mock_response.json.return_value = sample_api_response
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        client = GroundedGeminiClient(
            project_id="test-project",
            parallel_api_key="test-key",
        )

        response = client.generate("What is the CEO of Example Corp?")

        assert "CEO of Example Corp" in response.text
        assert len(response.sources) == 2
        mock_post.assert_called_once()

        # Verify request body
        call_args = mock_post.call_args
        request_body = call_args.kwargs["json"]
        assert "contents" in request_body
        assert "tools" in request_body
        assert "parallelAiSearch" in request_body["tools"][0]

    @patch("requests.post")
    def test_generate_with_options(self, mock_post, mock_auth, sample_api_response):
        """Test the generate method with optional parameters."""
        mock_response = MagicMock()
        mock_response.json.return_value = sample_api_response
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        client = GroundedGeminiClient(
            project_id="test-project",
            parallel_api_key="test-key",
        )

        response = client.generate(
            "What is the CEO of Example Corp?",
            model_id="gemini-2.5-flash",
            system_instruction="Be concise.",
            temperature=0.5,
            max_output_tokens=500,
        )

        # Verify request body includes optional parameters
        call_args = mock_post.call_args
        request_body = call_args.kwargs["json"]
        assert "generationConfig" in request_body
        assert request_body["generationConfig"]["temperature"] == 0.5
        assert request_body["generationConfig"]["maxOutputTokens"] == 500
        assert "systemInstruction" in request_body

    @patch("requests.post")
    def test_generate_with_context(self, mock_post, mock_auth, sample_api_response):
        """Test the generate_with_context method."""
        mock_response = MagicMock()
        mock_response.json.return_value = sample_api_response
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        client = GroundedGeminiClient(
            project_id="test-project",
            parallel_api_key="test-key",
        )

        response = client.generate_with_context(
            prompt="What is the current stock price of {company}?",
            context={"company": "Apple", "ticker": "AAPL"},
        )

        # Verify prompt was formatted
        call_args = mock_post.call_args
        request_body = call_args.kwargs["json"]
        prompt_text = request_body["contents"][0]["parts"][0]["text"]
        assert "Apple" in prompt_text
        assert "AAPL" not in prompt_text  # Ticker not in prompt template

        # Verify system instruction includes context
        assert "systemInstruction" in request_body
        system_text = request_body["systemInstruction"]["parts"][0]["text"]
        assert "Apple" in system_text
        assert "AAPL" in system_text
