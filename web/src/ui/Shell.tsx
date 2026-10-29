import { useEffect, type ReactNode } from "react";
import { useAccount } from "../cloud/account";
import { routeHref, tabOf, type Route, type Tab } from "../route";
import { Logo } from "./Logo";

const svg = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
);

export const ICONS = {
  home: svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9v11h14V9" /><path d="M10 20v-6h4v6" /></>),
  progress: svg(<><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>),
  about: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path d="M12 7.5v.01" /></>),
  settings: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),};

const TABS: { tab: Tab; label: string; route: Route }[] = [
  { tab: "home", label: "Home", route: { page: "home" } },
  { tab: "progress", label: "Progress", route: { page: "progress" } },
  { tab: "about", label: "About", route: { page: "about" } },
  { tab: "settings", label: "Settings", route: { page: "settings" } },
];

const CRUMBS: Record<Route["page"], string[]> = {
  home: ["Home"], progress: ["Progress"], achievements: ["Progress", "Achievements"], set: ["Progress", "Set"],
  about: ["About"], settings: ["Settings"],
};

function StorageStatus() {
  const account = useAccount();
  if (account.status !== "signed-in") return <span className="topbar-status">History saved on this device</span>;
  const { sync } = account;
  const text = sync.kind === "syncing" ? "Syncing…" : sync.kind === "error" ? "Sync failed"
    : sync.at ? `Synced ${sync.at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "Backed up";
  return <span className="topbar-status">{account.user?.name} · {text}</span>;
}

/** Page frame: a sidebar and top bar from 1024px; on smaller screens, a tab bar at the bottom. */
export function Shell({ route, startLabel, onStart, children }: {
  route: Route; startLabel: string; onStart: () => void; children: ReactNode;
}) {
  const active = tabOf(route);
  const href = routeHref(route);
  useEffect(() => {
    window.scrollTo(0, 0); // newer browsers return a promise, which must not become the effect's cleanup
  }, [href]);

  return (
    <div className="shell">
      <nav className="tabbar" aria-label="Main">
        <Logo />
        {TABS.map(({ tab, label, route: to }) => (
          <a key={tab} href={routeHref(to)} className={`tab-${tab}${tab === active ? " active" : ""}`}
            aria-current={tab === active ? "page" : undefined}>
            {ICONS[tab]}<span>{label}</span>
          </a>
        ))}
      </nav>
      <header className="topbar">
        <p className="crumbs">
          {CRUMBS[route.page].map((c, i, all) => i < all.length - 1
            ? <span key={c}><a href={routeHref(TABS.find((t) => t.label === c)!.route)}>{c}</a> / </span>
            : <b key={c}>{c}</b>)}
        </p>
        <div className="topbar-end">
          <StorageStatus />
          {route.page !== "home" && <button className="primary" onClick={onStart}>{startLabel}</button>}
        </div>
      </header>
      {children}
    </div>
  );
}
