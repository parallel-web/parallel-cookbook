import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const recipeDirectory = resolve();

async function temporaryCliPackage(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "vendor-intelligence-cli-"));
  await symlink(join(recipeDirectory, "node_modules"), join(directory, "node_modules"), "dir");
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        scripts: {
          bootstrap: `${join(recipeDirectory, "node_modules/.bin/tsx")} ${join(recipeDirectory, "scripts/bootstrap.ts")}`,
          "check-updates": `${join(recipeDirectory, "node_modules/.bin/tsx")} ${join(recipeDirectory, "scripts/check-updates.ts")}`,
          cleanup: `${join(recipeDirectory, "node_modules/.bin/tsx")} ${join(recipeDirectory, "scripts/cleanup.ts")}`,
        },
      },
      null,
      2,
    )}\n`,
  );
  return directory;
}

describe("CLI output", () => {
  it.each(["check-updates", "cleanup"])(
    "npm run --silent %s writes exactly one JSON document to stdout",
    async (command) => {
      const directory = await temporaryCliPackage();
      try {
        const { stdout } = await exec("npm", ["run", "--silent", command], {
          cwd: directory,
          env: { ...process.env, PARALLEL_API_KEY: "test-key" },
        });
        expect(() => JSON.parse(stdout)).not.toThrow();
        expect(JSON.stringify(JSON.parse(stdout), null, 2) + "\n").toBe(stdout);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("returns a nonzero status and keeps stdout empty for invalid bootstrap input", async () => {
    const directory = await temporaryCliPackage();
    try {
      const vendorsPath = join(directory, "vendors.json");
      await writeFile(vendorsPath, "[]\n");
      let failure: unknown;
      try {
        await exec(
          "npm",
          ["run", "--silent", "bootstrap", "--", "--vendors", vendorsPath],
          {
            cwd: directory,
            env: { ...process.env, PARALLEL_API_KEY: "test-key" },
          },
        );
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({ code: 1, stdout: "" });
      expect(failure).toMatchObject({ stderr: expect.stringContaining("at least one vendor") });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
