import { DurableObject } from "cloudflare:workers";

export interface Env {
  TASK_MANAGER: DurableObjectNamespace<TaskManager>;
  TASK_RUNNER: DurableObjectNamespace<TaskRunner>;
}

export interface CreateTaskRequest {
  apiKey: string;
  processor: string;
  input: string;
  taskSpec?: Record<string, any>;
}

export interface TaskData extends CreateTaskRequest {
  taskSpec?: Record<string, any>;
}

export interface TaskRecord {
  id: string;
  api_key: string;
  processor: string;
  input: string;
  task_spec: string | null;
  run_id: string | null;
  status: TaskStatus;
  created_at: number;
  completed_at: number | null;
  result: string | null;
}

export interface TaskEvent {
  id: number;
  task_id: string;
  event_type: string;
  event_data: string;
  timestamp: number;
}

export type TaskStatus =
  | "pending"
  | "queued"
  | "action_required"
  | "running"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled";

export interface ParallelTaskRun {
  run_id: string;
  status: TaskStatus;
  is_active: boolean;
  warnings?: any[] | null;
  error?: {
    ref_id: string;
    message: string;
    detail?: any;
  } | null;
  processor: string;
  metadata?: Record<string, string | number | boolean> | null;
  taskgroup_id?: string | null;
  created_at?: string | null;
  modified_at?: string | null;
}

export interface ParallelTaskResult {
  run: ParallelTaskRun;
  output: {
    type: "json" | "text";
    content: any;
    basis?: any[];
    mcp_tool_calls?: any[] | null;
  };
}

export interface TaskState {
  taskId: string;
  taskData: TaskData;
  phase: "initializing" | "monitoring" | "streaming" | "completed";
  attempts: number;
  lastActivity: number;
  runId?: string;
  streamAttempts?: number;
  finalStatus?: { status: TaskStatus };
}

export interface StreamResult {
  completed: boolean;
  status?: TaskStatus;
}

const MAIN_INSTANCE = "main-v3";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/tasks-sse") {
      return new Response(null, {
        status: 302,
        headers: { Location: "/tasks-sse/" },
      });
    }
    const pathname = "/" + url.pathname.split("/").slice(2).join("/");

    // Get the main task manager DO
    const taskManagerId = env.TASK_MANAGER.idFromName(MAIN_INSTANCE);
    const taskManager = env.TASK_MANAGER.get(taskManagerId);

    if (pathname === "/api/tasks" && request.method === "POST") {
      const taskData = (await request.json()) as CreateTaskRequest;
      return taskManager.createTask(taskData);
    }

    if (pathname === "/api/tasks" && request.method === "GET") {
      return taskManager.getTasks();
    }

    // Handle both JSON and HTML routes for tasks
    if (pathname.startsWith("/task/")) {
      const pathParts = pathname.split("/");
      const taskId = pathParts[2];

      if (pathParts.length === 3) {
        // Default to HTML view
        return taskManager.getTaskDetailsHtml(taskId);
      } else if (pathParts[3] === "json") {
        // JSON endpoint
        return taskManager.getTaskDetailsJson(taskId);
      } else if (pathParts[3] === "html") {
        // Explicit HTML endpoint
        return taskManager.getTaskDetailsHtml(taskId);
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

export class TaskManager extends DurableObject {
  private sql: SqlStorage;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.env = env;

    // Initialize tables
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        processor TEXT NOT NULL,
        input TEXT NOT NULL,
        task_spec TEXT,
        run_id TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        result TEXT
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks (id)
      )
    `);
  }

  async createTask(taskData: CreateTaskRequest): Promise<Response> {
    const taskId = crypto.randomUUID();
    const now = Date.now();

    console.log({ taskData });

    // Store task in database FIRST
    this.sql.exec(
      `INSERT INTO tasks (id, api_key, processor, input, task_spec, created_at) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      taskId,
      taskData.apiKey,
      taskData.processor,
      taskData.input,
      taskData.taskSpec ? JSON.stringify(taskData.taskSpec) : null,
      now
    );

    // Add initial event after task is stored
    await this.addEvent(taskId, "task_created", {
      processor: taskData.processor,
      input_length: taskData.input.length,
    });

    // Create a task runner DO for this specific task
    const taskRunnerId = this.env.TASK_RUNNER.idFromName(taskId);
    const taskRunner = this.env.TASK_RUNNER.get(taskRunnerId);

    // Start the task runner (fire and forget)
    // Wait for the task runner to be created to ensure proper sequencing
    await taskRunner.runTask(taskId, taskData);

    return new Response(JSON.stringify({ taskId, status: "started" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async getTasks(): Promise<Response> {
    const result = this.sql.exec(`
      SELECT id, processor, status, created_at, completed_at, run_id,
             substr(input, 1, 100) as input_preview
      FROM tasks 
      ORDER BY created_at DESC
    `);

    const tasks = result.toArray().map((row: any) => ({
      id: row.id,
      processor: row.processor,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      completedAt: row.completed_at
        ? new Date(row.completed_at).toISOString()
        : null,
      inputPreview: row.input_preview,
      runId: row.run_id,
    }));

    return new Response(JSON.stringify(tasks), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async getTaskDetailsJson(taskId: string): Promise<Response> {
    // Get task info
    const taskResult = this.sql.exec(
      `SELECT * FROM tasks WHERE id = ?`,
      taskId
    );
    const taskRows = taskResult.toArray();

    if (taskRows.length === 0) {
      return new Response("Task not found", { status: 404 });
    }

    const task = taskRows[0] as unknown as TaskRecord;

    // Get all events for this task
    const eventsResult = this.sql.exec(
      `SELECT event_type, event_data, timestamp 
       FROM task_events 
       WHERE task_id = ? 
       ORDER BY timestamp ASC`,
      taskId
    );

    const events = eventsResult.toArray().map((row: any) => ({
      type: row.event_type,
      data: JSON.parse(row.event_data),
      timestamp: new Date(row.timestamp).toISOString(),
    }));

    const response = {
      task: {
        id: task.id,
        processor: task.processor,
        input: task.input,
        taskSpec: task.task_spec ? JSON.parse(task.task_spec) : null,
        runId: task.run_id,
        status: task.status,
        createdAt: new Date(task.created_at).toISOString(),
        completedAt: task.completed_at
          ? new Date(task.completed_at).toISOString()
          : null,
        result: task.result ? JSON.parse(task.result) : null,
      },
      events,
    };

    return new Response(JSON.stringify(response, null, 2), {
      headers: { "Content-Type": "application/json;charset=utf8" },
    });
  }

  async getTaskDetailsHtml(taskId: string): Promise<Response> {
    // Get task info
    const taskResult = this.sql.exec(
      `SELECT * FROM tasks WHERE id = ?`,
      taskId
    );
    const taskRows = taskResult.toArray();

    if (taskRows.length === 0) {
      return new Response("Task not found", { status: 404 });
    }

    const task = taskRows[0] as unknown as TaskRecord;

    // Get all events for this task
    const eventsResult = this.sql.exec(
      `SELECT event_type, event_data, timestamp 
       FROM task_events 
       WHERE task_id = ? 
       ORDER BY timestamp ASC`,
      taskId
    );

    const events = eventsResult.toArray().map((row: any) => ({
      type: row.event_type,
      data: JSON.parse(row.event_data),
      timestamp: new Date(row.timestamp).toISOString(),
    }));

    const taskData = {
      id: task.id,
      processor: task.processor,
      input: task.input,
      taskSpec: task.task_spec ? JSON.parse(task.task_spec) : null,
      runId: task.run_id,
      status: task.status,
      createdAt: new Date(task.created_at).toISOString(),
      completedAt: task.completed_at
        ? new Date(task.completed_at).toISOString()
        : null,
      result: task.result ? JSON.parse(task.result) : null,
    };

    const html = this.generateTaskHtml(taskData, events);

    return new Response(html, {
      headers: { "Content-Type": "text/html;charset=utf8" },
    });
  }

  private generateTaskHtml(task: any, events: any[]): string {
    const statusColor = this.getStatusColor(task.status);

    // Group events by type for better display
    const sseEvents = events.filter((e) => e.type === "sse_event");
    const otherEvents = events.filter((e) => e.type !== "sse_event");

    // Extract different types of SSE events
    const statusEvents = sseEvents.filter(
      (e) => e.data.type === "task_run.state"
    );
    const messageEvents = sseEvents.filter((e) =>
      e.data.type?.startsWith("task_run.progress_msg")
    );
    const statsEvents = sseEvents.filter(
      (e) => e.data.type === "task_run.progress_stats"
    );

    return `
<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Task Details - ${task.id}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        'off-white': '#fcfcfa',
                        'index-black': '#1d1b16',
                        'neural': '#d8d0bf',
                        'signal': '#fb631b',
                    },
                    fontFamily: {
                        'ft-mono': ['FT System Mono', 'Monaco', 'Menlo', 'monospace'],
                        'gerstner': ['Gerstner Programm', 'system-ui', 'sans-serif'],
                    }
                }
            }
        }
    </script>
    <style>
        @font-face {
            font-family: 'FT System Mono';
            src: url('https://assets.p0web.com/FTSystemMono-Regular.woff2') format('woff2'),
                 url('https://assets.p0web.com/FTSystemMono-Regular.woff') format('woff');
            font-weight: 400;
            font-display: swap;
        }

        @font-face {
            font-family: 'FT System Mono';
            src: url('https://assets.p0web.com/FTSystemMono-Medium.woff2') format('woff2'),
                 url('https://assets.p0web.com/FTSystemMono-Medium.woff') format('woff');
            font-weight: 500;
            font-display: swap;
        }

        @font-face {
            font-family: 'FT System Mono';
            src: url('https://assets.p0web.com/FTSystemMono-Bold.woff2') format('woff2'),
                 url('https://assets.p0web.com/FTSystemMono-Bold.woff') format('woff');
            font-weight: 700;
            font-display: swap;
        }

        @font-face {
            font-family: 'Gerstner Programm';
            src: url('https://assets.p0web.com/Gerstner-ProgrammRegular.woff2') format('woff2'),
                 url('https://assets.p0web.com/Gerstner-ProgrammRegular.woff') format('woff');
            font-weight: 400;
            font-display: swap;
        }

        @font-face {
            font-family: 'Gerstner Programm';
            src: url('https://assets.p0web.com/Gerstner-ProgrammMedium.woff2') format('woff2'),
                 url('https://assets.p0web.com/Gerstner-ProgrammMedium.woff') format('woff');
            font-weight: 500;
            font-display: swap;
        }

        .copy-button:hover {
            background-color: rgba(251, 99, 27, 0.1);
        }
        
        .event-message {
            background: linear-gradient(90deg, rgba(251, 99, 27, 0.05) 0%, transparent 100%);
            border-left: 3px solid #fb631b;
        }

        @media (prefers-color-scheme: dark) {
            html {
                color-scheme: dark;
            }
        }
    </style>
</head>
<body class="bg-off-white dark:bg-index-black text-index-black dark:text-off-white font-gerstner h-full">
    <script>
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark');
        }
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (e.matches) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
        });
    </script>

    <div class="min-h-full">
        <!-- Header -->
        <header class="border-b border-neural dark:border-gray-700">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-4">
                        <a href="/tasks-sse/" class="font-ft-mono text-xl font-bold text-signal hover:opacity-80 transition-opacity">
                            ← back to tasks
                        </a>
                        <div class="h-6 border-l border-neural dark:border-gray-600"></div>
                        <h1 class="font-ft-mono text-xl font-medium">Task Details</h1>
                    </div>
                    <div class="flex items-center gap-4">
                        <a href="/tasks-sse/task/${
                          task.id
                        }/json" target="_blank" 
                           class="text-signal hover:opacity-80 font-ft-mono text-sm flex items-center gap-1">
                            Raw JSON
                            <span class="text-xs opacity-70">↗</span>
                        </a>
                        <img src="https://assets.p0web.com/dark-parallel-logo-270.png" alt="Parallel" class="h-6 dark:hidden">
                        <img src="https://assets.p0web.com/white-parallel-logo-270.png" alt="Parallel" class="h-6 hidden dark:block">
                    </div>
                </div>
            </div>
        </header>

        <!-- Main Content -->
        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <!-- Task Info -->
            <div class="bg-neural/10 dark:bg-gray-800/30 rounded-lg border border-neural/30 dark:border-gray-700 p-6 mb-8">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h3 class="font-ft-mono font-medium text-sm mb-3 text-gray-600 dark:text-gray-400 uppercase tracking-wider">Task ID</h3>
                        <div class="flex items-center gap-2">
                            <span class="font-ft-mono text-sm">${task.id}</span>
                            <button onclick="copyToClipboard('${task.id}')" 
                                    class="copy-button p-1 rounded text-gray-500 hover:text-signal transition-colors" 
                                    title="Copy task ID">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                    
                    ${
                      task.runId
                        ? `
                    <div>
                        <h3 class="font-ft-mono font-medium text-sm mb-3 text-gray-600 dark:text-gray-400 uppercase tracking-wider">Run ID</h3>
                        <div class="flex items-center gap-2">
                            <span class="font-ft-mono text-sm">${task.runId}</span>
                            <button onclick="copyToClipboard('${task.runId}')" 
                                    class="copy-button p-1 rounded text-gray-500 hover:text-signal transition-colors" 
                                    title="Copy run ID">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                    `
                        : ""
                    }
                    
                    <div>
                        <h3 class="font-ft-mono font-medium text-sm mb-3 text-gray-600 dark:text-gray-400 uppercase tracking-wider">Status</h3>
                        <span class="inline-flex px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wider font-ft-mono ${statusColor}">
                            ${task.status}
                        </span>
                    </div>
                    
                    <div>
                        <h3 class="font-ft-mono font-medium text-sm mb-3 text-gray-600 dark:text-gray-400 uppercase tracking-wider">Processor</h3>
                        <span class="font-ft-mono text-sm">${
                          task.processor
                        }</span>
                    </div>
                    
                    <div class="md:col-span-2">
                        <h3 class="font-ft-mono font-medium text-sm mb-3 text-gray-600 dark:text-gray-400 uppercase tracking-wider">Input</h3>
                        <div class="bg-neural/20 dark:bg-gray-700/50 rounded-lg p-4 font-ft-mono text-sm whitespace-pre-wrap break-words">
                            ${this.escapeHtml(task.input)}
                        </div>
                    </div>
                </div>
            </div>

            <!-- Live Events Section -->
            ${
              sseEvents.length > 0
                ? `
            <div class="mb-8">
                <h2 class="font-ft-mono text-lg font-medium mb-6">Live Stream Events</h2>
                
                <!-- Message Events -->
                ${
                  messageEvents.length > 0
                    ? `
                <div class="mb-6">
                    <h3 class="font-ft-mono font-medium text-sm mb-4 text-gray-600 dark:text-gray-400 uppercase tracking-wider">Progress Messages</h3>
                    <div class="space-y-3">
                        ${messageEvents
                          .map(
                            (event) => `
                            <div class="event-message p-4 rounded-lg">
                                <div class="flex items-start justify-between mb-2">
                                    <span class="font-ft-mono text-xs text-signal uppercase tracking-wider">
                                        ${event.data.type.replace(
                                          "task_run.progress_msg.",
                                          ""
                                        )}
                                    </span>
                                    <span class="font-ft-mono text-xs text-gray-500 dark:text-gray-400">
                                        ${new Date(
                                          event.data.timestamp ||
                                            event.timestamp
                                        ).toLocaleString()}
                                    </span>
                                </div>
                                <div class="font-gerstner text-sm leading-relaxed">
                                    ${this.escapeHtml(event.data.message)}
                                </div>
                            </div>
                        `
                          )
                          .join("")}
                    </div>
                </div>
                `
                    : ""
                }

                <!-- Status Events -->
                ${
                  statusEvents.length > 0
                    ? `
                <div class="mb-6">
                    <h3 class="font-ft-mono font-medium text-sm mb-4 text-gray-600 dark:text-gray-400 uppercase tracking-wider">Status Updates</h3>
                    <div class="space-y-2">
                        ${statusEvents
                          .map(
                            (event) => `
                            <div class="flex items-center justify-between p-3 bg-neural/10 dark:bg-gray-800/30 rounded border border-neural/30 dark:border-gray-700">
                                <div class="flex items-center gap-3">
                                    <span class="inline-flex px-2 py-1 rounded-full text-xs font-medium uppercase tracking-wider font-ft-mono ${this.getStatusColor(
                                      event.data.run.status
                                    )}">
                                        ${event.data.run.status}
                                    </span>
                                    ${
                                      event.data.run.is_active
                                        ? '<span class="text-signal text-xs font-ft-mono">● ACTIVE</span>'
                                        : ""
                                    }
                                </div>
                                <span class="font-ft-mono text-xs text-gray-500 dark:text-gray-400">
                                    ${new Date(
                                      event.timestamp
                                    ).toLocaleString()}
                                </span>
                            </div>
                        `
                          )
                          .join("")}
                    </div>
                </div>
                `
                    : ""
                }

                <!-- Stats Events -->
                ${
                  statsEvents.length > 0
                    ? `
                <div class="mb-6">
                    <h3 class="font-ft-mono font-medium text-sm mb-4 text-gray-600 dark:text-gray-400 uppercase tracking-wider">Source Statistics</h3>
                    <div class="space-y-3">
                        ${statsEvents
                          .map(
                            (event) => `
                            <div class="p-4 bg-neural/10 dark:bg-gray-800/30 rounded border border-neural/30 dark:border-gray-700">
                                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
                                    <div class="text-center">
                                        <div class="font-ft-mono text-xl font-bold text-signal">${
                                          event.data.source_stats
                                            .num_sources_considered || 0
                                        }</div>
                                        <div class="font-ft-mono text-xs text-gray-600 dark:text-gray-400 uppercase">Sources Considered</div>
                                    </div>
                                    <div class="text-center">
                                        <div class="font-ft-mono text-xl font-bold text-signal">${
                                          event.data.source_stats
                                            .num_sources_read || 0
                                        }</div>
                                        <div class="font-ft-mono text-xs text-gray-600 dark:text-gray-400 uppercase">Sources Read</div>
                                    </div>
                                    <div class="text-center">
                                        <div class="font-ft-mono text-xl font-bold text-signal">${
                                          (
                                            event.data.source_stats
                                              .sources_read_sample || []
                                          ).length
                                        }</div>
                                        <div class="font-ft-mono text-xs text-gray-600 dark:text-gray-400 uppercase">Sample URLs</div>
                                    </div>
                                </div>
                                ${
                                  event.data.source_stats.sources_read_sample &&
                                  event.data.source_stats.sources_read_sample
                                    .length > 0
                                    ? `
                                <details class="mt-3">
                                    <summary class="font-ft-mono text-xs text-signal cursor-pointer hover:opacity-80">View Source URLs Sample</summary>
                                    <div class="mt-2 space-y-1">
                                        ${event.data.source_stats.sources_read_sample
                                          .map(
                                            (url) => `
                                            <div class="font-ft-mono text-xs text-gray-600 dark:text-gray-400 break-all pl-4">
                                                <a href="${url}" target="_blank" class="hover:text-signal transition-colors">${url}</a>
                                            </div>
                                        `
                                          )
                                          .join("")}
                                    </div>
                                </details>
                                `
                                    : ""
                                }
                                <div class="text-right mt-2">
                                    <span class="font-ft-mono text-xs text-gray-500 dark:text-gray-400">
                                        ${new Date(
                                          event.timestamp
                                        ).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        `
                          )
                          .join("")}
                    </div>
                </div>
                `
                    : ""
                }
            </div>
            `
                : ""
            }

            <!-- Task Result -->
            ${
              task.result
                ? `
            <div class="mb-8">
                <h2 class="font-ft-mono text-lg font-medium mb-6">Result</h2>
                <div class="bg-neural/10 dark:bg-gray-800/30 rounded-lg border border-neural/30 dark:border-gray-700 p-6">
                    ${
                      task.result.output.type === "text"
                        ? `
                        <div class="font-gerstner leading-relaxed whitespace-pre-wrap">
                            ${this.escapeHtml(task.result.output.content)}
                        </div>
                    `
                        : `
                        <pre class="font-ft-mono text-sm overflow-x-auto whitespace-pre-wrap break-words">${this.escapeHtml(
                          JSON.stringify(task.result.output.content, null, 2)
                        )}</pre>
                    `
                    }
                </div>
            </div>
            `
                : ""
            }

            <!-- All Events Debug -->
            ${
              otherEvents.length > 0
                ? `
            <div class="mb-8">
                <h2 class="font-ft-mono text-lg font-medium mb-6">System Events</h2>
                <div class="space-y-3">
                    ${otherEvents
                      .map(
                        (event) => `
                        <div class="bg-neural/10 dark:bg-gray-800/30 rounded border border-neural/30 dark:border-gray-700 p-4">
                            <div class="flex items-center justify-between mb-2">
                                <span class="font-ft-mono text-sm font-medium text-signal">${
                                  event.type
                                }</span>
                                <span class="font-ft-mono text-xs text-gray-500 dark:text-gray-400">
                                    ${new Date(
                                      event.timestamp
                                    ).toLocaleString()}
                                </span>
                            </div>
                            <pre class="font-ft-mono text-xs text-gray-600 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap">${this.escapeHtml(
                              JSON.stringify(event.data, null, 2)
                            )}</pre>
                        </div>
                    `
                      )
                      .join("")}
                </div>
            </div>
            `
                : ""
            }
        </main>
    </div>

    <script>
        async function copyToClipboard(text) {
            try {
                await navigator.clipboard.writeText(text);
                // Show a brief success indication
                const button = event.target.closest('button');
                const originalHTML = button.innerHTML;
                button.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
                button.classList.add('text-green-500');
                setTimeout(() => {
                    button.innerHTML = originalHTML;
                    button.classList.remove('text-green-500');
                }, 1000);
            } catch (err) {
                console.error('Failed to copy: ', err);
            }
        }
    </script>
</body>
</html>`;
  }

  private getStatusColor(status: string): string {
    switch (status) {
      case "pending":
      case "queued":
        return "bg-yellow-900/50 text-yellow-400";
      case "running":
        return "bg-blue-900/50 text-blue-400";
      case "completed":
        return "bg-green-900/50 text-green-400";
      case "failed":
        return "bg-red-900/50 text-red-400";
      case "cancelled":
      case "cancelling":
        return "bg-gray-900/50 text-gray-400";
      default:
        return "bg-gray-900/50 text-gray-400";
    }
  }

  private escapeHtml(text: string): string {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  async addEvent(
    taskId: string,
    eventType: string,
    eventData: any
  ): Promise<void> {
    // Check if task exists before adding event
    const taskResult = this.sql.exec(
      `SELECT id FROM tasks WHERE id = ?`,
      taskId
    );

    if (taskResult.toArray().length === 0) {
      console.error(`Attempted to add event to non-existent task: ${taskId}`);
      return; // Silently fail rather than throwing
    }

    this.sql.exec(
      `INSERT INTO task_events (task_id, event_type, event_data, timestamp) 
       VALUES (?, ?, ?, ?)`,
      taskId,
      eventType,
      JSON.stringify(eventData),
      Date.now()
    );
  }

  async updateTaskRunId(taskId: string, runId: string): Promise<void> {
    this.sql.exec(`UPDATE tasks SET run_id = ? WHERE id = ?`, runId, taskId);
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    result: any = null
  ): Promise<void> {
    const completedAt =
      status === "completed" || status === "failed" ? Date.now() : null;
    this.sql.exec(
      `UPDATE tasks SET status = ?, completed_at = ?, result = ? WHERE id = ?`,
      status,
      completedAt,
      result ? JSON.stringify(result) : null,
      taskId
    );
  }
}

export class TaskRunner extends DurableObject {
  env: Env;
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.env = env;
    this.state = state;
  }

  async runTask(taskId: string, taskData: TaskData): Promise<void> {
    // Store task data immediately for recovery
    await this.state.storage.put("taskState", {
      taskId,
      taskData,
      phase: "initializing",
      attempts: 0,
      lastActivity: Date.now(),
    } as TaskState);

    // Schedule initial processing
    await this.scheduleProcessing();
  }

  async alarm(): Promise<void> {
    const taskState = await this.state.storage.get<TaskState>("taskState");
    if (!taskState) return;

    try {
      await this.processTask(taskState);
    } catch (error) {
      console.error("Error in alarm handler:", error);
      await this.handleError(taskState, error as Error);
    }
  }

  private async processTask(taskState: TaskState): Promise<void> {
    const taskManager = await this.getTaskManager();

    switch (taskState.phase) {
      case "initializing":
        await this.initializeTask(taskState, taskManager);
        break;
      case "monitoring":
        await this.monitorTask(taskState, taskManager);
        break;
      case "streaming":
        await this.handleStream(taskState, taskManager);
        break;
      case "completed":
        await this.finalizeTask(taskState, taskManager);
        break;
    }
  }

  private async initializeTask(
    taskState: TaskState,
    taskManager: DurableObjectStub<TaskManager>
  ): Promise<void> {
    // Exponential backoff for retries
    if (taskState.attempts > 0) {
      const delay = Math.min(1000 * Math.pow(2, taskState.attempts - 1), 30000);
      if (Date.now() - taskState.lastActivity < delay) {
        await this.scheduleProcessing(
          delay - (Date.now() - taskState.lastActivity)
        );
        return;
      }
    }

    try {
      const runId = await this.createOrRecoverRun(taskState, taskManager);
      if (runId) {
        await this.updateTaskState({
          ...taskState,
          runId,
          phase: "monitoring",
          attempts: 0,
          lastActivity: Date.now(),
        });
      } else {
        throw new Error("Failed to create task run");
      }
    } catch (error) {
      await this.handleRetryableError(taskState, error as Error);
    }

    await this.scheduleProcessing();
  }

  private async monitorTask(
    taskState: TaskState,
    taskManager: DurableObjectStub<TaskManager>
  ): Promise<void> {
    const { taskId, runId, taskData } = taskState;

    if (!runId) {
      throw new Error("No run ID available for monitoring");
    }

    try {
      const status = await this.checkTaskStatus(runId, taskData.apiKey);

      if (!status) {
        throw new Error("Failed to check task status");
      }

      await taskManager.updateTaskStatus(taskId, status.status);

      if (this.isTerminalStatus(status.status)) {
        await this.updateTaskState({
          ...taskState,
          phase: "completed",
          finalStatus: status,
          lastActivity: Date.now(),
        });
      } else if (
        status.status === "running" ||
        status.status === "cancelling"
      ) {
        await this.updateTaskState({
          ...taskState,
          phase: "streaming",
          streamAttempts: 0,
          lastActivity: Date.now(),
        });
      }
    } catch (error) {
      await this.handleRetryableError(taskState, error as Error);
    }

    await this.scheduleProcessing();
  }

  private async handleStream(
    taskState: TaskState,
    taskManager: DurableObjectStub<TaskManager>
  ): Promise<void> {
    const { taskId, runId, taskData } = taskState;
    const maxStreamAttempts = 5;

    if (!runId) {
      throw new Error("No run ID available for streaming");
    }

    if ((taskState.streamAttempts || 0) >= maxStreamAttempts) {
      // Fall back to polling after too many stream failures
      await this.updateTaskState({
        ...taskState,
        phase: "monitoring",
        lastActivity: Date.now(),
      });
      await this.scheduleProcessing(10000); // Poll every 10 seconds
      return;
    }

    try {
      const streamResult = await this.processEventStream(
        taskId,
        runId,
        taskData.apiKey,
        taskManager
      );

      if (streamResult.completed) {
        await this.updateTaskState({
          ...taskState,
          phase: "completed",
          finalStatus: { status: streamResult.status! },
          lastActivity: Date.now(),
        });
      } else {
        // Stream disconnected, back to monitoring
        await this.updateTaskState({
          ...taskState,
          phase: "monitoring",
          streamAttempts: (taskState.streamAttempts || 0) + 1,
          lastActivity: Date.now(),
        });
      }
    } catch (error) {
      await this.updateTaskState({
        ...taskState,
        streamAttempts: (taskState.streamAttempts || 0) + 1,
        lastActivity: Date.now(),
      });
      await taskManager.addEvent(taskId, "stream_error", {
        message: (error as Error).message,
        attempt: taskState.streamAttempts || 0,
      });
    }

    await this.scheduleProcessing();
  }

  private async finalizeTask(
    taskState: TaskState,
    taskManager: DurableObjectStub<TaskManager>
  ): Promise<void> {
    const { taskId, runId, taskData, finalStatus } = taskState;

    if (!runId) {
      throw new Error("No run ID available for finalization");
    }

    if (finalStatus?.status === "completed") {
      await this.fetchAndStoreResult(
        taskId,
        runId,
        taskData.apiKey,
        taskManager
      );
    }

    // Clean up
    await this.state.storage.delete("taskState");
  }

  private async createOrRecoverRun(
    taskState: TaskState,
    taskManager: DurableObjectStub<TaskManager>
  ): Promise<string | null> {
    const { taskId, taskData } = taskState;

    // Check if we already have a runId from previous attempt
    if (taskState.runId) {
      // Verify the run still exists
      try {
        const status = await this.checkTaskStatus(
          taskState.runId,
          taskData.apiKey
        );
        if (status) {
          return taskState.runId; // Run exists, continue with it
        }
      } catch (error) {
        // Run doesn't exist or API error, create new one
      }
    }

    // Create new run
    const createPayload: any = {
      input: taskData.input,
      processor: taskData.processor,
      enable_events: true,
    };

    if (taskData.taskSpec) {
      createPayload.task_spec = taskData.taskSpec;
    }

    const response = await fetch("https://api.parallel.ai/v1/tasks/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": taskData.apiKey,
        "parallel-beta": "events-sse-2025-07-24",
      },
      body: JSON.stringify(createPayload),
    });

    if (!response.ok) {
      throw new Error(`Failed to create task: ${await response.text()}`);
    }

    const taskRun = (await response.json()) as { run_id: string };
    await taskManager.updateTaskRunId(taskId, taskRun.run_id);
    await taskManager.addEvent(taskId, "parallel_task_created", taskRun);

    return taskRun.run_id;
  }

  private async processEventStream(
    taskId: string,
    runId: string,
    apiKey: string,
    taskManager: DurableObjectStub<TaskManager>
  ): Promise<StreamResult> {
    const streamTimeout = 570000; // 570 seconds
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), streamTimeout);

    try {
      const response = await fetch(
        `https://api.parallel.ai/v1beta/tasks/runs/${runId}/events`,
        {
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "text/event-stream",
          },
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`Stream connection failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No readable stream");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const eventData = JSON.parse(line.slice(6));
                await taskManager.addEvent(taskId, "sse_event", eventData);

                if (eventData.type === "task_run.state") {
                  if (this.isTerminalStatus(eventData.run.status)) {
                    return { completed: true, status: eventData.run.status };
                  }
                }
              } catch (e) {
                await taskManager.addEvent(taskId, "parse_error", {
                  message: (e as Error).message,
                  line: line,
                });
              }
            }
          }
        }

        return { completed: false }; // Stream ended without terminal status
      } finally {
        reader.releaseLock();
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async checkTaskStatus(
    runId: string,
    apiKey: string
  ): Promise<ParallelTaskRun | null> {
    const response = await fetch(
      `https://api.parallel.ai/v1/tasks/runs/${runId}`,
      { headers: { "x-api-key": apiKey } }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Run doesn't exist
      }
      throw new Error(`Status check failed: ${response.status}`);
    }

    return (await response.json()) as ParallelTaskRun;
  }

  private async handleRetryableError(
    taskState: TaskState,
    error: Error
  ): Promise<void> {
    const maxAttempts = 10;
    const newAttempts = (taskState.attempts || 0) + 1;

    if (newAttempts >= maxAttempts) {
      const taskManager = await this.getTaskManager();
      await taskManager.updateTaskStatus(taskState.taskId, "failed");
      await taskManager.addEvent(taskState.taskId, "max_retries_exceeded", {
        error: error.message,
        attempts: newAttempts,
      });
      await this.state.storage.delete("taskState");
      return;
    }

    await this.updateTaskState({
      ...taskState,
      attempts: newAttempts,
      lastActivity: Date.now(),
    });

    // Schedule retry with exponential backoff
    const delay = Math.min(1000 * Math.pow(2, newAttempts - 1), 30000);
    await this.scheduleProcessing(delay);
  }

  private async handleError(taskState: TaskState, error: Error): Promise<void> {
    const taskManager = await this.getTaskManager();
    await taskManager.addEvent(taskState.taskId, "error", {
      message: error.message,
      stack: error.stack,
    });
    await this.handleRetryableError(taskState, error);
  }

  private async updateTaskState(newState: TaskState): Promise<void> {
    await this.state.storage.put("taskState", newState);
  }

  private async scheduleProcessing(delayMs: number = 1000): Promise<void> {
    const now = Date.now();
    await this.state.storage.setAlarm(now + delayMs);
  }

  private async getTaskManager(): Promise<DurableObjectStub<TaskManager>> {
    const taskManagerId = this.env.TASK_MANAGER.idFromName(MAIN_INSTANCE);
    return this.env.TASK_MANAGER.get(taskManagerId);
  }

  private isTerminalStatus(status: TaskStatus): boolean {
    return ["completed", "failed", "cancelled"].includes(status);
  }

  private async fetchAndStoreResult(
    taskId: string,
    runId: string,
    apiKey: string,
    taskManager: DurableObjectStub<TaskManager>
  ): Promise<void> {
    try {
      const response = await fetch(
        `https://api.parallel.ai/v1/tasks/runs/${runId}/result`,
        { headers: { "x-api-key": apiKey } }
      );

      if (response.ok) {
        const result = (await response.json()) as ParallelTaskResult;
        await taskManager.addEvent(taskId, "result", result);
        await taskManager.updateTaskStatus(taskId, "completed", result);
      } else {
        throw new Error(`Failed to fetch result: ${response.status}`);
      }
    } catch (error) {
      await taskManager.addEvent(taskId, "result_error", {
        message: (error as Error).message,
      });
      await taskManager.updateTaskStatus(taskId, "failed");
    }
  }
}
