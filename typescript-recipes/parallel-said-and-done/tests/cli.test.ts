import assert from "node:assert/strict";
import { test } from "node:test";
import { flag, positional } from "../scripts/lib/env";

test("boolean flags before a ticker preserve the scope of paid commands", () => {
  const saved = process.argv;
  try {
    process.argv = ["node", "monitors", "cancel", "--yes", "MSFT"];
    assert.deepEqual(positional(), ["cancel", "MSFT"]);
    assert.equal(flag("yes"), "true");
    process.argv = ["node", "deepen", "--redo", "DUK:P8", "--clear-only"];
    assert.deepEqual(positional(["redo"]), []);
    assert.equal(flag("redo", true), "DUK:P8");
  } finally {
    process.argv = saved;
  }
});
