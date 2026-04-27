To deploy this on your own Cloudflare account:

1. [Install `wrangler`](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and run `wrangler login`
2. Create a KV namespace for rate limiting and copy the returned `id` into [`wrangler.jsonc`](wrangler.jsonc):
   ```bash
   wrangler kv:namespace create RATE_LIMIT_KV
   ```
3. (Optional) Add a `routes` entry to `wrangler.jsonc` if you want to bind a custom domain. Otherwise wrangler assigns a `*.workers.dev` URL.
4. Gather your Parallel and Groq API keys into a `.env` file and load them as secrets:
   ```bash
   wrangler secret bulk .env
   ```
5. Deploy: `wrangler deploy`
