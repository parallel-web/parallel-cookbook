"use client";

import { useState, useRef, useEffect } from "react";

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
}

const PROCESSORS = [
  { value: "lite", label: "Lite", description: "$5/1000 runs, fastest" },
  { value: "base", label: "Base", description: "$10/1000 runs, reliable" },
  { value: "core", label: "Core", description: "$25/1000 runs, thorough" },
  { value: "pro", label: "Pro", description: "$100/1000 runs, deep research" },
  { value: "ultra", label: "Ultra", description: "$300/1000 runs, comprehensive" },
];

export default function TasksDemo() {
  const [input, setInput] = useState("");
  const [processor, setProcessor] = useState("lite");
  const [taskRun, setTaskRun] = useState<TaskRun | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalOutput, setFinalOutput] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const eventsContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll events container
  useEffect(() => {
    if (eventsContainerRef.current) {
      eventsContainerRef.current.scrollTop =
        eventsContainerRef.current.scrollHeight;
    }
  }, [events]);

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleCreateTask = async () => {
    if (!input.trim()) return;

    setLoading(true);
    setError(null);
    setEvents([]);
    setTaskRun(null);
    setFinalOutput(null);

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

      setTaskRun(data);
      setLoading(false);

      // Start streaming events
      startEventStream(data.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setLoading(false);
    }
  };

  const startEventStream = (runId: string) => {
    setStreaming(true);

    const eventSource = new EventSource(`/api/tasks/${runId}/events`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Add event to list
        setEvents((prev) => [
          ...prev,
          {
            type: data.type || "unknown",
            timestamp: new Date().toISOString(),
            message: data.message || data.progress_message,
            data,
          },
        ]);

        // Check for completion
        if (data.type === "task_run.state" && data.status === "completed") {
          if (data.output) {
            setFinalOutput(
              typeof data.output === "string"
                ? data.output
                : JSON.stringify(data.output, null, 2)
            );
          }
          eventSource.close();
          setStreaming(false);
        }

        // Check for failure
        if (data.type === "task_run.state" && data.status === "failed") {
          setError(data.error?.message || "Task failed");
          eventSource.close();
          setStreaming(false);
        }
      } catch {
        // Non-JSON event, ignore
      }
    };

    eventSource.onerror = () => {
      // SSE connection closed or errored
      eventSource.close();
      setStreaming(false);
    };
  };

  const stopStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setStreaming(false);
  };

  const resetDemo = () => {
    stopStream();
    setTaskRun(null);
    setEvents([]);
    setFinalOutput(null);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <label
            htmlFor="task-input"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
          >
            Research Task
          </label>
          <textarea
            id="task-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your research task... (e.g., 'Research the top 5 AI companies and their latest product announcements')"
            className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
            rows={4}
            disabled={loading || streaming}
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
            disabled={loading || streaming}
          >
            {PROCESSORS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} - {p.description}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleCreateTask}
            disabled={loading || streaming || !input.trim()}
            className="flex-1 py-3 px-4 bg-orange-600 hover:bg-orange-700 disabled:bg-zinc-400 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
          >
            {loading ? "Creating Task..." : streaming ? "Running..." : "Start Task"}
          </button>

          {(taskRun || streaming) && (
            <button
              onClick={resetDemo}
              className="py-3 px-4 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {taskRun && (
        <div className="p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Run ID</p>
              <p className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
                {taskRun.run_id}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {streaming && (
                <span className="flex items-center gap-2 text-sm text-orange-600 dark:text-orange-400">
                  <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                  Streaming
                </span>
              )}
              <span className="px-2 py-1 text-xs font-medium bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded">
                {taskRun.processor}
              </span>
            </div>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Events ({events.length})
          </h3>
          <div
            ref={eventsContainerRef}
            className="max-h-64 overflow-y-auto space-y-2 p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg"
          >
            {events.map((event, index) => (
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
                  <p className="text-zinc-600 dark:text-zinc-300">
                    {event.message}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {finalOutput && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Final Output
          </h3>
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <pre className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap overflow-x-auto">
              {finalOutput}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
