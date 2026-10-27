// The Supabase side of sync: maps SetRecord to and from rows of the `sets`
// table (supabase/migrations). Row-level security limits every query to the
// signed-in user's rows, and `user_id` defaults to auth.uid().

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SetRecord } from "../store/record";
import type { Remote } from "./sync";

interface SetRow {
  id: string;
  schema_version: number;
  exercise: string;
  started_at: string;
  duration_s: number | null;
  reps: number;
  clean_reps: number;
  partial_reps: number;
  avg_down_s: number | null;
  avg_up_s: number | null;
  faults: Record<string, number>;
  body: SetRecord["body"];
  config: SetRecord["config"];
  rep_results: SetRecord["reps"];
  app_version: string;
  deleted_at: string | null;
  updated_at?: string; // set by the server
}

const PAGE = 500;

export function toRow(set: SetRecord): SetRow {
  const s = set.summary;
  return {
    id: set.id,
    schema_version: set.v,
    exercise: s.exercise,
    started_at: s.started,
    duration_s: set.durationS,
    reps: s.reps,
    clean_reps: s.cleanReps,
    partial_reps: s.partialReps,
    avg_down_s: s.avgDownS,
    avg_up_s: s.avgUpS,
    faults: s.faults,
    body: set.body,
    config: set.config,
    rep_results: set.reps,
    app_version: set.appVersion,
    deleted_at: set.deletedAt,
  };
}

export function fromRow(row: SetRow): SetRecord {
  return {
    id: row.id,
    v: row.schema_version,
    summary: {
      exercise: row.exercise,
      started: new Date(row.started_at).toISOString(),
      reps: row.reps,
      cleanReps: row.clean_reps,
      partialReps: row.partial_reps,
      faults: row.faults,
      avgDownS: row.avg_down_s,
      avgUpS: row.avg_up_s,
    },
    durationS: row.duration_s,
    reps: row.rep_results,
    config: row.config,
    body: row.body,
    appVersion: row.app_version,
    updatedAt: row.updated_at!,
    deletedAt: row.deleted_at,
    syncedAt: row.updated_at!,
  };
}

export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async push(sets) {
      const { error } = await client.from("sets").upsert(sets.map(toRow));
      if (error) throw new Error(`Sync upload failed: ${error.message}`);
    },
    async pull(since) {
      const sets: SetRecord[] = [];
      let cursor = since;
      for (;;) {
        // gte, not gt: rows committed in the same instant as the cursor are re-read, never skipped.
        let q = client.from("sets").select("*").order("updated_at").limit(PAGE);
        if (cursor) q = q.gte("updated_at", cursor);
        const { data, error } = await q.returns<SetRow[]>();
        if (error) throw new Error(`Sync download failed: ${error.message}`);
        const fresh = data.filter((r) => !sets.some((s) => s.id === r.id));
        sets.push(...fresh.map(fromRow));
        const last = data[data.length - 1]?.updated_at ?? null;
        if (data.length < PAGE || !fresh.length || last === cursor) break;
        cursor = last;
      }
      return { sets, cursor: sets.length ? sets[sets.length - 1].updatedAt : since };
    },
  };
}
