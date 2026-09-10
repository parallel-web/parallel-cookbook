import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Load route handlers without a Next server, keeping the real SDK and serializer.
function load(relativePath) {
  const filename = path.resolve(dirname, "..", relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  mod.require = (name) => name === "@/lib/parallel" ? load("lib/parallel.ts") : originalRequire(name);
  mod._compile(compiled, filename);
  return mod.exports;
}

const post = (body) => new Request("http://localhost/api", {
  method: "POST", body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

test("routes serialize v1 requests and preserve response and Task contracts", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.PARALLEL_API_KEY;
  process.env.PARALLEL_API_KEY = "test-key";
  const calls = [];
  let responseBody = { results: [] };
  global.fetch = async (url, options) => {
    calls.push({ path: new URL(url).pathname, body: options.body && JSON.parse(options.body) });
    if (String(url).endsWith("/events")) {
      return new Response('event: task_run.status\ndata: {"type":"task_run.status","status":"completed"}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return Response.json(responseBody);
  };
  try {
    const search = load("app/api/search/route.ts");
    assert.deepEqual(await (await search.POST(post({ objective: "AI safety" }))).json(), responseBody);
    assert.deepEqual(calls.pop(), { path: "/v1/search", body: {
      objective: "AI safety", search_queries: ["AI safety"], mode: "basic",
      advanced_settings: { max_results: 10, excerpt_settings: { max_chars_per_result: 2500 } },
    } });
    await search.POST(post({ objective: "AI safety", searchQueries: [" alignment ", " "], mode: "agentic", maxResults: 3 }));
    assert.deepEqual(calls.at(-1).body.search_queries, ["alignment"]);
    assert.equal(calls.at(-1).body.mode, "advanced");
    assert.equal(calls.at(-1).body.advanced_settings.max_results, 3);
    await search.POST(post({ objective: "AI safety", searchQueries: [" "] }));
    assert.deepEqual(calls.at(-1).body.search_queries, ["AI safety"]);
    const count = calls.length;
    for (const body of [{ objective: " " }, { objective: "x", searchQueries: "x" }, { objective: "x", mode: "invalid" }]) {
      assert.equal((await search.POST(post(body))).status, 400);
    }
    assert.equal(calls.length, count);
    const extract = load("app/api/extract/route.ts");
    assert.deepEqual(await (await extract.POST(post({ urls: ["https://example.com"], objective: " facts " }))).json(), responseBody);
    assert.deepEqual(calls.pop(), { path: "/v1/extract", body: {
      urls: ["https://example.com"], objective: "facts", advanced_settings: { full_content: false },
    } });
    const tasks = load("app/api/tasks/route.ts");
    responseBody = { run_id: "run_test", status: "queued" };
    for (const [processor, type] of [["lite", "text"], ["pro", "auto"]]) {
      assert.deepEqual(await (await tasks.POST(post({ input: "Research", processor }))).json(), responseBody);
      assert.deepEqual(calls.pop(), { path: "/v1/tasks/runs", body: { input: "Research", processor, task_spec: { output_schema: { type } } } });
    }
    const params = { params: Promise.resolve({ runId: "run_test" }) };
    const status = load("app/api/tasks/[runId]/status/route.ts");
    responseBody = { status: "completed", output: { content: "Done" } };
    assert.deepEqual(await (await status.GET(null, params)).json(), responseBody);
    assert.deepEqual(calls.slice(-2).map((call) => call.path), ["/v1/tasks/runs/run_test", "/v1/tasks/runs/run_test/result"]);
    const events = load("app/api/tasks/[runId]/events/route.ts");
    const stream = await events.GET(null, params);
    assert.equal(stream.headers.get("Content-Type"), "text/event-stream");
    assert.equal(await stream.text(), 'data: {"type":"task_run.status","status":"completed"}\n\n');
    assert.equal(calls.at(-1).path, "/v1/tasks/runs/run_test/events");
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.PARALLEL_API_KEY;
    else process.env.PARALLEL_API_KEY = previousKey;
  }
});
