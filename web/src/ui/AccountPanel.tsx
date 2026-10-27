import { useState } from "react";
import { useAccount, type SyncState } from "../cloud/account";

function syncText(s: SyncState): string {
  if (s.kind === "syncing") return "Syncing…";
  if (s.kind === "error") return s.message;
  return s.at ? `Synced at ${s.at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "Backed up";
}

/** Sign-in, sync status and account controls for the Settings page. */
export function AccountPanel() {
  const account = useAccount();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!account.configured) return <p className="hint small">History is saved on this device.</p>;

  const act = (fn: () => Promise<void>) => async () => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (account.status !== "signed-in") {
    return (
      <div className="account">
        <p>Sign in to back up your history, sync it across devices, and get AI coaching. Optional: everything else works without an account.</p>
        <button disabled={busy || account.status === "loading"} onClick={act(account.signIn)}>
          {account.status === "loading" ? "Signing in…" : "Sign in with Google"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="account">
      <p>
        Signed in as <b>{account.user?.name}</b>
        <br /><span className={account.sync.kind === "error" ? "error" : "hint small"}>{syncText(account.sync)}</span>
      </p>
      <div className="row tight">
        <button disabled={busy} onClick={act(account.signOut)}>Sign out</button>
        <button className="danger" disabled={busy} onClick={act(async () => {
          if (!confirm("Delete your account and all synced history? This can't be undone.")) return;
          await account.deleteAccount();
        })}>Delete account</button>
      </div>
      <p className="hint small">Signing out removes synced sets from this device; they stay in your account.</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
