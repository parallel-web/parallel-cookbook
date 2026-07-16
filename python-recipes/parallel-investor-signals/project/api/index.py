# api/index.py — Vercel Python serverless entrypoint.
#
# We DON'T rewrite the backend: this just re-exports the existing FastAPI `app`
# from backend/main.py (which reads PARALLEL_API_KEY server-side and calls the
# dedicated Parallel client in backend/parallel_client.py). On Vercel the key
# comes from the project env var — parallel_client's load_dotenv() finds no
# .env file and quietly no-ops, so os.environ wins. Key never reaches the client.
#
# Timeout note: bounded by `maxDuration` in vercel.json (300s). A Fast (core-fast)
# single lookup runs ~60-80s — inside the limit. Deep (pro-fast) can exceed it;
# that tradeoff is documented in the README/CHANGELOG.

from backend.main import app

# Vercel's Python runtime detects and serves this ASGI `app`.
__all__ = ["app"]
