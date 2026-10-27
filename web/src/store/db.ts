// On-device history in IndexedDB. The app always reads from here; syncing to
// the account happens in the background (cloud/sync.ts).

import Dexie, { liveQuery, type EntityTable } from "dexie";
import { useEffect, useState } from "react";
import { mergeUnlocks, type Unlocks } from "./achievements";
import type { SetRecord } from "./record";

interface Meta {
  key: string;
  value: string;
}

export const db = new Dexie("cleanreps") as Dexie & {
  sets: EntityTable<SetRecord, "id">;
  meta: EntityTable<Meta, "key">;
};
db.version(1).stores({ sets: "id, summary.started, summary.exercise", meta: "key" });

export async function getMeta(key: string): Promise<string | null> {
  return (await db.meta.get(key))?.value ?? null;
}

export async function setMeta(key: string, value: string | null): Promise<void> {
  if (value === null) await db.meta.delete(key);
  else await db.meta.put({ key, value });
}

export async function saveSet(set: SetRecord): Promise<void> {
  await db.sets.put(set);
  // Ask the browser not to evict history under storage pressure. Best effort.
  navigator.storage?.persist?.().catch(() => {});
}

/** Soft delete, so the deletion can sync to other devices. */
export async function deleteSet(id: string, now = new Date()): Promise<void> {
  const ts = now.toISOString();
  await db.sets.update(id, { deletedAt: ts, updatedAt: ts });
}

/** Live sets, newest first. */
export async function activeSets(): Promise<SetRecord[]> {
  const sets = await db.sets.orderBy("summary.started").reverse().toArray();
  return sets.filter((s) => !s.deletedAt);
}

/** Live sets, re-read whenever the table changes. Null until the first read. */
export function useSets(): SetRecord[] | null {
  const [sets, setSets] = useState<SetRecord[] | null>(null);
  useEffect(() => {
    const sub = liveQuery(activeSets).subscribe({ next: setSets, error: () => setSets([]) });
    return () => sub.unsubscribe();
  }, []);
  return sets;
}

const UNLOCKS_KEY = "achievements";

async function readUnlocks(): Promise<Unlocks> {
  try {
    return JSON.parse((await getMeta(UNLOCKS_KEY)) ?? "{}");
  } catch {
    return {};
  }
}

/** Achievements unlocked on this device, kept even after the set that earned them is deleted. */
export function useUnlocks(): Unlocks | null {
  const [unlocks, setUnlocks] = useState<Unlocks | null>(null);
  useEffect(() => {
    const sub = liveQuery(readUnlocks).subscribe({ next: setUnlocks, error: () => setUnlocks({}) });
    return () => sub.unsubscribe();
  }, []);
  return unlocks;
}

/** Adds newly found unlocks to the stored ones (the earlier unlock wins). */
export async function saveUnlocks(found: Unlocks): Promise<void> {
  await db.transaction("rw", db.meta, async () => {
    const stored = await readUnlocks();
    const merged = mergeUnlocks(stored, found);
    if (JSON.stringify(merged) !== JSON.stringify(stored)) await setMeta(UNLOCKS_KEY, JSON.stringify(merged));
  });
}

/** Keeps only the unlocks earned by sets still on the device (run on sign-out, inside its transaction). */
export async function keepUnlocksOf(setIds: Set<string>): Promise<void> {
  const kept = Object.fromEntries(Object.entries(await readUnlocks()).filter(([, u]) => setIds.has(u.setId)));
  await setMeta(UNLOCKS_KEY, Object.keys(kept).length ? JSON.stringify(kept) : null);
}

export async function exportHistory(): Promise<void> {
  const sets = (await activeSets()).map(({ syncedAt: _s, deletedAt: _d, ...rest }) => rest);
  const blob = new Blob([JSON.stringify({ app: "cleanReps", exported: new Date().toISOString(), sets }, null, 1)],
    { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cleanreps-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
