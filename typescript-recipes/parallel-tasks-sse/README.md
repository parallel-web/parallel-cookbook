# Building a Parallel Task Playground with streaming

This is a pure HTML + JS + CSS implementation (that uses a small backend for proxying API requests to avoid CORS issues) of task streaming. It allows testing all capabilities of task creation and streaming. Some learnings made along the way:

- We don't need to maintain a separate state in any backend during streaming because the /events endpoint gives us the latest state on every request.
- We just need the task creation endpoint and the events SSE endpoint to build this interface. The SSE also keeps the state after the event is done.
- Not all processors have all events, and after the task is completed, some reasoning traces may be removed, but generally speaking, the SSE stream always starts with previous events that happened before starting, but gives only the latest version of the progress_stats.
