import type {
  ParallelPort,
  TaskRun,
  TaskRunResult,
} from "./parallel-port.js";
import type { TaskFailure, TaskRef } from "./state.js";

type TerminalStatus = "action_required" | "failed" | "cancelled";

class TerminalTaskError extends Error {
  constructor(
    readonly run: TaskRun,
    message: string,
  ) {
    super(message);
    this.name = "TerminalTaskError";
  }
}

export class InvalidTaskOutputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidTaskOutputError";
  }
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isTerminalStatus(status: TaskRun["status"]): status is TerminalStatus {
  return status === "action_required" || status === "failed" || status === "cancelled";
}

/** Own Task polling and turn only confirmed terminal outcomes into durable failures. */
export class TaskRunner {
  constructor(
    private readonly options: {
      client: ParallelPort;
      pollSeconds: number;
      maxWaitMilliseconds: number;
      retryDelayMilliseconds: number;
      now: () => Date;
      sleep: (milliseconds: number) => Promise<void>;
      clock?: () => number;
    },
  ) {}

  async wait(runId: string): Promise<TaskRunResult> {
    const clock = this.options.clock ?? Date.now;
    const deadline = clock() + this.options.maxWaitMilliseconds;
    let lastError: unknown;

    while (clock() < deadline) {
      try {
        const result = await this.options.client.taskRun.result(
          runId,
          { timeout: this.options.pollSeconds },
          { maxRetries: 0 },
        );
        const terminal = this.terminalError(result.run);
        if (terminal) throw terminal;
        if (result.run.status === "completed") return result;
      } catch (error) {
        lastError = error;
        if (error instanceof TerminalTaskError) throw error;
        const terminal = await this.retrieveTerminal(runId);
        if (terminal) throw terminal;
        if (errorStatus(error) !== 408) throw error;
      }
      if (clock() < deadline) await this.options.sleep(this.options.retryDelayMilliseconds);
    }

    const terminal = await this.retrieveTerminal(runId);
    if (terminal) throw terminal;
    throw new Error(
      `Task ${runId} did not complete within ${this.options.maxWaitMilliseconds}ms.`,
      { cause: lastError },
    );
  }

  failure(error: unknown, run: TaskRef): TaskFailure | undefined {
    const failedAt = this.options.now().toISOString();
    if (error instanceof TerminalTaskError) {
      return {
        kind: "remote_terminal",
        run: {
          ...run,
          interactionId: error.run.interaction_id || run.interactionId,
        },
        status: error.run.status as TerminalStatus,
        message: error.message,
        ...(error.run.error?.ref_id ? { refId: error.run.error.ref_id } : {}),
        failedAt,
      };
    }
    if (error instanceof InvalidTaskOutputError) {
      return {
        kind: "invalid_output",
        run,
        status: "completed",
        message: error.message,
        failedAt,
      };
    }
    return undefined;
  }

  private async retrieveTerminal(runId: string): Promise<TerminalTaskError | undefined> {
    try {
      const run = await this.options.client.taskRun.retrieve(runId);
      return this.terminalError(run);
    } catch (error) {
      return error instanceof TerminalTaskError ? error : undefined;
    }
  }

  private terminalError(run: TaskRun): TerminalTaskError | undefined {
    if (!isTerminalStatus(run.status)) return undefined;
    return new TerminalTaskError(
      run,
      run.error?.message ?? `Task ${run.run_id} reached terminal status ${run.status}.`,
    );
  }
}
