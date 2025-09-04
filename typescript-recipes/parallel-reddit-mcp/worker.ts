/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />

import { DurableObject } from "cloudflare:workers";
import { UserContext, withSimplerAuth } from "simplerauth-client";
import Parallel from "parallel-web";
//@ts-ignore
import indexHtml from "./index.html";
//@ts-ignore
import resultHtml from "./result.html";

export interface Env {
  CHANGEMYMIND: DurableObjectNamespace<ChangeMindDO>;
  PARALLEL_API_KEY: string;
  PARALLEL_WEBHOOK_SECRET: string;
  MCP_URL: string;
}

interface TaskRow {
  slug: string;
  statement: string;
  status: "pending" | "done";
  username: string;
  profile_image_url: string;
  created_at: string;
  updated_at: string;
  visits: number;
  result: string | null;
  error: string | null;
}

function createSlug(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    return withSimplerAuth<Env>(
      async (request, env, ctx) => {
        const url = new URL(request.url);
        // Remove first segment from pathname for routing
        const pathname = url.pathname;

        const do_id = env.CHANGEMYMIND.idFromName("v2");
        const do_stub = env.CHANGEMYMIND.get(do_id);

        switch (pathname) {
          case "/":
            return handleHome(do_stub);

          case "/new":
            return handleNew(request, do_stub, ctx, env);

          case "/webhook":
            return handleWebhook(request, do_stub, env);

          default:
            if (pathname.startsWith("/result/")) {
              const slug = pathname.replace("/result/", "");
              return handleResult(slug, do_stub);
            }
            return new Response("Not Found", { status: 404 });
        }
      },
      { isLoginRequired: false }
    )(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

async function handleHome(
  do_stub: DurableObjectStub<ChangeMindDO>
): Promise<Response> {
  const popular = await do_stub.getPopularTasks(6);
  const recent = await do_stub.getRecentTasks(30);

  const createCards = (tasks: TaskRow[]) => {
    if (tasks.length === 0) {
      return `<div class="text-center py-12">
        <p class="text-gray-500 text-lg">No debates yet. Be the first to start one!</p>
      </div>`;
    }

    return `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">${tasks
      .map(
        (task) =>
          `<div class="card-meme" onclick="window.location.href='/result/${
            task.slug
          }'">
        <div class="card-meme-text">${escapeHtml(task.statement)}</div>
      </div>`
      )
      .join("")}</div>`;
  };

  const popularCards = createCards(popular);
  const recentCards = createCards(recent);

  let html = indexHtml;

  // Replace the entire popular section
  html = html.replace(
    /<section id="popular"[\s\S]*?<\/section>/,
    `<section id="popular" class="py-16 px-6 neural-bg">
        <div class="max-w-6xl mx-auto">
            <h3 class="gerstner text-3xl font-medium mb-12 text-center index-black-text">
                Popular Debates
            </h3>

                ${popularCards}
        </div>
    </section>`
  );

  // Replace the entire recent section
  html = html.replace(
    /<section id="recent"[\s\S]*?<\/section>/,
    `<section id="recent" class="py-16 px-6 neural-bg">
        <div class="max-w-6xl mx-auto">
            <h3 class="gerstner text-3xl font-medium mb-12 text-center index-black-text">
                Recent Debates
            </h3>

                ${recentCards}
        </div>
    </section>`
  );

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

async function handleNew(
  request: Request,
  do_stub: DurableObjectStub<ChangeMindDO>,
  ctx: UserContext,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const statement = url.searchParams.get("statement");

  if (!statement || statement.trim().length === 0) {
    return new Response("Statement is required", { status: 400 });
  }

  if (!ctx.authenticated) {
    const redirectUrl = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/authorize?redirect_to=${encodeURIComponent(redirectUrl)}`,
      },
    });
  }

  const slug = createSlug(statement);

  // Check user limits and slug existence
  const userTasks = await do_stub.getUserTaskCount(ctx.user?.username);
  if (userTasks >= 5) {
    return new Response(
      "Maximum of 5 searches allowed per user. Host it yourself if you like to have more! \n\nhttps://github.com/parallel-web/parallel-cookbook/tree/main/typescript-recipes/parallel-reddit-mcp",
      {
        status: 429,
      }
    );
  }

  const existingTask = await do_stub.getTask(slug);
  if (existingTask) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/result/${slug}`,
      },
    });
  }

  // Create task
  const parallel = new Parallel({ apiKey: env.PARALLEL_API_KEY });

  try {
    const taskRun = await parallel.taskRun.create(
      {
        input: `Statement to counter-argue: "${statement}"`,
        processor: "base",
        task_spec: {
          output_schema: {
            json_schema: {
              type: "object",
              properties: {
                counterpoints: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "3-5 compelling counter-arguments from Reddit discussions, each 2-3 sentences long",
                },
                roast: {
                  type: "string",
                  description:
                    "A witty, humorous roast of the original statement (1-2 sentences, keep it playful)",
                },
              },
              required: ["counterpoints", "roast"],
              additionalProperties: false,
            },
            type: "json",
          },
        },
        metadata: { slug },
        mcp_servers: [
          {
            name: "Reddit",
            url: env.MCP_URL,
            type: "url",
          },
        ],
        webhook: {
          url: `${url.protocol}//${url.host}/webhook`,
          event_types: ["task_run.status"],
        },
      },
      {
        headers: {
          "parallel-beta": "mcp-server-2025-07-17,webhook-2025-08-12",
        },
      }
    );

    console.log({ taskRun: taskRun });

    await do_stub.createTask({
      slug,
      statement: statement.trim(),
      status: "pending",
      username: ctx.user.username,
      profile_image_url: ctx.user.profile_image_url || "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      visits: 0,
      result: null,
      error: null,
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: `/result/${slug}`,
      },
    });
  } catch (error) {
    console.error("Error creating task:", error);
    return new Response("Error creating task", { status: 500 });
  }
}

async function handleWebhook(
  request: Request,
  do_stub: DurableObjectStub<ChangeMindDO>,
  env: Env
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  console.log("Handling webhook");
  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const webhookSignature = request.headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return new Response("Missing webhook headers", { status: 400 });
  }
  console.log("Got headers");

  const body = await request.text();

  // Verify webhook signature
  if (
    !verifyWebhookSignature(
      env.PARALLEL_WEBHOOK_SECRET,
      webhookId,
      webhookTimestamp,
      body,
      webhookSignature
    )
  ) {
    return new Response("Invalid signature", { status: 401 });
  }

  console.log("Signature correct");

  const payload = JSON.parse(body);

  if (
    payload.type === "task_run.status" &&
    payload.data.status === "completed"
  ) {
    const slug = payload.data.metadata?.slug;
    if (!slug) {
      return new Response("Missing slug in metadata", { status: 400 });
    }

    try {
      const parallel = new Parallel({ apiKey: env.PARALLEL_API_KEY });
      const result = await parallel.taskRun.result(payload.data.run_id);

      if (result.output.type === "json") {
        await do_stub.updateTaskResult(slug, JSON.stringify(result), null);
      } else {
        await do_stub.updateTaskResult(slug, null, "Unexpected output format");
      }
    } catch (error) {
      console.error("Error fetching result:", error);
      await do_stub.updateTaskResult(slug, null, "Error fetching result");
    }
  } else if (
    payload.type === "task_run.status" &&
    payload.data.status === "failed"
  ) {
    const slug = payload.data.metadata?.slug;
    if (slug) {
      await do_stub.updateTaskResult(
        slug,
        null,
        payload.data.error?.message || "Task failed"
      );
    }
  } else {
    console.log("Unknown payload", payload);
  }

  return new Response("OK");
}

async function handleResult(
  slug: string,
  do_stub: DurableObjectStub<ChangeMindDO>
): Promise<Response> {
  const task = await do_stub.getTask(slug);

  if (!task) {
    return new Response("Debate not found", { status: 404 });
  }

  if (task.status === "done") {
    // Increment visits
    await do_stub.incrementVisits(slug);
  }

  let html = resultHtml;

  // Inject dynamic data

  const result = task.result ? JSON.parse(task.result) : null;

  if (result?.output?.["beta_fields"]?.["mcp-server-2025-07-17"]) {
    // correct slight sdk difference with api spec
    result.output.mcp_tool_calls =
      result?.output?.["beta_fields"]?.["mcp-server-2025-07-17"];
  }
  const data = {
    task: {
      ...task,
      result,
    },
  };

  html = html.replace(
    "</head>",
    `<script>window.data = ${JSON.stringify(data)}</script></head>`
  );

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

async function verifyWebhookSignature(
  secret: string,
  webhookId: string,
  webhookTimestamp: string,
  body: string,
  signatureHeader: string
): Promise<boolean> {
  const payload = `${webhookId}.${webhookTimestamp}.${body}`;

  for (const part of signatureHeader.split(" ")) {
    if (part.startsWith("v1,")) {
      const receivedSignature = part.substring(3);

      const arr = await crypto.subtle
        .importKey(
          "raw",
          new TextEncoder().encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        )
        .then((key) =>
          crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
        )
        .then((sig) => new Uint8Array(sig));

      const expectedSignature = btoa(
        String.fromCharCode(...new Uint8Array(arr))
      );

      if (receivedSignature === expectedSignature) {
        return true;
      }
    }
  }

  return false;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class ChangeMindDO extends DurableObject<Env> {
  sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.initDatabase();
  }

  private initDatabase() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        slug TEXT PRIMARY KEY,
        statement TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
        username TEXT NOT NULL,
        profile_image_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        visits INTEGER NOT NULL DEFAULT 0,
        result TEXT,
        error TEXT
      )
    `);
  }

  async createTask(
    task: Omit<TaskRow, "visits"> & { visits?: number }
  ): Promise<void> {
    this.sql.exec(
      `
      INSERT INTO tasks (slug, statement, status, username, profile_image_url, created_at, updated_at, visits, result, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      task.slug,
      task.statement,
      task.status,
      task.username,
      task.profile_image_url,
      task.created_at,
      task.updated_at,
      task.visits || 0,
      task.result,
      task.error
    );
  }

  async getTask(slug: string): Promise<TaskRow | null> {
    const results = this.sql.exec("SELECT * FROM tasks WHERE slug = ?", slug);
    const rows = results.toArray();
    return rows.length > 0 ? (rows[0] as TaskRow) : null;
  }

  async getUserTaskCount(username: string): Promise<number> {
    const results = this.sql.exec(
      "SELECT COUNT(*) as count FROM tasks WHERE username = ?",
      username
    );
    const rows = results.toArray();
    return (rows[0] as any).count;
  }

  async updateTaskResult(
    slug: string,
    result: string | null,
    error: string | null
  ): Promise<void> {
    const status = error ? "done" : "done"; // Both success and error are considered "done"
    this.sql.exec(
      `
      UPDATE tasks 
      SET status = ?, result = ?, error = ?, updated_at = ?
      WHERE slug = ?
    `,
      status,
      result,
      error,
      new Date().toISOString(),
      slug
    );
  }

  async incrementVisits(slug: string): Promise<void> {
    this.sql.exec("UPDATE tasks SET visits = visits + 1 WHERE slug = ?", slug);
  }

  async getPopularTasks(limit: number): Promise<TaskRow[]> {
    const results = this.sql.exec(
      `
      SELECT * FROM tasks 
      WHERE status = 'done' AND error IS NULL
      ORDER BY visits DESC 
      LIMIT ?
    `,
      limit
    );
    return results.toArray() as TaskRow[];
  }

  async getRecentTasks(limit: number): Promise<TaskRow[]> {
    const results = this.sql.exec(
      `
      SELECT * FROM tasks 
      WHERE status = 'done' AND error IS NULL
      ORDER BY created_at DESC 
      LIMIT ?
    `,
      limit
    );
    return results.toArray() as TaskRow[];
  }
}
