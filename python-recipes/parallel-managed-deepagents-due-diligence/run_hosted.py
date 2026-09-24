"""Run the hosted Shopify agent, or continue its conversation."""

import argparse
import asyncio
import os

from langgraph_sdk import get_client


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", help="A research request, including its as-of date")
    parser.add_argument("--thread", help="Continue the printed thread ID")
    args = parser.parse_args()

    client = get_client(
        url=os.environ["LANGGRAPH_URL"],
        api_key=os.environ["LANGSMITH_API_KEY"],
        # Studio authentication supplies the person identity managed tools need.
        headers={"x-auth-scheme": "langsmith"},
    )
    thread_id = args.thread or (await client.threads.create())["thread_id"]
    print(f"Thread: {thread_id}", flush=True)
    result = await client.runs.wait(
        thread_id,
        "shopify-due-diligence",
        input={"messages": [{"role": "user", "content": args.prompt}]},
    )
    if not isinstance(result, dict):
        raise RuntimeError("The run returned no conversation state.")
    if "__error__" in result:
        raise RuntimeError(str(result["__error__"]))

    # Only accept an answer after this turn's most recent user message.
    for message in reversed(result.get("messages", [])):
        role = message.get("type", message.get("role"))
        if role in {"human", "user"}:
            break
        if role not in {"ai", "assistant"} or message.get("tool_calls"):
            continue
        content = message.get("content", "")
        if isinstance(content, list):
            content = "\n".join(
                block["text"]
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            )
        if isinstance(content, str) and content.strip():
            print(content)
            return
    raise RuntimeError("The run returned no new assistant answer.")


if __name__ == "__main__":
    asyncio.run(main())
