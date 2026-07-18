import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const fetchMock = vi.fn();
const click = vi.fn();
const remove = vi.fn();
const appendChild = vi.fn();
const createObjectURL = vi.fn(() => "blob:export");
const revokeObjectURL = vi.fn();
const link = { href: "", download: "", click, remove };

vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
});
vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("document", {
  createElement: vi.fn(() => link),
  body: { appendChild },
});
vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

import { downloadBulkExport } from "./api";

beforeEach(() => {
  store.clear();
  store.set("pse-access-key", "demo passphrase");
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    blob: async () => new Blob(["company_name\nAcme"]),
  });
  click.mockClear();
  remove.mockClear();
  appendChild.mockClear();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

describe("downloadBulkExport", () => {
  it("keeps the passphrase in the request header and out of the URL", async () => {
    await downloadBulkExport("job123456789");

    expect(fetchMock).toHaveBeenCalledWith("/api/enrich/bulk/job123456789/export.csv", {
      headers: { "x-demo-key": "demo passphrase" },
    });
    expect(link.download).toBe("enrichment-job12345.csv");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });
});
