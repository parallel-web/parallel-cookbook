/**
 * Where pipeline state lives. Two backends behind one interface:
 *
 *   files   the app folder on disk (data/ and output/), for local runs and fresh clones
 *   blob    a private Vercel Blob store, when BLOB_READ_WRITE_TOKEN is set (the deployment)
 *
 * Paths are the same in both, e.g. data/sheets/MSFT.json or output/raw/MSFT/manifest-latest.json.
 * Reads always see the latest write: the blob backend reads from origin, not the CDN.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";

export interface Storage {
  name: "files" | "blob";
  get(path: string): Promise<string | null>;
  /** With `create`, writes only if nothing is there yet and returns false otherwise (used for locks). */
  put(path: string, body: string, options?: { create?: boolean }): Promise<boolean>;
  /** Every path under a prefix. */
  list(prefix: string): Promise<string[]>;
  del(path: string): Promise<void>;
}

export const APP_ROOT = resolve(process.env.SAID_DONE_ROOT ?? process.cwd());

export function fileStorage(root = APP_ROOT): Storage {
  const abs = (path: string) => join(root, path);
  const walk = (dir: string): string[] =>
    existsSync(dir) ? readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)])) : [];
  return {
    name: "files",
    async get(path) {
      return existsSync(abs(path)) ? readFileSync(abs(path), "utf8") : null;
    },
    async put(path, body, options) {
      mkdirSync(dirname(abs(path)), { recursive: true });
      if (options?.create) {
        try {
          writeFileSync(abs(path), body, { flag: "wx" });
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
          throw error;
        }
      }
      const tmp = `${abs(path)}.tmp`;
      writeFileSync(tmp, body);
      renameSync(tmp, abs(path));
      return true;
    },
    async list(prefix) {
      const dir = abs(prefix.endsWith("/") ? prefix : dirname(prefix));
      return walk(dir)
        .map((f) => relative(root, f))
        .filter((p) => p.startsWith(prefix) && !p.endsWith(".tmp"));
    },
    async del(path) {
      rmSync(abs(path), { force: true });
    },
  };
}

export function blobStorage(token = process.env.BLOB_READ_WRITE_TOKEN): Storage {
  return {
    name: "blob",
    async get(path) {
      const result = await get(path, { access: "private", useCache: false, token });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      return new Response(result.stream).text();
    },
    async put(path, body, options) {
      try {
        await put(path, body, {
          access: "private",
          token,
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: !options?.create,
        });
        return true;
      } catch (error) {
        // put() refuses to replace an existing blob unless allowOverwrite is set.
        if (options?.create && (error instanceof BlobPreconditionFailedError || /already exists/i.test(String((error as Error).message)))) return false;
        throw error;
      }
    },
    async list(prefix) {
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, limit: 1000, token });
        out.push(...page.blobs.map((b) => b.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out;
    },
    async del(path) {
      await del(path, { token });
    },
  };
}

let current: Storage | null = null;

/** The deployment uses Blob; everything else uses the app folder. */
export function storage(): Storage {
  current ??= process.env.BLOB_READ_WRITE_TOKEN ? blobStorage() : fileStorage();
  return current;
}

/** For tests and the push/pull script. */
export function useStorage(next: Storage) {
  current = next;
}
