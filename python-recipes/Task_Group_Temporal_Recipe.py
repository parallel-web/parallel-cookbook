"""Demo Script for using Parallel AI task groups with Temporal.


# Temporal + Parallel Task Group Demo

A minimal Temporal workflow that uses the Parallel Task Group API to check if companies use Looker BI tool.

## Setup

1. **Configure API Keys**: Update the configuration variables at the top of this script with your own API keys and settings.

2. **Install Dependencies**:
   ```bash
   pip install httpx temporalio
   ```

## Run

```bash
cd omni_customer_script
python demo_runner.py
```

The workflow will process multiple companies in parallel and show which ones use Looker BI tool.
"""

import asyncio
import os
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.worker import Worker

# Parallel API configuration


PARALLEL_API_KEY = os.environ.get("PARALLEL_API_KEY")
PARALLEL_BASE_URL = "https://api.parallel.ai"
TEMPORAL_API_KEY = os.environ.get("TEMPORAL_API_KEY")
TEMPORAL_NAMESPACE = os.environ.get("TEMPORAL_NAMESPACE")
TEMPORAL_CLOUD_URL = os.environ.get("TEMPORAL_CLOUD_URL")




@dataclass
class Company:
    """Company data."""

    name: str
    website: str


@dataclass
class LookerResult:
    """Looker usage result."""

    company: str
    uses_looker: bool
    reasoning: str
    confidence: str
    citations: list[dict[str, Any]]


@dataclass
class AddTasksInput:
    """Input for adding tasks to a group."""

    taskgroup_id: str
    companies: list[Company]


@dataclass
class PollResultsInput:
    """Input for polling results from a group."""

    taskgroup_id: str


# Task specification for Looker checking
TASK_SPEC = {
    "input_schema": {
        "type": "json",
        "json_schema": {
            "type": "object",
            "properties": {
                "company": {
                    "description": "The name of the company to check for Looker usage.",
                    "type": "string",
                },
                "website": {
                    "description": "The website of the company to check for Looker usage.",
                    "type": "string",
                },
            },
        },
    },
    "output_schema": {
        "type": "json",
        "json_schema": {
            "additionalProperties": False,
            "type": "object",
            "properties": {
                "uses_looker": {
                    "description": "Boolean indicating whether the company uses Looker as their BI tool.",
                    "type": "boolean",
                }
            },
            "required": ["uses_looker"],
        },
    },
    "title": "Looker Usage Check",
}


@activity.defn
async def create_task_group() -> str:
    """Create a new task group and return its ID."""
    import httpx

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{PARALLEL_BASE_URL}/v1beta/tasks/groups",
            headers={"x-api-key": PARALLEL_API_KEY, "Content-Type": "application/json"},
            json={},
        )
        response.raise_for_status()
        result = response.json()
        return result["taskgroup_id"]


@activity.defn
async def add_tasks_to_group(input: AddTasksInput) -> list[str]:
    """Add tasks to the group for each company."""
    import httpx

    # Prepare task inputs
    inputs = []
    for company in input.companies:
        inputs.append(
            {
                "task_spec": TASK_SPEC,
                "input": {"company": company.name, "website": company.website},
                "processor": "core",
            }
        )

    # Add tasks to group
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{PARALLEL_BASE_URL}/v1beta/tasks/groups/{input.taskgroup_id}/runs",
            headers={"x-api-key": PARALLEL_API_KEY, "Content-Type": "application/json"},
            json={"inputs": inputs},
        )
        response.raise_for_status()
        result = response.json()
        return result["run_ids"]


@activity.defn
async def poll_and_get_results(input: PollResultsInput) -> list[LookerResult]:
    """Poll for completion and return results."""
    import json

    import httpx

    async with httpx.AsyncClient() as client:
        # Poll until completion
        while True:
            # Check group status
            response = await client.get(
                f"{PARALLEL_BASE_URL}/v1beta/tasks/groups/{input.taskgroup_id}",
                headers={"x-api-key": PARALLEL_API_KEY},
            )
            response.raise_for_status()
            status = response.json()["status"]

            print(f"Tasks status: {status['task_run_status_counts']}")

            if not status["is_active"]:
                break

            await asyncio.sleep(5)

        # Get results
        results = []
        response = await client.get(
            f"{PARALLEL_BASE_URL}/v1beta/tasks/groups/{input.taskgroup_id}/runs?include_input=true&include_output=true",
            headers={"x-api-key": PARALLEL_API_KEY},
        )
        response.raise_for_status()

        # Parse Server-Sent Events format
        for line in response.text.strip().split("\n"):
            if line.startswith("data: "):
                try:
                    # Extract JSON from "data: {...}" line
                    json_data = line[6:]  # Remove "data: " prefix
                    event = json.loads(json_data)

                    # Check if this event has completed output
                    if event.get("output") and event.get("input"):
                        company_name = event["input"]["input"]["company"]
                        uses_looker = event["output"]["content"]["uses_looker"]

                        # Extract additional fields from basis
                        basis = event["output"]["basis"][0]
                        reasoning = basis.get("reasoning", "No reasoning provided")
                        confidence = basis.get("confidence", "unknown")
                        citations = basis.get("citations", [])

                        results.append(
                            LookerResult(
                                company=company_name,
                                uses_looker=uses_looker,
                                reasoning=reasoning,
                                confidence=confidence,
                                citations=citations,
                            )
                        )
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue

        print(f"Found {len(results)} results")
        return results


@workflow.defn
class LookerCheckWorkflow:
    """Workflow to check if companies use Looker BI tool."""

    @workflow.run
    async def run(self, companies: list[Company]) -> list[LookerResult]:
        # Step 1: Create task group
        taskgroup_id = await workflow.execute_activity(
            create_task_group, start_to_close_timeout=timedelta(seconds=60)
        )
        print(f"Created task group: {taskgroup_id}")

        # Step 2: Add tasks to group
        run_ids = await workflow.execute_activity(
            add_tasks_to_group,
            AddTasksInput(taskgroup_id=taskgroup_id, companies=companies),
            start_to_close_timeout=timedelta(seconds=600),
        )
        print(f"Added {len(run_ids)} tasks to group")

        # Step 3: Poll and get results
        results = await workflow.execute_activity(
            poll_and_get_results,
            PollResultsInput(taskgroup_id=taskgroup_id),
            start_to_close_timeout=timedelta(minutes=60),
        )

        return results


async def main():
    """Run the demo."""
    # Connect to Temporal Cloud
    client = await Client.connect(
        TEMPORAL_CLOUD_URL,
        namespace=TEMPORAL_NAMESPACE,
        api_key=TEMPORAL_API_KEY,
        tls=True,
    )

    # Start worker in background
    worker = Worker(
        client,
        task_queue="looker-demo-queue-0",
        workflows=[LookerCheckWorkflow],
        activities=[create_task_group, add_tasks_to_group, poll_and_get_results],
    )

    # Test companies
    companies = [
        Company("Stripe", "https://stripe.com"),
        Company("Shopify", "https://shopify.com"),
        Company("Airbnb", "https://airbnb.com"),
        Company("Uber", "https://uber.com"),
    ]

    async with worker:
        # Run workflow
        results = await client.execute_workflow(
            LookerCheckWorkflow.run,
            companies,
            id="looker-check-demo-" + str(uuid.uuid4()),
            task_queue="looker-demo-queue-0",
        )

        # Print results
        print("\n=== LOOKER USAGE RESULTS ===")
        for result in results:
            status = "✓ Uses Looker" if result.uses_looker else "✗ No Looker"
            print(f"\n{result.company}: {status}")
            print(f"  Reasoning: {result.reasoning}")
            print(f"  Confidence: {result.confidence}")


if __name__ == "__main__":
    asyncio.run(main())
