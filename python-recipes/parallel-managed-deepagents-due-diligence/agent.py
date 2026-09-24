"""Shopify research, hosted by Managed Deep Agents."""

from datetime import datetime, timezone

from langchain.agents.middleware import ModelRequest, dynamic_prompt
from langchain_core.messages import SystemMessage
from managed_deepagents import define_deep_agent


@dynamic_prompt
def current_date(request: ModelRequest) -> SystemMessage:
    """Refresh the date on every model request without replacing managed instructions."""
    today = datetime.now(timezone.utc).date().isoformat()
    return request.system_message.model_copy(
        update={
            "content": [
                *request.system_message.content_blocks,
                {"type": "text", "text": f"Current date (UTC): {today}."},
            ]
        }
    )


agent = define_deep_agent(
    name="shopify-due-diligence",
    middleware=[current_date],
    model="openai:gpt-5.5",
)
