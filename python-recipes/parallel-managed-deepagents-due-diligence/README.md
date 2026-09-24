# Shopify due diligence with managed Parallel search

This is a small [Managed Deep Agents](https://docs.langchain.com/langsmith/python/managed-deep-agents-overview) example. Managed Deep Agents is LangSmith's way of hosting an agent for you: you write a few files describing the agent, run one command, and LangSmith runs it in the cloud.

This agent researches Shopify. You give it a date, it searches the web with Parallel (managed by LangSmith), and it hands back a sourced due diligence brief. You can keep asking follow-up questions in the same chat. Every search it runs shows up in LangSmith, including the URLs and excerpts it got back, so you can check its work.

By the end you'll have the agent running in your LangSmith account and you'll be chatting with it in the browser. You don't need a Parallel account or API key. The whole search integration is one server entry in [`tools/mcp.py`](tools/mcp.py):

```python
mcp = define_mcp(
    servers={
        "Parallel": {
            "transport": "http",
            "url": "https://api.smith.langchain.com/v1/managed-tools/servers/parallel/mcp",
        },
    },
)
```

LangSmith handles the Parallel credentials and runs the search for you. Parallel search is free during the [Managed Deep Agents public beta](https://www.langchain.com/blog/langsmith-managed-deep-agents-whats-new). The server gives the agent one tool, `Parallel__parallel_web_search`, which returns ranked URLs with excerpts that match the query. The agent cites those excerpts, and when it can't find something it says so instead of guessing. It only ever sees excerpts, so it won't pretend it read a full filing.

## What you need

- Python 3.11 or newer and [uv](https://docs.astral.sh/uv/getting-started/installation/).
- A [LangSmith](https://smith.langchain.com/) workspace on US Cloud, on the Plus plan or higher, with Managed Deep Agents access. Cloud deployment isn't included in the free Developer plan. See [LangSmith pricing](https://docs.langchain.com/langsmith/pricing-plans).
- An [OpenAI API key](https://platform.openai.com/api-keys). The agent runs on `openai:gpt-5.5`, which is already set in [`agent.py`](agent.py), so you don't have to pick a model.

## 1. Clone the repo

```sh
git clone https://github.com/parallel-web/parallel-cookbook.git
cd parallel-cookbook/python-recipes/parallel-managed-deepagents-due-diligence
uv sync --frozen
cp .env.example .env
```

## 2. Fill in `.env`

You need three values. They let the `mda` command line tool deploy the agent into your LangSmith account and give the hosted agent your OpenAI key.

**`LANGSMITH_API_KEY`**

1. Go to [smith.langchain.com](https://smith.langchain.com) and sign in (or sign up with Google, GitHub, or email).
2. Open [**Settings**](https://smith.langchain.com/settings), then **API Keys**.
3. Create a **personal** API key (not a service key) and copy it. LangSmith only shows it once.

**`LANGSMITH_WORKSPACE_ID`**

1. Still in [**Settings**](https://smith.langchain.com/settings), open **General**.
2. Copy the **Workspace ID**.

**`OPENAI_API_KEY`**

Paste your OpenAI API key. When you deploy, `mda` uploads it to the hosted agent as a secret.

Your `.env` should look like this:

```sh
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_WORKSPACE_ID=...
OPENAI_API_KEY=sk-...
```

Don't worry, `.env` is gitignored.

To try the agent locally before deploying, run `uv run mda dev`. It opens Studio with managed Parallel search enabled, without creating a cloud deployment. This recipe pins `managed-deepagents==0.8.0`, which includes the local managed-tool identity fix.

## 3. Deploy it to LangSmith

```sh
uv run mda deploy
```

This packages up the project and creates a deployment called `shopify-due-diligence` in your workspace. It also uploads the agent's prompt, [`instructions.md`](instructions.md), to LangSmith's Context Hub. It takes a few minutes. When it's done, it prints a dashboard URL.

## 4. Chat with it in Studio

Studio is LangSmith's chat window for deployed agents. Open the dashboard URL from the deploy, click **Connect → Studio**, open **Chat**, pick **shopify-due-diligence**, and turn on **Show tool calls** so you can watch the searches happen.

Start a new thread and send:

```text
Prepare a Shopify due diligence brief as of today.
```

The agent resolves "today" using the current UTC date and shows the exact date in the brief. You can also give an explicit date, like `2026-09-23`. If you leave the date out, it asks for one. You'll get a brief that names the latest reported quarter and the 90-day window it looked at, puts a dated source link next to each claim, and lists anything it couldn't verify. If one of those gaps matters to you, just ask it to go look.

Then, in the same thread, try:

```text
How does subscription versus merchant-services growth affect Shopify's margins in that quarter?
```

It sticks with the same quarter from the brief and knows "merchant services" means Shopify's **Merchant solutions** revenue line. It'll search again if it needs more, and it keeps the reported numbers separate from its own margin analysis.

Want to see what a run looks like first? The [saved sample](samples/shopify-brief-2026-09-23.md) has a brief and follow-up from September 23, 2026, along with the run IDs and the gaps it found.

## 5. Check the search evidence

A trace is LangSmith's step-by-step record of a run. From Studio, open the run's trace and expand a **Parallel__parallel_web_search** call. The inputs show the queries the agent sent, and the output shows the URLs and excerpts it got back.

Pick a number from the brief, click its source link, and find the matching excerpt in the tool output. That way you're checking the evidence itself, not just taking the agent's word for it.

## Make it your own

- **Change what it researches or how the brief looks:** edit [`instructions.md`](instructions.md) and run `uv run mda deploy` again. Parallel's [Search best practices](https://docs.parallel.ai/search/best-practices) are worth a read for writing good search objectives and queries.
- **Use a different model:** change `model` in [`agent.py`](agent.py). Any tool-calling model from LangChain's [supported models list](https://docs.langchain.com/oss/python/deepagents/models#supported-models) works. This project only installs `langchain-openai`, so another provider also needs its integration package and API key.

## Optional: run it from the terminal

If you'd rather skip Studio, [`run_hosted.py`](run_hosted.py) talks to the deployed agent directly. Add `LANGGRAPH_URL` to `.env`. That's the deployment's Agent Server URL, which you'll find in the deploy output and on the dashboard. Then run:

```sh
uv run --env-file .env python run_hosted.py "Prepare a Shopify due diligence brief as of today."
```

It prints `Thread: ...` and then the answer. Pass that thread ID to keep the conversation going:

```sh
uv run --env-file .env python run_hosted.py --thread THREAD_ID "How does subscription versus merchant-services growth affect Shopify's margins in that quarter?"
```

The runner sends your personal key with `x-auth-scheme: langsmith`, using Studio's authentication route to supply the person identity that managed tools need.

## Files

| File | What it does |
| --- | --- |
| `agent.py` | Names the agent and sets its model |
| `instructions.md` | The system prompt: brief layout, sourcing rules, date window, and how to handle follow-ups |
| `tools/mcp.py` | Hooks up the managed Parallel MCP server |
| `identity.py` | Requires LangSmith auth, which managed search needs |
| `run_hosted.py` | Optional terminal client for the hosted agent |
| `samples/` | A saved brief and follow-up |

## Troubleshooting

- **Deploy fails with 401 or 403**: check that your API key is from a workspace on the Plus plan or higher, and that `LANGSMITH_WORKSPACE_ID` matches that workspace.
- **Deploy says the OpenAI key is missing**: make sure `OPENAI_API_KEY` is set in `.env`.
- **`user-owned connections require a person principal`**: the request showed up as a service caller. Use Studio, or `run_hosted.py` with a personal API key.
- **No `Parallel__parallel_web_search` calls in the trace**: make sure `identity.py` is still in the project. Without a signed-in caller, the agent skips managed MCP servers.
- **Studio says your token is invalid after a redeploy**: reload Studio.
- **Deploy asks about Context Hub edits**: someone changed the prompt in LangSmith since your last deploy. Decide whether to keep their edits or replace them with your `instructions.md`.

For more on deploying, check out the [Managed Deep Agents docs](https://docs.langchain.com/langsmith/python/managed-deep-agents-overview) and the [CLI reference](https://docs.langchain.com/langsmith/python/managed-deep-agents-cli).

## License

[MIT](LICENSE).
