"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface TaskEvent {
  type: string;
  timestamp?: string;
  message?: string;
  data?: Record<string, unknown>;
}

interface TaskRun {
  run_id: string;
  status: string;
  processor: string;
  input: string;
  createdAt: string;
}

interface StoredTask {
  taskRun: TaskRun;
  events: TaskEvent[];
  finalOutput: string | null;
  status: "running" | "completed" | "failed";
  error?: string;
}

const STORAGE_KEY = "parallel-tasks-demo";

const PROCESSORS = [
  { value: "lite", label: "Lite", description: "$5/1000 runs, fastest" },
  { value: "base", label: "Base", description: "$10/1000 runs, reliable" },
  { value: "core", label: "Core", description: "$25/1000 runs, thorough" },
  { value: "pro", label: "Pro", description: "$100/1000 runs, deep research" },
  { value: "ultra", label: "Ultra", description: "$300/1000 runs, comprehensive" },
];

// Helper to safely access localStorage
function getStoredTasks(): StoredTask[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore errors
  }
  return [];
}

function saveTasksToStorage(tasks: StoredTask[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // Ignore errors
  }
}

// Accordion component for collapsible sections
function Accordion({
  title,
  children,
  defaultOpen = false,
  badge,
  variant = "default",
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  variant?: "default" | "success" | "error";
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const variantStyles = {
    default: "border-zinc-200 dark:border-zinc-700",
    success: "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10",
    error: "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10",
  };

  const headerStyles = {
    default: "hover:bg-zinc-50 dark:hover:bg-zinc-800",
    success: "hover:bg-green-100/50 dark:hover:bg-green-900/20",
    error: "hover:bg-red-100/50 dark:hover:bg-red-900/20",
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${variantStyles[variant]}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-4 py-3 flex items-center justify-between text-left transition-colors ${headerStyles[variant]}`}
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
        </div>
        {badge}
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

export default function TasksDemo() {
  const [input, setInput] = useState("");
  const [processor, setProcessor] = useState("lite");
  const [tasks, setTasks] = useState<StoredTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const eventsContainerRef = useRef<HTMLDivElement>(null);
  const tasksRef = useRef<StoredTask[]>(tasks);

  // Keep tasksRef in sync
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Check status of a task via API
  const checkTaskStatus = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/tasks/${runId}/status`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to check status");
      }

      return data;
    } catch (err) {
      console.error("Error checking task status:", err);
      return null;
    }
  }, []);

  // Load tasks from localStorage on mount and check pending task statuses
  useEffect(() => {
    const storedTasks = getStoredTasks();
    if (storedTasks.length > 0) {
      setTasks(storedTasks);

      // Find any running tasks and check their status
      const runningTasks = storedTasks.filter((t) => t.status === "running");
      
      if (runningTasks.length > 0) {
        // Check status of all running tasks
        runningTasks.forEach(async (task) => {
          const statusData = await checkTaskStatus(task.taskRun.run_id);
          
          if (statusData) {
            if (statusData.status === "completed") {
              // Task completed while we were away
              const output = statusData.output
                ? typeof statusData.output === "string"
                  ? statusData.output
                  : typeof statusData.output.content === "string"
                    ? statusData.output.content
                    : JSON.stringify(statusData.output.content || statusData.output, null, 2)
                : null;

              setTasks((prev) =>
                prev.map((t) =>
                  t.taskRun.run_id === task.taskRun.run_id
                    ? { ...t, status: "completed" as const, finalOutput: output }
                    : t
                )
              );
            } else if (statusData.status === "failed") {
              // Task failed while we were away
              setTasks((prev) =>
                prev.map((t) =>
                  t.taskRun.run_id === task.taskRun.run_id
                    ? {
                        ...t,
                        status: "failed" as const,
                        error: statusData.error?.message || "Task failed",
                      }
                    : t
                )
              );
            } else if (statusData.status === "running" || statusData.status === "queued") {
              // Task still running, start SSE stream
              setActiveTaskId(task.taskRun.run_id);
              // We'll start the event stream after hydration
            }
          }
        });
      }
    }
    setIsHydrated(true);
  }, [checkTaskStatus]);

  // Save tasks to localStorage whenever they change (after hydration)
  useEffect(() => {
    if (isHydrated) {
      saveTasksToStorage(tasks);
    }
  }, [tasks, isHydrated]);

  // Auto-scroll events container
  useEffect(() => {
    if (eventsContainerRef.current) {
      eventsContainerRef.current.scrollTop = eventsContainerRef.current.scrollHeight;
    }
  }, [tasks, activeTaskId]);

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const updateTask = useCallback((runId: string, updates: Partial<StoredTask>) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.taskRun.run_id === runId ? { ...t, ...updates } : t
      )
    );
  }, []);

  const addEventToTask = useCallback((runId: string, event: TaskEvent) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.taskRun.run_id === runId
          ? { ...t, events: [...t.events, event] }
          : t
      )
    );
  }, []);

  const startEventStream = useCallback((runId: string) => {
    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`/api/tasks/${runId}/events`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Add event to task
        addEventToTask(runId, {
          type: data.type || "unknown",
          timestamp: new Date().toISOString(),
          message: data.message || data.progress_message,
          data,
        });

        // Check for completion
        if (data.type === "task_run.state" && data.status === "completed") {
          const output = data.output
            ? typeof data.output === "string"
              ? data.output
              : JSON.stringify(data.output, null, 2)
            : null;

          updateTask(runId, {
            status: "completed",
            finalOutput: output,
          });

          eventSource.close();
          eventSourceRef.current = null;
        }

        // Check for failure
        if (data.type === "task_run.state" && data.status === "failed") {
          updateTask(runId, {
            status: "failed",
            error: data.error?.message || "Task failed",
          });

          eventSource.close();
          eventSourceRef.current = null;
        }
      } catch {
        // Non-JSON event, ignore
      }
    };

    eventSource.onerror = () => {
      // SSE connection closed or errored
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [addEventToTask, updateTask]);

  // Resume SSE stream for active running task after hydration
  useEffect(() => {
    if (isHydrated && activeTaskId) {
      const activeTask = tasks.find((t) => t.taskRun.run_id === activeTaskId);
      if (activeTask?.status === "running" && !eventSourceRef.current) {
        startEventStream(activeTaskId);
      }
    }
  }, [isHydrated, activeTaskId, tasks, startEventStream]);

  const handleCreateTask = async () => {
    if (!input.trim()) return;

    setLoading(true);
    setError(null);

    // Close any existing event source
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: input.trim(),
          processor,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Task creation failed");
      }

      const newTask: StoredTask = {
        taskRun: {
          run_id: data.run_id,
          status: data.status,
          processor: processor,
          input: input.trim(),
          createdAt: new Date().toISOString(),
        },
        events: [],
        finalOutput: null,
        status: "running",
      };

      setTasks((prev) => [newTask, ...prev]);
      setActiveTaskId(data.run_id);
      setInput("");
      setLoading(false);

      // Start streaming events
      startEventStream(data.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setLoading(false);
    }
  };

  const deleteTask = (runId: string) => {
    if (activeTaskId === runId && eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setTasks((prev) => prev.filter((t) => t.taskRun.run_id !== runId));
    if (activeTaskId === runId) {
      setActiveTaskId(null);
    }
  };

  const clearAllTasks = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setTasks([]);
    setActiveTaskId(null);
  };

  const activeTask = tasks.find((t) => t.taskRun.run_id === activeTaskId);
  const isStreaming = activeTask?.status === "running" && eventSourceRef.current !== null;

  return (
    <div className="space-y-6">
      {/* Input Form */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label
              htmlFor="task-input"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Research Task
            </label>
            <a
              href="https://docs.parallel.ai/api-reference/tasks-v1/create-task-run"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-orange-600 dark:text-orange-400 hover:underline"
            >
              API Docs
            </a>
          </div>
          <textarea
            id="task-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your research task... (e.g., 'Research the top 5 AI companies and their latest product announcements')"
            className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
            rows={4}
            disabled={loading || isStreaming}
          />
        </div>

        <div>
          <label
            htmlFor="processor"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
          >
            Processor
          </label>
          <select
            id="processor"
            value={processor}
            onChange={(e) => setProcessor(e.target.value)}
            className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
            disabled={loading || isStreaming}
          >
            {PROCESSORS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} - {p.description}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleCreateTask}
          disabled={loading || isStreaming || !input.trim()}
          className="w-full py-3 px-4 bg-orange-600 hover:bg-orange-700 disabled:bg-zinc-400 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
        >
          {loading ? "Creating Task..." : isStreaming ? "Task Running..." : "Start Task"}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Tasks List */}
      {tasks.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Tasks ({tasks.length})
            </h3>
            <button
              onClick={clearAllTasks}
              className="text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              Clear All
            </button>
          </div>

          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.taskRun.run_id}
                className={`border rounded-lg overflow-hidden ${
                  task.status === "running"
                    ? "border-orange-300 dark:border-orange-700"
                    : task.status === "completed"
                    ? "border-green-300 dark:border-green-700"
                    : "border-red-300 dark:border-red-700"
                }`}
              >
                {/* Task Header */}
                <div className="p-4 bg-white dark:bg-zinc-800">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-900 dark:text-zinc-100 line-clamp-2">
                        {task.taskRun.input}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <span className="font-mono">{task.taskRun.run_id.slice(0, 8)}...</span>
                        <span>{task.taskRun.processor}</span>
                        <span>{new Date(task.taskRun.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {task.status === "running" && (
                        <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded">
                          <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
                          Running
                        </span>
                      )}
                      {task.status === "completed" && (
                        <span className="px-2 py-1 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                          Completed
                        </span>
                      )}
                      {task.status === "failed" && (
                        <span className="px-2 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded">
                          Failed
                        </span>
                      )}
                      <button
                        onClick={() => deleteTask(task.taskRun.run_id)}
                        className="p-1 text-zinc-400 hover:text-red-500 transition-colors"
                        title="Delete task"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Accordions for Events and Output */}
                <div className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-3 space-y-2">
                  {/* Events Accordion */}
                  {task.events.length > 0 && (
                    <Accordion
                      title="Events"
                      badge={
                        <span className="px-2 py-0.5 text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded">
                          {task.events.length}
                        </span>
                      }
                      defaultOpen={task.status === "running"}
                    >
                      <div
                        ref={task.taskRun.run_id === activeTaskId ? eventsContainerRef : undefined}
                        className="max-h-48 overflow-y-auto space-y-2 mt-2"
                      >
                        {task.events.map((event, index) => (
                          <div
                            key={index}
                            className="text-sm p-2 bg-white dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="px-1.5 py-0.5 text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded">
                                {event.type}
                              </span>
                              {event.timestamp && (
                                <span className="text-xs text-zinc-400">
                                  {new Date(event.timestamp).toLocaleTimeString()}
                                </span>
                              )}
                            </div>
                            {event.message && (
                              <p className="text-zinc-600 dark:text-zinc-300">{event.message}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </Accordion>
                  )}

                  {/* Output Accordion */}
                  {task.finalOutput && (
                    <Accordion
                      title="Output"
                      variant="success"
                      defaultOpen={true}
                      badge={
                        <span className="px-2 py-0.5 text-xs bg-green-200 dark:bg-green-800 text-green-700 dark:text-green-300 rounded">
                          Ready
                        </span>
                      }
                    >
                      <div className="mt-2 max-h-96 overflow-y-auto">
                        <pre className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap bg-white dark:bg-zinc-800 p-3 rounded border border-green-200 dark:border-green-800">
                          {task.finalOutput}
                        </pre>
                      </div>
                    </Accordion>
                  )}

                  {/* Error Accordion */}
                  {task.error && (
                    <Accordion title="Error" variant="error" defaultOpen={true}>
                      <p className="mt-2 text-sm text-red-700 dark:text-red-400">{task.error}</p>
                    </Accordion>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tasks.length === 0 && (
        <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
          <p>No tasks yet. Start a research task above!</p>
          <p className="text-sm mt-1">Tasks are saved locally and persist across page refreshes.</p>
        </div>
      )}
    </div>
  );
}
