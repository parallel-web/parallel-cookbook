import assert from "node:assert/strict";
import test from "node:test";

import { periodOf, sameCall } from "../src/sheet/evidence";

test("periods are read only where quarter and year sit together", () => {
  assert.deepEqual(periodOf("Q4 FY2024 earnings call"), { q: 4, y: 2024 });
  assert.deepEqual(periodOf("Microsoft Fiscal Year 2024 Fourth Quarter Earnings Conference Call"), { q: 4, y: 2024 });
  assert.deepEqual(periodOf("Q4'24 Prepared Remarks for Website"), { q: 4, y: 2024 });
  assert.deepEqual(periodOf("Uber-Q4-25-Earnings-Call-Transcript.pdf"), { q: 4, y: 2025 });
  assert.deepEqual(periodOf("Intuit Inc. Fourth-quarter Fiscal 2025 Conference Call"), { q: 4, y: 2025 });
  assert.equal(periodOf("Uber Technologies, Inc."), null);
});

test("a source from a different call is caught; unknown is let through", () => {
  const url = "https://example.com/x.pdf";
  assert.equal(sameCall("Q4 2025 earnings call", { title: "General Motors Company (GM) Q3 FY2025 earnings call transcript", url }, "2026-01-27"), false);
  assert.equal(sameCall("Q1 FY2026 earnings call", { title: "TJX (TJX) Q1 2027 Earnings Call Transcript", url }, "2025-05-21"), false);
  assert.equal(sameCall("Q4 2025 earnings call", { title: "CVS Health Corp.", url: "https://s206.q4cdn.com/files/doc_financials/2025/q3/CVS-Q3-2025-Earnings-Transcript.pdf" }, "2026-02-10"), false);
  assert.equal(sameCall("Q4 2025 earnings call", { title: "2026-01-15 BAC 4Q Earnings Call_ADA", url }, "2026-01-14"), true);
  assert.equal(sameCall("Q4 2025 earnings call", { title: "Uber Technologies, Inc.", url: "https://s23.q4cdn.com/files/doc_events/2026/Feb/04/Uber-Q4-25-Earnings-Call-Transcript.pdf" }, "2026-02-04"), true);
  assert.equal(sameCall("Q4 2024 earnings call", { title: "Q4'24 Prepared Remarks for Website", url }, "2025-02-20"), true);
});
