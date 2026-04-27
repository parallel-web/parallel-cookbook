# Contributing to the Parallel Cookbook

Thanks for considering a contribution. The cookbook exists to help developers ship with [Parallel](https://parallel.ai) faster — every recipe should leave a builder thinking *"I could fork this today."*

There are three ways to contribute:

1. **[Submit a recipe](#submitting-a-recipe)** to live in this repo
2. **[Submit a community example](#submitting-a-community-example)** that lives in your own repo
3. **[Improve the cookbook itself](#improving-the-cookbook)** — docs, organization, the website

For anything not covered here, open an [issue](https://github.com/parallel-web/parallel-cookbook/issues) or DM [@p0](https://x.com/p0).

---

## Submitting a Recipe

A recipe is a self-contained working application with a live demo and a clear pedagogical point. Every recipe in the cookbook should answer *"why would someone copy this?"* in one sentence.

### What makes a good recipe

| ✅ Good | ❌ Avoid |
| --- | --- |
| Solves one specific problem (e.g. "stream Task progress to a UI") | Tries to demo every Parallel API at once (templates are the exception) |
| Shipped with a live demo URL | Local-only with no deploy story |
| Has a one-click deploy button or `DEPLOY.md` | Requires hand-rolling infra to try it |
| Real research/data domain (companies, papers, news) | "Hello world" toy data |
| README explains the *design decisions*, not just setup | README is just `npm install && npm run dev` |
| Uses our latest API surfaces (Search, Extract, Task SSE, Ingest) | Wraps deprecated endpoints |

### Folder structure

Pick a top-level home based on language:

```
typescript-recipes/<your-recipe-name>/
python-recipes/<your-recipe-name>/
```

Use kebab-case directories prefixed with `parallel-` (e.g. `parallel-fact-checker-cerebras`). Inside the recipe folder include at minimum:

```
<your-recipe-name>/
├── README.md             # Required — see template below
├── .env.example          # Required if the recipe needs secrets
├── package.json          # Or pyproject.toml / requirements.txt
├── LICENSE               # MIT preferred for parity with the cookbook
└── ...                   # Your code
```

If your recipe deploys to Cloudflare, Vercel, or Supabase, include the appropriate config (`wrangler.jsonc`, `vercel.json`, `supabase/config.toml`).

### README template

Every recipe README should hit these sections, roughly in this order:

```markdown
# <Recipe Title>

One-sentence pitch. Live demo: <url>

[Deploy button or link to DEPLOY.md]

## What it shows
- Bullet 1
- Bullet 2

## Architecture
ASCII diagram or short prose explaining the request flow.

## Quick Start
1. Clone
2. Install
3. Set env vars
4. Run

## How it works
The interesting part — design choices, gotchas, why this approach.

## License
MIT (or whatever you chose)
```

The [Vercel Template README](typescript-recipes/parallel-vercel-template/README.md) is a good reference.

### Register the recipe

After your recipe is in place, add an entry to two places so it shows up everywhere:

1. **[`README.md`](README.md)** — add a row under the most appropriate category. If no category fits, propose a new one.
2. **[`website/cookbook.json`](website/cookbook.json)** — add an entry following [`cookbook.schema.json`](website/cookbook.schema.json). Fields:

   ```json
   {
     "slug": "your-recipe-name",
     "popular": false,
     "featured": false,
     "title": "Display Title",
     "description": "One-sentence description.",
     "repoUrl": "https://github.com/parallel-web/parallel-cookbook/tree/main/typescript-recipes/your-recipe-name",
     "websiteUrl": "https://your-demo.example.com",
     "creators": ["yourgithub"],
     "imageUrl": "https://svg.quickog.com/https://your-demo.example.com/og.svg",
     "tags": ["task", "sse", "cloudflare"]
   }
   ```

   Reviewers set `featured` / `popular`.

### Tags

Use lowercase, hyphenated tags drawn from this controlled vocabulary so filters stay clean:

- **API surface**: `search`, `extract`, `task`, `deep-research`, `ingest`, `mcp`, `webhooks`, `sse`, `oauth`
- **Stack**: `cloudflare`, `vercel`, `nextjs`, `supabase`, `vertex-ai`, `python`, `typescript`, `temporal`
- **Pattern**: `agent`, `enrichment`, `monitoring`, `realtime`, `batch`, `fact-checking`, `template`, `entity-resolution`

Propose new tags in your PR if none of these fit.

### Quality bar

Before opening a PR, double-check:

- [ ] Recipe runs end-to-end from a fresh clone using only the README
- [ ] Live demo URL is reachable and shows what the README claims
- [ ] No API keys, secrets, or `.env` files committed (use `.env.example`)
- [ ] Lockfile committed (`package-lock.json`, `pnpm-lock.yaml`, or `uv.lock`)
- [ ] LICENSE included (MIT preferred)
- [ ] Title and description fit on one line each
- [ ] Recipe added to **both** `README.md` and `website/cookbook.json`

---

## Submitting a Community Example

If your project lives in your own repo and you'd rather keep it there, that's perfect — open a PR adding a row to the **Community Examples** table in [`README.md`](README.md) and an entry to [`website/cookbook.json`](website/cookbook.json) (omit the `repoUrl` pointing into this repo; use yours).

We'll feature standout community projects on the website.

---

## Improving the Cookbook

Documentation, organization, the [`website/`](website/) sources, and the [`task-best-practices.md`](task-best-practices.md) guide are all fair game for PRs. For larger reorgs (new top-level categories, folder moves), open an issue first so we can align before you build.

## Code of Conduct

Be kind, give credit, and credit others' work properly. Recipes shouldn't include scraped private data, copyrighted media, or content that violates a source's terms of service. If you're unsure, ask in your PR.

## Questions

- Open an [issue](https://github.com/parallel-web/parallel-cookbook/issues)
- DM [@p0](https://x.com/p0) on X
- Email hello@parallel.ai
