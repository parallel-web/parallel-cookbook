"""
Client for Vertex AI Gemini with Parallel web search grounding.

This module provides a high-level client for making grounded requests to
Gemini models using Parallel's web search API for real-time information.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

import google.auth
import google.auth.transport.requests
import requests
from pydantic import BaseModel


class GroundingConfig(BaseModel):
    """Configuration for Parallel web search grounding.

    Attributes:
        api_key: Parallel API key for web search.
        max_results: Maximum number of search results (1-20, default 10).
        max_chars_per_result: Max characters per result excerpt (1000-100000, default 30000).
        max_chars_total: Max total characters from all excerpts (1000-1000000, default 100000).
        include_domains: Optional list of domains to include (max 10).
        exclude_domains: Optional list of domains to exclude (max 10).
    """

    api_key: str
    max_results: int = 10
    max_chars_per_result: int = 30000
    max_chars_total: int = 100000
    include_domains: list[str] | None = None
    exclude_domains: list[str] | None = None

    def to_grounding_spec(self) -> dict[str, Any]:
        """Convert to Vertex AI grounding specification format."""
        parallel_config: dict[str, Any] = {
            "api_key": self.api_key,
        }

        # Build customConfigs if any non-default values are set
        custom_configs: dict[str, Any] = {}

        # Source policy (include/exclude domains)
        source_policy: dict[str, Any] = {}
        if self.include_domains:
            source_policy["include_domains"] = self.include_domains
        if self.exclude_domains:
            source_policy["exclude_domains"] = self.exclude_domains
        if source_policy:
            custom_configs["source_policy"] = source_policy

        # Excerpts configuration
        excerpts: dict[str, Any] = {}
        if self.max_chars_per_result != 30000:
            excerpts["max_chars_per_result"] = self.max_chars_per_result
        if self.max_chars_total != 100000:
            excerpts["max_chars_total"] = self.max_chars_total
        if excerpts:
            custom_configs["excerpts"] = excerpts

        # Max results
        if self.max_results != 10:
            custom_configs["max_results"] = self.max_results

        if custom_configs:
            parallel_config["customConfigs"] = custom_configs

        return {"parallelAiSearch": parallel_config}


@dataclass
class GroundingSource:
    """A source used for grounding a response.

    Attributes:
        uri: The URL of the source.
        title: The title of the source page.
    """

    uri: str
    title: str | None = None


@dataclass
class GroundedResponse:
    """Response from a grounded Gemini request.

    Attributes:
        text: The generated text response.
        sources: List of sources used for grounding.
        web_search_queries: Search queries executed by the model.
        raw_response: The raw API response for debugging.
        grounding_supports: Detailed grounding support information.
    """

    text: str
    sources: list[GroundingSource] = field(default_factory=list)
    web_search_queries: list[str] = field(default_factory=list)
    raw_response: dict[str, Any] | None = None
    grounding_supports: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_api_response(cls, response: dict[str, Any]) -> "GroundedResponse":
        """Create a GroundedResponse from an API response.

        Args:
            response: The raw API response dictionary.

        Returns:
            A GroundedResponse instance.
        """
        # Extract text from candidates
        text = ""
        candidates = response.get("candidates", [])
        if candidates:
            content = candidates[0].get("content", {})
            parts = content.get("parts", [])
            if parts:
                text = parts[0].get("text", "")

        # Extract grounding metadata
        sources: list[GroundingSource] = []
        web_search_queries: list[str] = []
        grounding_supports: list[dict[str, Any]] = []

        grounding_metadata = candidates[0].get("groundingMetadata", {}) if candidates else {}

        # Extract web search queries
        web_search_queries = grounding_metadata.get("webSearchQueries", [])

        # Extract grounding chunks (sources)
        grounding_chunks = grounding_metadata.get("groundingChunks", [])
        for chunk in grounding_chunks:
            web_info = chunk.get("web", {})
            if web_info:
                sources.append(
                    GroundingSource(
                        uri=web_info.get("uri", ""),
                        title=web_info.get("title"),
                    )
                )

        # Extract grounding supports
        grounding_supports = grounding_metadata.get("groundingSupports", [])

        return cls(
            text=text,
            sources=sources,
            web_search_queries=web_search_queries,
            raw_response=response,
            grounding_supports=grounding_supports,
        )


class GroundedGeminiClient:
    """Client for making grounded requests to Gemini via Vertex AI.

    This client uses the Vertex AI REST API to make requests to Gemini models
    with Parallel web search grounding enabled.

    Example:
        client = GroundedGeminiClient(
            project_id="my-project",
            location="us-central1",
            parallel_api_key="my-parallel-key"
        )
        response = client.generate("What is the latest news about AI?")
        print(response.text)
        for source in response.sources:
            print(f"  - {source.title}: {source.uri}")
    """

    # Models that support Parallel grounding (see docs for latest list)
    # https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-parallel
    SUPPORTED_MODELS = [
        # Gemini 3 models (preview)
        "gemini-3.0-flash",
        "gemini-3.0-pro",
        "gemini-3.0-pro-image",
        # Gemini 2.5 models
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        # Gemini 2.0 models
        "gemini-2.0-flash",
    ]

    def __init__(
        self,
        project_id: str | None = None,
        location: str = "us-central1",
        parallel_api_key: str | None = None,
        grounding_config: GroundingConfig | None = None,
    ):
        """Initialize the client.

        Args:
            project_id: Google Cloud project ID. If not provided, will attempt
                to get from GOOGLE_CLOUD_PROJECT environment variable.
            location: Google Cloud region. Defaults to us-central1.
            parallel_api_key: Parallel API key. If not provided, will attempt
                to get from PARALLEL_API_KEY environment variable.
            grounding_config: Optional GroundingConfig for advanced settings.
        """
        self.project_id = project_id or os.environ.get("GOOGLE_CLOUD_PROJECT")
        if not self.project_id:
            raise ValueError(
                "project_id must be provided or GOOGLE_CLOUD_PROJECT must be set"
            )

        self.location = location or os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")

        # Get Parallel API key
        api_key = parallel_api_key or os.environ.get("PARALLEL_API_KEY")
        if not api_key:
            raise ValueError(
                "parallel_api_key must be provided or PARALLEL_API_KEY must be set"
            )

        # Set up grounding config
        if grounding_config:
            self.grounding_config = grounding_config
        else:
            self.grounding_config = GroundingConfig(api_key=api_key)

        # Initialize credentials
        self._credentials, _ = google.auth.default()
        self._auth_req = google.auth.transport.requests.Request()

    def _get_access_token(self) -> str:
        """Get a fresh access token for API requests."""
        self._credentials.refresh(self._auth_req)
        return self._credentials.token

    def _get_endpoint_url(self, model_id: str) -> str:
        """Get the Vertex AI endpoint URL for the given model.

        Args:
            model_id: The model ID (e.g., "gemini-2.0-flash").

        Returns:
            The full endpoint URL.
        """
        base_url = f"https://{self.location}-aiplatform.googleapis.com/v1"
        return f"{base_url}/projects/{self.project_id}/locations/{self.location}/publishers/google/models/{model_id}:generateContent"

    def generate(
        self,
        prompt: str,
        model_id: str = "gemini-2.0-flash",
        system_instruction: str | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
        grounding_config: GroundingConfig | None = None,
    ) -> GroundedResponse:
        """Generate a grounded response using Gemini with Parallel web search.

        Args:
            prompt: The user prompt/question.
            model_id: The Gemini model to use. Defaults to gemini-2.0-flash.
            system_instruction: Optional system instruction.
            temperature: Optional temperature setting (0.0-2.0).
            max_output_tokens: Optional max output tokens.
            grounding_config: Optional override for grounding configuration.

        Returns:
            A GroundedResponse containing the text and sources.

        Raises:
            requests.HTTPError: If the API request fails.
            ValueError: If the response cannot be parsed.
        """
        config = grounding_config or self.grounding_config

        # Build request body
        request_body: dict[str, Any] = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ],
            "tools": [config.to_grounding_spec()],
        }

        # Add optional parameters
        generation_config: dict[str, Any] = {}
        if temperature is not None:
            generation_config["temperature"] = temperature
        if max_output_tokens is not None:
            generation_config["maxOutputTokens"] = max_output_tokens
        if generation_config:
            request_body["generationConfig"] = generation_config

        if system_instruction:
            request_body["systemInstruction"] = {
                "parts": [{"text": system_instruction}]
            }

        # Make request
        url = self._get_endpoint_url(model_id)
        headers = {
            "Authorization": f"Bearer {self._get_access_token()}",
            "Content-Type": "application/json",
        }

        response = requests.post(url, headers=headers, json=request_body, timeout=120)
        response.raise_for_status()

        return GroundedResponse.from_api_response(response.json())

    def generate_with_context(
        self,
        prompt: str,
        context: dict[str, Any],
        model_id: str = "gemini-2.0-flash",
        **kwargs: Any,
    ) -> GroundedResponse:
        """Generate a grounded response with additional context.

        This is useful for enrichment scenarios where you have entity data
        and want to ask questions grounded in web search.

        Args:
            prompt: The question template. Can include {key} placeholders
                that will be filled from context.
            context: Dictionary of context values to include.
            model_id: The Gemini model to use.
            **kwargs: Additional arguments passed to generate().

        Returns:
            A GroundedResponse containing the text and sources.

        Example:
            response = client.generate_with_context(
                prompt="What is the current stock price and recent news for {company}?",
                context={"company": "Apple Inc.", "ticker": "AAPL"},
            )
        """
        # Format prompt with context
        formatted_prompt = prompt.format(**context)

        # Add context to system instruction if not already provided
        if "system_instruction" not in kwargs:
            context_str = "\n".join(f"- {k}: {v}" for k, v in context.items())
            kwargs["system_instruction"] = f"""You are a helpful assistant with access to current web information.
Use the provided context and web search results to answer questions accurately.

Context:
{context_str}
"""

        return self.generate(formatted_prompt, model_id=model_id, **kwargs)


def generate_grounded_response(
    prompt: str,
    project_id: str | None = None,
    location: str = "us-central1",
    parallel_api_key: str | None = None,
    model_id: str = "gemini-2.0-flash",
    **kwargs: Any,
) -> GroundedResponse:
    """Convenience function for one-off grounded requests.

    Args:
        prompt: The user prompt/question.
        project_id: Google Cloud project ID.
        location: Google Cloud region.
        parallel_api_key: Parallel API key.
        model_id: The Gemini model to use.
        **kwargs: Additional arguments passed to generate().

    Returns:
        A GroundedResponse containing the text and sources.

    Example:
        response = generate_grounded_response(
            "What are the latest breakthroughs in quantum computing?",
            project_id="my-project",
            parallel_api_key="my-key",
        )
        print(response.text)
    """
    client = GroundedGeminiClient(
        project_id=project_id,
        location=location,
        parallel_api_key=parallel_api_key,
    )
    return client.generate(prompt, model_id=model_id, **kwargs)
