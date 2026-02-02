"use client";

import { useState } from "react";
import SearchDemo from "./components/SearchDemo";
import ExtractDemo from "./components/ExtractDemo";
import TasksDemo from "./components/TasksDemo";

type Tab = "search" | "extract" | "tasks";

const TABS: { id: Tab; label: string; description: string }[] = [
  {
    id: "search",
    label: "Search",
    description: "Search the web with natural language objectives",
  },
  {
    id: "extract",
    label: "Extract",
    description: "Extract content from URLs",
  },
  {
    id: "tasks",
    label: "Tasks",
    description: "Run research tasks with real-time updates",
  },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("search");

  return (
    <div className="flex min-h-screen items-start justify-center bg-zinc-50 font-sans dark:bg-zinc-950 py-8 px-4">
      <main className="w-full max-w-3xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <svg
              className="w-10 h-10"
              viewBox="0 0 100 100"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect width="100" height="100" rx="20" fill="#FB631B" />
              <path
                d="M30 35h40M30 50h40M30 65h25"
                stroke="white"
                strokeWidth="6"
                strokeLinecap="round"
              />
            </svg>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              Parallel SDK Demo
            </h1>
          </div>
          <p className="text-zinc-600 dark:text-zinc-400 max-w-md mx-auto">
            Explore Parallel&apos;s Search, Extract, and Tasks APIs with this
            interactive demo.
          </p>
          <div className="mt-4 flex justify-center gap-4 text-sm">
            <a
              href="https://docs.parallel.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Documentation
            </a>
            <a
              href="https://platform.parallel.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Get API Key
            </a>
            <a
              href="https://github.com/parallel-web/parallel-cookbook"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              GitHub
            </a>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {/* Tab Navigation */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-800">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 px-4 py-4 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-b-2 border-blue-600 dark:border-blue-400"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Description */}
          <div className="px-6 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {TABS.find((t) => t.id === activeTab)?.description}
            </p>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === "search" && <SearchDemo />}
            {activeTab === "extract" && <ExtractDemo />}
            {activeTab === "tasks" && <TasksDemo />}
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <p>
            Built with{" "}
            <a
              href="https://nextjs.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-700 dark:text-zinc-300 hover:underline"
            >
              Next.js
            </a>{" "}
            and{" "}
            <a
              href="https://www.npmjs.com/package/parallel-web"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-700 dark:text-zinc-300 hover:underline"
            >
              parallel-web
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
