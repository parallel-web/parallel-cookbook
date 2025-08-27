/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />

export interface Env {
  PARALLEL_API_KEY: string;
  PARALLEL_WEBHOOK_SECRET: string;
  DAILY_INSIGHTS: KVNamespace;
  ASSETS: Fetcher;
}

interface Task {
  slug: string;
  name: string;
  description: string;
  processor: string;
  task_spec: any;
  input: string;
}

interface TasksConfig {
  tasks: Task[];
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Ensure required env keys are present
    if (!env.PARALLEL_API_KEY || !env.PARALLEL_WEBHOOK_SECRET) {
      return new Response("Missing required environment variables", {
        status: 500,
      });
    }

    const url = new URL(request.url);

    // Webhook endpoint for Parallel API callbacks
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    // Manual trigger endpoint
    if (url.pathname === "/run" && request.method === "GET") {
      const apiKey = url.searchParams.get("key");
      if (apiKey !== env.PARALLEL_API_KEY) {
        return new Response("Unauthorized", { status: 401 });
      }

      ctx.waitUntil(runDailyTasks(env));
      return new Response("Tasks started");
    }

    // Task feed pages
    const pathMatch = url.pathname.match(/^\/([a-z-]+)$/);
    if (pathMatch) {
      const slug = pathMatch[1];
      return serveTaskFeed(slug, env);
    }

    // Homepage
    if (url.pathname === "/") {
      return serveHomepage(env);
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    // Run daily at 3AM UTC
    ctx.waitUntil(runDailyTasks(env));
  },
} satisfies ExportedHandler<Env>;

async function runDailyTasks(env: Env) {
  try {
    const tasksResponse = await env.ASSETS.fetch("http://internal/tasks.json");
    const tasksConfig: TasksConfig = await tasksResponse.json();

    for (const task of tasksConfig.tasks) {
      try {
        await createTaskRun(task, env);
        // Add delay between tasks to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error creating task run for ${task.slug}:`, error);
      }
    }
  } catch (error) {
    console.error("Error running daily tasks:", error);
  }
}

async function createTaskRun(task: Task, env: Env) {
  const webhookUrl = `https://daily.p0web.com/webhook`;

  const response = await fetch("https://api.parallel.ai/v1/tasks/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.PARALLEL_API_KEY,
      "parallel-beta": "webhook-2025-08-12",
    },
    body: JSON.stringify({
      input: task.input,
      processor: task.processor,
      task_spec: task.task_spec,
      metadata: {
        task_slug: task.slug,
        created_date: new Date().toISOString().split("T")[0],
      },
      webhook: {
        url: webhookUrl,
        event_types: ["task_run.status"],
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create task run: ${error}`);
  }

  const result = await response.json();
  console.log(`Created task run ${result.run_id} for ${task.slug}`);
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  try {
    // Get webhook headers
    const webhookId = request.headers.get("webhook-id");
    const webhookTimestamp = request.headers.get("webhook-timestamp");
    const webhookSignature = request.headers.get("webhook-signature");

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      console.error("Missing webhook headers");
      return new Response("Missing webhook headers", { status: 400 });
    }

    const body = await request.text();

    // Verify signature using Standard Webhooks format
    const isValid = await verifyWebhookSignature(
      env.PARALLEL_WEBHOOK_SECRET,
      webhookId,
      webhookTimestamp,
      body,
      webhookSignature
    );

    if (!isValid) {
      console.error("Invalid webhook signature");
      return new Response("Invalid signature", { status: 400 });
    }

    const webhook = JSON.parse(body);
    console.log("Webhook received:", webhook.type, webhook.data?.status);

    // Handle task completion
    if (
      webhook.type === "task_run.status" &&
      webhook.data?.status === "completed"
    ) {
      const runId = webhook.data.run_id;
      const taskSlug = webhook.data.metadata?.task_slug;
      const createdDate = webhook.data.metadata?.created_date;

      console.log("Task run completed", { runId, taskSlug, createdDate });

      if (taskSlug && createdDate) {
        // Fetch the result
        const resultResponse = await fetch(
          `https://api.parallel.ai/v1/tasks/runs/${runId}/result`,
          {
            headers: {
              "x-api-key": env.PARALLEL_API_KEY,
            },
          }
        );

        if (resultResponse.ok) {
          const result = await resultResponse.json();

          // Store result in KV
          const key = `task:${taskSlug}:${createdDate}`;
          await env.DAILY_INSIGHTS.put(key, JSON.stringify(result));

          console.log(`Stored result for ${taskSlug} on ${createdDate}`);
        } else {
          console.error("Failed to fetch result:", {
            status: resultResponse.status,
            text: await resultResponse.text(),
          });
        }
      }
    }

    return new Response("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

async function verifyWebhookSignature(
  secret: string,
  webhookId: string,
  webhookTimestamp: string,
  body: string,
  signatureHeader: string
): Promise<boolean> {
  // Compute expected signature
  const payload = `${webhookId}.${webhookTimestamp}.${body}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  const expectedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  );

  // Check each signature in the header (space-delimited)
  const signatures = signatureHeader.split(" ");
  for (const sig of signatures) {
    if (sig.startsWith("v1,")) {
      const providedSignature = sig.substring(3); // Remove "v1," prefix
      if (providedSignature === expectedSignature) {
        return true;
      }
    }
  }

  return false;
}

async function serveHomepage(env: Env): Promise<Response> {
  try {
    const tasksResponse = await env.ASSETS.fetch("http://internal/tasks.json");
    const tasksConfig: TasksConfig = await tasksResponse.json();

    const htmlResponse = await env.ASSETS.fetch("http://internal/home.html");
    let html = await htmlResponse.text();

    // Inject tasks data
    html = html.replace(
      "</head>",
      `<script>window.tasks = ${JSON.stringify(
        tasksConfig.tasks
      )}</script></head>`
    );

    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  } catch (error) {
    console.error("Error loading homepage:", error);
    return new Response("Error loading homepage", { status: 500 });
  }
}

async function serveTaskFeed(slug: string, env: Env): Promise<Response> {
  try {
    // Get task configuration
    const tasksResponse = await env.ASSETS.fetch("http://internal/tasks.json");
    const tasksConfig: TasksConfig = await tasksResponse.json();
    const task = tasksConfig.tasks.find((t) => t.slug === slug);

    if (!task) {
      return new Response("Task not found", { status: 404 });
    }

    // Get last 10 results
    const results = [];
    const today = new Date();

    for (let i = 0; i < 10; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      const key = `task:${slug}:${dateStr}`;

      const result = await env.DAILY_INSIGHTS.get(key);
      if (result) {
        results.push({
          date: dateStr,
          data: JSON.parse(result),
        });
      }
    }

    const htmlResponse = await env.ASSETS.fetch("http://internal/feed.html");
    let html = await htmlResponse.text();

    // Inject data
    html = html.replace(
      "</head>",
      `<script>window.feedData = ${JSON.stringify({
        task,
        results,
      })}</script></head>`
    );

    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  } catch (error) {
    console.error("Error loading task feed:", error);
    return new Response("Error loading task feed", { status: 500 });
  }
}
