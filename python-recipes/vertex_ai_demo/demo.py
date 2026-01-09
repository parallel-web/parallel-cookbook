#!/usr/bin/env python3
"""
Demo script for Vertex AI Gemini with Parallel web search grounding.

This script demonstrates the value of grounding Gemini responses with Parallel's
web search API for real-time information. It shows side-by-side comparisons of
responses with and without grounding for questions about recent events.

Prerequisites:
    1. Google Cloud project with Vertex AI API enabled
    2. Parallel API key from https://parallel.ai/products/search
    3. Google Cloud authentication (gcloud auth application-default login)

Usage:
    # Set required environment variables
    export GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
    export PARALLEL_API_KEY="your-parallel-api-key"

    # Run the demo with sample questions
    python demo.py

    # Run in interactive mode to ask your own questions
    python demo.py --interactive

    # Run with a specific model
    python demo.py --model gemini-2.5-flash
"""

from __future__ import annotations

import argparse
import os
import sys
import textwrap

from dotenv import load_dotenv

# Load environment variables from .env file
# This must happen before importing modules that read env vars at import time
load_dotenv()

import google.auth  # noqa: E402
import google.auth.transport.requests
import requests

from vertex_parallel import GroundedGeminiClient, GroundedResponse, validate_setup

# Sample questions organized by domain to show diverse use cases
# Each tuple contains (question, category) for better organization
SAMPLE_QUESTIONS_BY_CATEGORY = {
    "Sports": [
        "Who won the most recent Formula 1 World Championship?",
        "Who won the most recent Super Bowl?",
        "What were the results of the latest NBA Finals?",
    ],
    "Finance": [
        "What was the stock price of NVIDIA at close yesterday?",
        "What is the current price of Bitcoin?",
        "What were the key points from the latest Federal Reserve meeting?",
    ],
    "Technology": [
        "What is the latest AI model from Google?",
        "What new features were announced in the latest iPhone?",
        "What are the recent developments in quantum computing?",
    ],
    "Business": [
        "When did Parallel Web Systems announce their Series A?",
        "What was discussed in the latest Tesla earnings call?",
        "What are the recent major tech company layoffs?",
    ],
    "Science & Health": [
        "What are the latest findings from the James Webb Space Telescope?",
        "What new treatments for cancer were recently approved by the FDA?",
        "What are the current global climate change statistics?",
    ],
    "Current Events": [
        "What are today's top news headlines?",
        "What major world events happened this week?",
        "What are the current weather conditions in New York City?",
    ],
}

# Flattened list for backwards compatibility
SAMPLE_QUESTIONS = [
    "Who won the most recent Formula 1 World Championship?",
    "What was the stock price of NVIDIA at close yesterday?",
    "Who won the most recent Super Bowl?",
    "When did Parallel Web Systems announce their Series A?",
    "What is the latest AI model from Google?",
    "What are the latest findings from the James Webb Space Telescope?",
    "What are today's top news headlines?",
]


def generate_without_grounding(
    prompt: str,
    project_id: str,
    location: str,
    model_id: str,
    temperature: float = 0.2,
) -> str:
    """Generate a response from Gemini WITHOUT grounding.

    This calls the Vertex AI API directly without the Parallel grounding tool,
    so the model relies only on its training data.

    Args:
        prompt: The question to ask.
        project_id: Google Cloud project ID.
        location: Google Cloud region.
        model_id: The Gemini model to use.
        temperature: Temperature for generation.

    Returns:
        The generated text response.
    """
    # Get credentials
    credentials, _ = google.auth.default()
    auth_req = google.auth.transport.requests.Request()
    credentials.refresh(auth_req)

    # Build request without grounding
    url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/publishers/google/models/{model_id}:generateContent"

    request_body = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": temperature,
        },
    }

    headers = {
        "Authorization": f"Bearer {credentials.token}",
        "Content-Type": "application/json",
    }

    response = requests.post(url, headers=headers, json=request_body, timeout=120)
    response.raise_for_status()

    # Parse response
    data = response.json()
    candidates = data.get("candidates", [])
    if candidates:
        content = candidates[0].get("content", {})
        parts = content.get("parts", [])
        if parts:
            return parts[0].get("text", "")
    return ""


def format_response(text: str, width: int = 80) -> str:
    """Format response text for display."""
    # Wrap text to specified width
    lines = []
    for paragraph in text.split("\n"):
        if paragraph.strip():
            wrapped = textwrap.wrap(paragraph, width=width)
            lines.extend(wrapped)
        else:
            lines.append("")
    return "\n".join(lines)


def truncate_text(text: str, max_chars: int = 500) -> str:
    """Truncate text to max characters, ending at a sentence if possible."""
    if len(text) <= max_chars:
        return text

    # Try to end at a sentence
    truncated = text[:max_chars]
    last_period = truncated.rfind(".")
    if last_period > max_chars * 0.5:  # Only use if we keep at least half
        return truncated[: last_period + 1]

    return truncated.rstrip() + "..."


def display_comparison(
    question: str,
    grounded_response: GroundedResponse,
    ungrounded_response: str,
    show_full: bool = False,
) -> None:
    """Display a side-by-side comparison of grounded vs ungrounded responses."""
    print("\n" + "=" * 80)
    print(f"QUESTION: {question}")
    print("=" * 80)

    # Display ungrounded response
    print("\n" + "-" * 40)
    print("WITHOUT GROUNDING (training data only)")
    print("-" * 40)
    ungrounded_text = ungrounded_response if show_full else truncate_text(ungrounded_response)
    print(format_response(ungrounded_text))

    # Display grounded response
    print("\n" + "-" * 40)
    print("WITH PARALLEL GROUNDING (real-time web)")
    print("-" * 40)
    grounded_text = grounded_response.text if show_full else truncate_text(grounded_response.text)
    print(format_response(grounded_text))

    # Display sources
    if grounded_response.sources:
        print(f"\nSOURCES ({len(grounded_response.sources)} found):")
        for i, source in enumerate(grounded_response.sources[:5], 1):
            title = source.title or "Untitled"
            print(f"  {i}. {title}")
            print(f"     {source.uri}")

    # Display search queries
    if grounded_response.web_search_queries:
        print(f"\nSEARCH QUERIES: {grounded_response.web_search_queries}")

    print()


def run_sample_questions(
    client: GroundedGeminiClient,
    project_id: str,
    location: str,
    model_id: str,
    num_questions: int = 3,
    show_full: bool = False,
) -> None:
    """Run comparison on sample questions about recent events."""
    print("\n" + "=" * 80)
    print("DEMO: Comparing Gemini Responses With and Without Parallel Grounding")
    print("=" * 80)
    print(f"\nModel: {model_id}")
    print(f"Running {num_questions} sample questions about recent events...")
    print("\nThis demo shows how grounding with Parallel provides access to")
    print("real-time web information that may not be in the model's training data.")

    questions = SAMPLE_QUESTIONS[:num_questions]

    for i, question in enumerate(questions, 1):
        print(f"\n[{i}/{num_questions}] Processing: {question[:50]}...")

        try:
            # Generate grounded response
            grounded_response = client.generate(
                prompt=question,
                model_id=model_id,
                temperature=0.2,
            )

            # Generate ungrounded response
            ungrounded_response = generate_without_grounding(
                prompt=question,
                project_id=project_id,
                location=location,
                model_id=model_id,
                temperature=0.2,
            )

            # Display comparison
            display_comparison(
                question=question,
                grounded_response=grounded_response,
                ungrounded_response=ungrounded_response,
                show_full=show_full,
            )

        except requests.HTTPError as e:
            print(f"\n[Error] Failed to process question: {e}")
            if e.response is not None:
                try:
                    error_detail = e.response.json()
                    print(f"[Detail] {error_detail}")
                except Exception:
                    print(f"[Detail] {e.response.text[:500]}")
        except Exception as e:
            print(f"\n[Error] Failed to process question: {type(e).__name__}: {e}")


def run_interactive_mode(
    client: GroundedGeminiClient,
    project_id: str,
    location: str,
    model_id: str,
    show_full: bool = False,
) -> None:
    """Run interactive mode where user can input their own questions."""
    print("\n" + "=" * 80)
    print("INTERACTIVE MODE: Ask Your Own Questions")
    print("=" * 80)
    print(f"\nModel: {model_id}")
    print("Enter questions to see grounded vs ungrounded responses.")
    print("Type 'quit' or 'exit' to end the session.")
    print("Type 'sample' to see a sample question.")
    print()

    sample_idx = 0

    while True:
        try:
            question = input("\nYour question: ").strip()

            if not question:
                continue

            if question.lower() in ("quit", "exit", "q"):
                print("\nGoodbye!")
                break

            if question.lower() == "sample":
                question = SAMPLE_QUESTIONS[sample_idx % len(SAMPLE_QUESTIONS)]
                sample_idx += 1
                print(f"Using sample question: {question}")

            print("\nGenerating responses...")

            # Generate grounded response
            grounded_response = client.generate(
                prompt=question,
                model_id=model_id,
                temperature=0.2,
            )

            # Generate ungrounded response
            ungrounded_response = generate_without_grounding(
                prompt=question,
                project_id=project_id,
                location=location,
                model_id=model_id,
                temperature=0.2,
            )

            # Display comparison
            display_comparison(
                question=question,
                grounded_response=grounded_response,
                ungrounded_response=ungrounded_response,
                show_full=show_full,
            )

        except KeyboardInterrupt:
            print("\n\nGoodbye!")
            break
        except Exception as e:
            print(f"\n[Error] {type(e).__name__}: {e}")


def main() -> None:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Demo: Vertex AI Gemini with Parallel web search grounding",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""
            Examples:
              python demo.py                    # Run 5 sample questions
              python demo.py --num 3            # Run 3 sample questions
              python demo.py --interactive      # Ask your own questions
              python demo.py --model gemini-2.5-flash --full

            Environment Variables:
              GOOGLE_CLOUD_PROJECT    Your GCP project ID (required)
              PARALLEL_API_KEY        Your Parallel API key (required)
              GOOGLE_CLOUD_LOCATION   GCP region (default: us-central1)
        """),
    )
    parser.add_argument(
        "--interactive",
        "-i",
        action="store_true",
        help="Run in interactive mode to ask your own questions",
    )
    parser.add_argument(
        "--check",
        "-c",
        action="store_true",
        help="Only run setup validation (check credentials and configuration)",
    )
    parser.add_argument(
        "--num",
        "-n",
        type=int,
        default=3,
        choices=range(1, len(SAMPLE_QUESTIONS) + 1),
        metavar=f"1-{len(SAMPLE_QUESTIONS)}",
        help=f"Number of sample questions to run (default: 3, max: {len(SAMPLE_QUESTIONS)})",
    )
    parser.add_argument(
        "--model",
        "-m",
        type=str,
        default="gemini-2.5-flash",
        choices=[
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
        ],
        help="Gemini model to use (default: gemini-2.5-flash)",
    )
    parser.add_argument(
        "--full",
        "-f",
        action="store_true",
        help="Show full responses instead of truncated versions",
    )

    args = parser.parse_args()

    # Validate setup before proceeding
    # This gives users clear feedback on what's missing
    print("Checking setup...")
    status = validate_setup()

    if not status.is_valid:
        print("\n" + str(status))
        sys.exit(1)

    print(str(status))

    # If --check flag was passed, exit after validation
    if args.check:
        sys.exit(0 if status.is_valid else 1)

    project_id = status.project_id
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
    parallel_api_key = os.environ.get("PARALLEL_API_KEY")

    # Initialize client
    try:
        client = GroundedGeminiClient(
            project_id=project_id,
            location=location,
            parallel_api_key=parallel_api_key,
        )
        print(f"\nInitialized client for project: {project_id}")
    except Exception as e:
        print(f"\nError initializing client: {e}")
        print("\nMake sure you have authenticated with Google Cloud:")
        print("  gcloud auth application-default login")
        sys.exit(1)

    # Run the appropriate mode
    if args.interactive:
        run_interactive_mode(
            client=client,
            project_id=project_id,
            location=location,
            model_id=args.model,
            show_full=args.full,
        )
    else:
        run_sample_questions(
            client=client,
            project_id=project_id,
            location=location,
            model_id=args.model,
            num_questions=args.num,
            show_full=args.full,
        )

    print("\n" + "=" * 80)
    print("Demo Complete!")
    print("=" * 80)
    print("\nFor more information, see the README.md file.")
    print("Documentation: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-parallel")


if __name__ == "__main__":
    main()
