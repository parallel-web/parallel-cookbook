import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { hostname } from "node:os";

import { z } from "zod";

const LockOwnerSchema = z.object({
  version: z.literal(1),
  token: z.string().uuid(),
  pid: z.number().int().positive(),
  hostname: z.string().min(1),
  command: z.string().min(1),
  acquiredAt: z.string().min(1),
});

type LockOwner = z.infer<typeof LockOwnerSchema>;
const INITIALIZATION_GRACE_MS = 30_000;

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function readOwner(lockPath: string): Promise<LockOwner | undefined> {
  try {
    const parsed = LockOwnerSchema.safeParse(JSON.parse(await readFile(lockPath, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function describeLock(lockPath: string): Promise<string | undefined> {
  const owner = await readOwner(lockPath);
  return owner
    ? `${owner.command}, pid ${owner.pid}, since ${owner.acquiredAt}`
    : undefined;
}

async function recoveryGuardError(guardPath: string): Promise<Error> {
  const owner = await readOwner(guardPath);
  if (owner) {
    if (owner.hostname === hostname() && !processIsAlive(owner.pid)) {
      return new Error(
        `A previous command stopped while recovering a stale lock (${owner.command}, pid ${owner.pid}). Verify that no vendor-intelligence command is running, delete ${guardPath}, and retry.`,
      );
    }
    return new Error(
      `Another vendor-intelligence command is recovering a stale lock (${owner.command}, pid ${owner.pid}, since ${owner.acquiredAt}). Wait for it to finish before retrying.`,
    );
  }

  try {
    const details = await stat(guardPath);
    if (Date.now() - details.mtimeMs >= INITIALIZATION_GRACE_MS) {
      return new Error(
        `An incomplete stale-lock recovery marker remains at ${guardPath}. Verify that no vendor-intelligence command is running, delete that file, and retry.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Error("The stale-lock recovery marker changed. Retry the command.");
    }
    throw error;
  }

  return new Error(
    "Another vendor-intelligence command is initializing stale-lock recovery. Wait for it to finish before retrying.",
  );
}

async function reclaimStaleLock(lockPath: string, guardOwner: LockOwner): Promise<boolean> {
  // Only one contender may inspect-and-reclaim. Without this guard, a slower
  // contender could rename a fresh lock created after another reclaimed the stale one.
  const guardPath = `${lockPath}.reclaim`;
  let guardHandle: FileHandle | undefined;
  try {
    guardHandle = await open(guardPath, "wx", 0o600);
    await guardHandle.writeFile(`${JSON.stringify(guardOwner, null, 2)}\n`, "utf8");
    await guardHandle.sync();
    if ((await readOwner(guardPath))?.token !== guardOwner.token) {
      throw new Error("Stale-lock recovery ownership changed during acquisition.");
    }
  } catch (error) {
    if (guardHandle) {
      await releaseOwnedLock(guardPath, guardOwner.token, guardHandle);
      guardHandle = undefined;
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw await recoveryGuardError(guardPath);
    }
    throw error;
  }

  try {
    const owner = await readOwner(lockPath);
    if (owner) {
      if (owner.hostname !== hostname() || processIsAlive(owner.pid)) return false;
    } else {
      try {
        const details = await stat(lockPath);
        if (Date.now() - details.mtimeMs < INITIALIZATION_GRACE_MS) return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        throw error;
      }
    }

    const quarantinePath = `${lockPath}.stale-${randomUUID()}`;
    try {
      await rename(lockPath, quarantinePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
    await rm(quarantinePath, { force: true });
    return true;
  } finally {
    if (guardHandle) {
      await releaseOwnedLock(guardPath, guardOwner.token, guardHandle);
    }
  }
}

async function releaseOwnedLock(
  lockPath: string,
  token: string,
  handle: FileHandle,
): Promise<void> {
  try {
    if ((await readOwner(lockPath))?.token === token) {
      await unlink(lockPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  } finally {
    await handle.close().catch(() => {});
  }
}

/** Serialize a complete command so check-then-create API sequences cannot overlap. */
export async function withCommandLock<T>(input: {
  rootDirectory: string;
  lockPath: string;
  command: string;
  action: () => Promise<T>;
}): Promise<T> {
  await mkdir(input.rootDirectory, { recursive: true, mode: 0o700 });
  const owner: LockOwner = {
    version: 1,
    token: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    command: input.command,
    acquiredAt: new Date().toISOString(),
  };

  let handle: FileHandle | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(input.lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, "utf8");
      await handle.sync();
      if ((await readOwner(input.lockPath))?.token !== owner.token) {
        throw new Error("Command lock ownership changed during acquisition.");
      }
      break;
    } catch (error) {
      if (handle) {
        await releaseOwnedLock(input.lockPath, owner.token, handle);
        handle = undefined;
      }
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt > 0) throw error;
      if (!(await reclaimStaleLock(input.lockPath, owner))) {
        const current = await describeLock(input.lockPath);
        throw new Error(
          `Another vendor-intelligence command is active${current ? ` (${current})` : ""}. Wait for it to finish before retrying.`,
        );
      }
    }
  }

  if (!handle) throw new Error("Could not acquire the vendor-intelligence command lock.");
  try {
    return await input.action();
  } finally {
    await releaseOwnedLock(input.lockPath, owner.token, handle);
  }
}
