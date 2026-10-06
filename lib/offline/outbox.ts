import type { OfflineDb } from "./db";
import type { OutboxEntry, OutboxStatus, ProvisionalReceipt, QueuedSaleItem } from "./types";

export type EnqueueInput = {
  /** Reuse an idempotency key when an online attempt is already in flight. */
  id?: string;
  userId: string;
  shiftId: string | null;
  items: QueuedSaleItem[];
  amountTendered: number;
  provisional: ProvisionalReceipt;
  customerId?: string | null;
};

/** Writes the sale to IndexedDB first; the receipt can print before any network call. */
export async function enqueueSale(db: OfflineDb, input: EnqueueInput): Promise<OutboxEntry> {
  return db.transaction("rw", db.outbox, db.meta, async () => {
    const seqRow = await db.meta.get("localSeq");
    const localNumber = (typeof seqRow?.value === "number" ? seqRow.value : 0) + 1;
    await db.meta.put({ key: "localSeq", value: localNumber });
    const entry: OutboxEntry = {
      id: input.id ?? crypto.randomUUID(),
      userId: input.userId,
      shiftId: input.shiftId,
      items: input.items,
      amountTendered: input.amountTendered,
      provisional: input.provisional,
      customerId: input.customerId ?? null,
      createdAt: new Date().toISOString(),
      localNumber,
      status: "queued",
      attempts: 0,
      syncingSince: null,
      error: null,
      saleId: null,
      saleNumber: null,
      syncedAt: null,
      resolution: null,
    };
    await db.outbox.add(entry);
    return entry;
  });
}

/** FIFO by local number — receipt ordering matters. */
export async function listOutbox(db: OfflineDb): Promise<OutboxEntry[]> {
  return db.outbox.orderBy("localNumber").toArray();
}

export async function getOutboxEntry(db: OfflineDb, id: string): Promise<OutboxEntry | undefined> {
  return db.outbox.get(id);
}

export type StatusCounts = Record<OutboxStatus, number>;

export async function countByStatus(db: OfflineDb, userId?: string): Promise<StatusCounts> {
  const counts: StatusCounts = { queued: 0, syncing: 0, synced: 0, rejected: 0, resolved: 0 };
  const rows = await db.outbox.toArray();
  for (const row of rows) {
    if (userId && row.userId !== userId) continue;
    counts[row.status]++;
  }
  return counts;
}

/**
 * Atomically takes the oldest queued sale of `userId` and marks it
 * `syncing`. The read-modify-write is one IndexedDB transaction, so two
 * concurrent drains (or two tabs) can never claim the same sale.
 */
export async function claimNext(db: OfflineDb, userId: string): Promise<OutboxEntry | null> {
  return db.transaction("rw", db.outbox, async () => {
    const queued = await db.outbox.where("status").equals("queued").sortBy("localNumber");
    const next = queued.find((entry) => entry.userId === userId);
    if (!next) return null;
    const claimed: OutboxEntry = {
      ...next,
      status: "syncing",
      attempts: next.attempts + 1,
      syncingSince: Date.now(),
    };
    await db.outbox.put(claimed);
    return claimed;
  });
}

export async function markSynced(
  db: OfflineDb,
  id: string,
  result: { saleId: string; saleNumber: number }
): Promise<void> {
  await db.outbox.update(id, {
    status: "synced",
    saleId: result.saleId,
    saleNumber: result.saleNumber,
    syncedAt: new Date().toISOString(),
    syncingSince: null,
    error: null,
  });
}

export async function markRejected(db: OfflineDb, id: string, error: string): Promise<void> {
  await db.outbox.update(id, { status: "rejected", error, syncingSince: null });
}

/** Back to the queue after a transient failure; `countAttempt: false` for plain network loss. */
export async function releaseToQueue(
  db: OfflineDb,
  id: string,
  options: { countAttempt: boolean; error?: string }
): Promise<void> {
  await db.transaction("rw", db.outbox, async () => {
    const entry = await db.outbox.get(id);
    if (!entry) return;
    await db.outbox.put({
      ...entry,
      status: "queued",
      syncingSince: null,
      attempts: options.countAttempt ? entry.attempts : Math.max(0, entry.attempts - 1),
      error: options.error ?? entry.error,
    });
  });
}

/**
 * After a crash or restart a `syncing` row has no live submitter; requeue
 * it. The idempotency key makes a re-submit safe even if the first attempt
 * actually reached the server.
 */
export async function recoverStuck(db: OfflineDb, olderThanMs: number, userId?: string): Promise<number> {
  return db.transaction("rw", db.outbox, async () => {
    const cutoff = Date.now() - olderThanMs;
    const stuck = (await db.outbox.where("status").equals("syncing").toArray()).filter(
      (entry) => (!userId || entry.userId === userId) && (entry.syncingSince === null || entry.syncingSince <= cutoff)
    );
    for (const entry of stuck) {
      await db.outbox.update(entry.id, { status: "queued", syncingSince: null });
    }
    return stuck.length;
  });
}

export async function retryRejected(db: OfflineDb, id: string): Promise<void> {
  await db.transaction("rw", db.outbox, async () => {
    const entry = await db.outbox.get(id);
    if (!entry || entry.status !== "rejected") throw new Error("only rejected sales can be retried");
    await db.outbox.update(id, { status: "queued", attempts: 0, error: null });
  });
}

/**
 * Staff close out a rejected sale explicitly. The row is never deleted —
 * it stays as the record of what the till rang and how it was settled.
 */
export async function resolveRejected(db: OfflineDb, id: string, note: string): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) throw new Error("a resolution note is required");
  await db.transaction("rw", db.outbox, async () => {
    const entry = await db.outbox.get(id);
    if (!entry || entry.status !== "rejected") throw new Error("only rejected sales can be resolved");
    await db.outbox.update(id, {
      status: "resolved",
      resolution: { note: trimmed, at: new Date().toISOString() },
    });
  });
}

/** Sales of one shift that are not yet on the server (or need staff action): they must block closing it. */
export async function countUnsettledForShift(db: OfflineDb, shiftId: string): Promise<number> {
  const rows = await db.outbox.toArray();
  return rows.filter(
    (row) => row.shiftId === shiftId && (row.status === "queued" || row.status === "syncing" || row.status === "rejected")
  ).length;
}
