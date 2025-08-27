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

    // Get the main task manager DO
    const taskManagerId = env.TASK_MANAGER.idFromName(MAIN_INSTANCE);
    const taskManager = env.TASK_MANAGER.get(taskManagerId);

    if (url.pathname === "/api/tasks" && request.method === "POST") {
      const taskData = (await request.json()) as CreateTaskRequest;
      return taskManager.createTask(taskData);
    }

    if (url.pathname === "/api/tasks" && request.method === "GET") {
      return taskManager.getTasks();
    }

    if (url.pathname.startsWith("/task/")) {
      const taskId = url.pathname.split("/")[2];
      return taskManager.getTaskDetails(taskId);
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
      SELECT id, processor, status, created_at, completed_at, 
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
    }));

    return new Response(JSON.stringify(tasks), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async getTaskDetails(taskId: string): Promise<Response> {
    // Get task info
    const taskResult = this.sql.exec(
      `SELECT * FROM tasks WHERE id = ?`,
      taskId
    );
    const taskRows = taskResult.toArray();

    if (taskRows.length === 0) {
      return new Response("Task not found", { status: 404 });
    }

    const task = taskRows[0] as TaskRecord;

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
    taskManager: TaskManager
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
    taskManager: TaskManager
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
    taskManager: TaskManager
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
    taskManager: TaskManager
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
    taskManager: TaskManager
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
    taskManager: TaskManager
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

                if (eventData.type === "status") {
                  if (this.isTerminalStatus(eventData.status)) {
                    return { completed: true, status: eventData.status };
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

  private async getTaskManager(): Promise<TaskManager> {
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
    taskManager: TaskManager
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
