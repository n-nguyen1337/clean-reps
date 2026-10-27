// Optional Google sign-in through Supabase. Signed in, history is backed up and
// synced, and AI coaching is available. supabase-js loads only when it's
// needed: when the user signs in, or when a session or OAuth return is present.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { forgetSyncedSets, sync } from "./sync";

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloudConfigured = Boolean(URL_ && KEY);

let clientPromise: Promise<SupabaseClient> | null = null;
export function getClient(): Promise<SupabaseClient> {
  clientPromise ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(URL_!, KEY!, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } }));
  return clientPromise;
}

/** A stored session or an OAuth redirect to finish, without loading supabase-js to find out. */
function sessionLikely(): boolean {
  if (new URLSearchParams(location.search).has("code")) return true;
  try {
    return Object.keys(localStorage).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
  } catch {
    return false;
  }
}

export type SyncState = { kind: "idle"; at: Date | null } | { kind: "syncing" } | { kind: "error"; message: string };

export interface Account {
  configured: boolean;
  status: "loading" | "signed-out" | "signed-in";
  user: { id: string; name: string; email: string | null } | null;
  sync: SyncState;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Start a sync now; coalesces with one already running. */
  requestSync(): void;
  deleteAccount(): Promise<void>;
}

const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account {
  const a = useContext(AccountContext);
  if (!a) throw new Error("useAccount outside AccountProvider");
  return a;
}

const describe = (u: User) => ({
  id: u.id,
  name: (u.user_metadata?.full_name as string | undefined) ?? u.email ?? "Signed in",
  email: u.email ?? null,
});

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Account["status"]>(cloudConfigured && sessionLikely() ? "loading" : "signed-out");
  const [user, setUser] = useState<Account["user"]>(null);
  const [syncState, setSyncState] = useState<SyncState>({ kind: "idle", at: null });
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const signedIn = useRef(false);

  const requestSync = useCallback(() => {
    if (!signedIn.current) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = (async () => {
      do {
        again.current = false;
        setSyncState({ kind: "syncing" });
        try {
          const client = await getClient();
          const { supabaseRemote } = await import("./remote");
          await sync(supabaseRemote(client));
          setSyncState({ kind: "idle", at: new Date() });
        } catch (err) {
          setSyncState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
          again.current = false; // retried on the next trigger, not in a loop
        }
      } while (again.current);
      running.current = null;
    })();
  }, []);

  // Signing in leaves the page for Google, so a session only ever appears on load.
  useEffect(() => {
    if (!cloudConfigured || !sessionLikely()) return;
    let unsub = () => {};
    getClient().then((client) => {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        signedIn.current = Boolean(session);
        setUser(session ? describe(session.user) : null);
        setStatus(session ? "signed-in" : "signed-out");
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
          if (new URLSearchParams(location.search).has("code")) history.replaceState(null, "", location.pathname);
          if (session) requestSync();
        }
      });
      unsub = () => data.subscription.unsubscribe();
    }).catch(() => setStatus("signed-out"));
    return () => unsub();
  }, [requestSync]);

  useEffect(() => {
    window.addEventListener("online", requestSync);
    return () => window.removeEventListener("online", requestSync);
  }, [requestSync]);

  const account = useMemo<Account>(() => ({
    configured: cloudConfigured,
    status,
    user,
    sync: syncState,
    async signIn() {
      setStatus("loading");
      const client = await getClient();
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: location.origin + location.pathname },
      });
      if (error) {
        setStatus("signed-out");
        throw error;
      }
    },
    async signOut() {
      await running.current;
      const client = await getClient();
      await client.auth.signOut();
      signedIn.current = false;
      await forgetSyncedSets();
    },
    requestSync,
    async deleteAccount() {
      const client = await getClient();
      const { error } = await client.functions.invoke("delete-account", { method: "POST" });
      if (error) throw new Error(await functionError(error));
      await client.auth.signOut({ scope: "local" });
      signedIn.current = false;
      await forgetSyncedSets();
    },
  }), [status, user, syncState, requestSync]);

  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

/** The `error` message an Edge Function returned, or a generic one. */
export async function functionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (typeof body?.error === "string") return body.error;
    } catch {
      /* not JSON */
    }
  }
  return error instanceof Error ? error.message : String(error);
}
