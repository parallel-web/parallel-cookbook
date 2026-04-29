import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig, resetConfig } from "@/config/index.js";

describe("loadConfig", () => {
  const savedEnv = { ...process.env };

  function setRequiredEnv() {
    process.env.PARALLEL_API_KEY = "test-key";
    process.env.GOOGLE_SHEET_ID = "sheet123";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/test";
    process.env.N8N_WEBHOOK_BASE_URL = "https://example.app.n8n.cloud";
  }

  beforeEach(() => {
    // Restore original env and reset singleton before each test
    process.env = { ...savedEnv };
    resetConfig();
  });

  describe("required variables", () => {
    it("throws when PARALLEL_API_KEY is missing", () => {
      process.env.GOOGLE_SHEET_ID = "sheet123";
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/test";
      process.env.N8N_WEBHOOK_BASE_URL = "https://example.app.n8n.cloud";
      delete process.env.PARALLEL_API_KEY;

      expect(() => loadConfig()).toThrow("PARALLEL_API_KEY");
    });

    it("throws when GOOGLE_SHEET_ID is missing", () => {
      process.env.PARALLEL_API_KEY = "test-key";
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/test";
      process.env.N8N_WEBHOOK_BASE_URL = "https://example.app.n8n.cloud";
      delete process.env.GOOGLE_SHEET_ID;

      expect(() => loadConfig()).toThrow("GOOGLE_SHEET_ID");
    });

    it("throws when SLACK_WEBHOOK_URL is missing", () => {
      process.env.PARALLEL_API_KEY = "test-key";
      process.env.GOOGLE_SHEET_ID = "sheet123";
      process.env.N8N_WEBHOOK_BASE_URL = "https://example.app.n8n.cloud";
      delete process.env.SLACK_WEBHOOK_URL;

      expect(() => loadConfig()).toThrow("SLACK_WEBHOOK_URL");
    });

    it("throws when N8N_WEBHOOK_BASE_URL is missing", () => {
      process.env.PARALLEL_API_KEY = "test-key";
      process.env.GOOGLE_SHEET_ID = "sheet123";
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/test";
      delete process.env.N8N_WEBHOOK_BASE_URL;

      expect(() => loadConfig()).toThrow("N8N_WEBHOOK_BASE_URL");
    });

    it("throws with descriptive message mentioning .env", () => {
      delete process.env.PARALLEL_API_KEY;
      delete process.env.GOOGLE_SHEET_ID;
      delete process.env.SLACK_WEBHOOK_URL;
      delete process.env.N8N_WEBHOOK_BASE_URL;

      expect(() => loadConfig()).toThrow(
        "Check your .env file or environment variables"
      );
    });
  });

  describe("defaults", () => {
    it("applies all default values", () => {
      setRequiredEnv();
      const config = loadConfig();

      expect(config.PARALLEL_BASE_URL).toBe("https://api.parallel.ai");
      expect(config.RESEARCH_CRON).toBe("0 6 * * *");
      expect(config.SYNC_CRON).toBe("0 0 * * *");
      expect(config.BATCH_SIZE).toBe(50);
      expect(config.RESEARCH_PROCESSOR).toBe("ultra8x");
      expect(config.MONITOR_CADENCE_HIGH).toBe("daily");
      expect(config.MONITOR_CADENCE_STD).toBe("weekly");
      expect(config.MONITORS_PER_VENDOR_HIGH).toBe(5);
      expect(config.MONITORS_PER_VENDOR_STD).toBe(2);
    });

    it("leaves optional slack channels as undefined", () => {
      setRequiredEnv();
      const config = loadConfig();

      expect(config.SLACK_CHANNEL_CRITICAL).toBeUndefined();
      expect(config.SLACK_CHANNEL_ALERT).toBeUndefined();
      expect(config.SLACK_CHANNEL_DIGEST).toBeUndefined();
    });
  });

  describe("type coercion", () => {
    it("coerces BATCH_SIZE from string to number", () => {
      setRequiredEnv();
      process.env.BATCH_SIZE = "100";

      const config = loadConfig();
      expect(config.BATCH_SIZE).toBe(100);
    });

    it("coerces MONITORS_PER_VENDOR_HIGH from string to number", () => {
      setRequiredEnv();
      process.env.MONITORS_PER_VENDOR_HIGH = "10";

      const config = loadConfig();
      expect(config.MONITORS_PER_VENDOR_HIGH).toBe(10);
    });
  });

  describe("caching", () => {
    it("returns the same instance on subsequent calls", () => {
      setRequiredEnv();
      const first = loadConfig();
      const second = loadConfig();
      expect(first).toBe(second);
    });

    it("returns fresh instance after resetConfig", () => {
      setRequiredEnv();
      const first = loadConfig();
      resetConfig();
      const second = loadConfig();
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    });
  });
});
