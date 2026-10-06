import type { OfflineDb } from "./db";
import { claimNext, markRejected, markSynced, releaseToQueue } from "./outbox";
import type { OutboxEntry } from "./types";

export type SubmitResult =
  | { kind: "synced"; saleId: string; saleNumber: number }
  /** The server understood the sale and refused it (stale stock, closed shift...). Needs a human. */
  | { kind: "rejected"; error: string }
  /** The server could not decide (hiccup); try again later. */
  | { kind: "retry"; error?: string };

export type DrainResult = {
  synced: number;
  rejected: number;
  remaining: number;
  /** The server refused the session: the queue is paused until the cashier signs in again. */
  needsSignIn?: boolean;
};

/** After this many server-side "retry" answers the sale is surfaced to staff instead of looping silently. */
export const MAX_SERVER_ATTEMPTS = 5;

const inflight = new WeakMap<OfflineDb, Promise<DrainResult>>();

/**
 * Drains the cashier's queue oldest-first. A thrown submit (network loss)
 * stops the drain and keeps order; a rejection is recorded and the line
 * moves on. Only one drain runs per database at a time: concurrent callers
 * share the running one, so a sale is never submitted twice.
 */
export function drainOutbox(
  db: OfflineDb,
  userId: string,
  submit: (entry: OutboxEntry) => Promise<SubmitResult>
): Promise<DrainResult> {
  const running = inflight.get(db);
  if (running) return running;
  const run = drain(db, userId, submit).finally(() => inflight.delete(db));
  inflight.set(db, run);
  return run;
}

async function drain(
  db: OfflineDb,
  userId: string,
  submit: (entry: OutboxEntry) => Promise<SubmitResult>
): Promise<DrainResult> {
  let synced = 0;
  let rejected = 0;
  let needsSignIn = false;

  for (;;) {
    const entry = await claimNext(db, userId);
    if (!entry) break;

    let result: SubmitResult;
    try {
      result = await submit(entry);
    } catch (error) {
      // network loss (or an expired login): put it back untouched and stop so FIFO order holds
      needsSignIn = error instanceof Error && error.message === "notAuthorized";
      await releaseToQueue(db, entry.id, { countAttempt: false });
      break;
    }

    if (result.kind === "synced") {
      await markSynced(db, entry.id, result);
      synced++;
    } else if (result.kind === "rejected") {
      await markRejected(db, entry.id, result.error);
      rejected++;
    } else if (entry.attempts >= MAX_SERVER_ATTEMPTS) {
      await markRejected(db, entry.id, result.error ?? "syncFailed");
      rejected++;
    } else {
      await releaseToQueue(db, entry.id, { countAttempt: true, error: result.error });
      break;
    }
  }

  const remaining = (await db.outbox.where("status").equals("queued").toArray()).filter(
    (entry) => entry.userId === userId
  ).length;
  return { synced, rejected, remaining, ...(needsSignIn ? { needsSignIn } : {}) };
}

/** The slice of the Web Locks API (`navigator.locks`) the drain needs; injectable for tests. */
export type LockManagerLike = {
  request<T>(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => Promise<T>): Promise<T>;
};

export const DRAIN_LOCK_NAME = "cachier-outbox-drain";

/**
 * Like drainOutbox, but only one TAB per browser drains at a time. The
 * in-tab guard above cannot see other tabs, so two open registers could submit
 * sale #2 before sale #1 and break the oldest-first receipt order. Returns
 * null when another tab is already draining (it will do the work).
 * Browsers without the Web Locks API fall back to the in-tab guard.
 */
export async function drainOutboxExclusive(
  db: OfflineDb,
  userId: string,
  submit: (entry: OutboxEntry) => Promise<SubmitResult>,
  locks: LockManagerLike | undefined = typeof navigator === "undefined" ? undefined : (navigator as { locks?: LockManagerLike }).locks
): Promise<DrainResult | null> {
  if (!locks) return drainOutbox(db, userId, submit);
  return locks.request(DRAIN_LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (!lock) return null;
    return drainOutbox(db, userId, submit);
  });
}
