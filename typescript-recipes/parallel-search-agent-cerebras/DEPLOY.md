To deploy this on your own Cloudflare account:

1. [Install `wrangler`](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
2. In [`wrangler.json`](wrangler.json) edit the route to your preferred domain (or remove route property for atomatic wrokers.dev domain assignment)
3. Gather your Parallel and Cerebras API Keys into a `.env` file and add these secrets to your worker with `wrangler secret bulk .env`
4. Deploy using `wrangler deploy`
