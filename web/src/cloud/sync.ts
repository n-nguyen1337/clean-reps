// Two-way sync between on-device history and the signed-in account.
//
// Sets never change after they're saved, except to be deleted, so the rules
// are simple: push what changed locally, pull what changed on the server since
// the last pull, and a deletion on either side wins.

import { db, getMeta, keepUnlocksOf, setMeta } from "../store/db";
import type { SetRecord } from "../store/record";

export interface Remote {
  /** Upsert by id. Must be safe to retry. */
  push(sets: SetRecord[]): Promise<void>;
  /** Sets changed at or after `since` (server time), oldest first, with the cursor for the next pull. */
  pull(since: string | null): Promise<{ sets: SetRecord[]; cursor: string | null }>;
}

const CURSOR_KEY = "pullCursor";
const BATCH = 50;

const unsynced = (s: SetRecord) => s.syncedAt !== s.updatedAt;

export async function sync(remote: Remote): Promise<{ pushed: number; pulled: number }> {
  const pending = await db.sets.filter(unsynced).toArray();
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    await remote.push(batch);
    await db.transaction("rw", db.sets, async () => {
      for (const sent of batch) {
        // Skip a set that was deleted while the push was in flight; the next sync sends it.
        const now = await db.sets.get(sent.id);
        if (now && now.updatedAt === sent.updatedAt) await db.sets.update(sent.id, { syncedAt: sent.updatedAt });
      }
    });
  }

  const { sets, cursor } = await remote.pull(await getMeta(CURSOR_KEY));
  await db.transaction("rw", db.sets, db.meta, async () => {
    for (const incoming of sets) {
      const local = await db.sets.get(incoming.id);
      if (local && unsynced(local)) continue; // a local change that the next push will send
      if (local?.deletedAt && !incoming.deletedAt) continue;
      await db.sets.put({ ...incoming, syncedAt: incoming.updatedAt });
    }
    if (cursor) await setMeta(CURSOR_KEY, cursor);
  });

  return { pushed: pending.length, pulled: sets.length };
}

/**
 * On sign-out, drop the account's sets from this device (they're backed up)
 * and keep anything not yet synced, which the next sign-in will upload.
 */
export async function forgetSyncedSets(): Promise<void> {
  await db.transaction("rw", db.sets, db.meta, async () => {
    await db.sets.filter((s) => !unsynced(s)).delete();
    await setMeta(CURSOR_KEY, null);
    // The next person on this device shouldn't inherit the account's achievements.
    await keepUnlocksOf(new Set(await db.sets.toCollection().primaryKeys()));
  });
}
