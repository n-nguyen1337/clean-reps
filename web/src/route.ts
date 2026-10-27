// Hash routes (`#/progress`), so the app works under any base path with no server rewrites.

import { useEffect, useState } from "react";

export type Route =
  | { page: "home" }
  | { page: "progress" }
  | { page: "achievements" }
  | { page: "set"; id: string }
  | { page: "about" }
  | { page: "settings" };

export type Tab = "home" | "progress" | "about" | "settings";

/** Unknown or malformed routes land on Home. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#?\/?/, "").split("/").filter(Boolean);
  const [first, second] = parts;
  if (parts.length === 0) return { page: "home" };
  if (first === "progress" && parts.length === 1) return { page: "progress" };
  if (first === "progress" && second === "achievements" && parts.length === 2) return { page: "achievements" };
  if (first === "set" && second && parts.length === 2) return { page: "set", id: decodeURIComponent(second) };
  if (first === "about" && parts.length === 1) return { page: "about" };
  if (first === "settings" && parts.length === 1) return { page: "settings" };
  return { page: "home" };
}

export function routeHref(route: Route): string {
  switch (route.page) {
    case "home": return "#/";
    case "achievements": return "#/progress/achievements";
    case "set": return `#/set/${encodeURIComponent(route.id)}`;
    default: return `#/${route.page}`;
  }
}

/** The tab a route belongs to. */
export function tabOf(route: Route): Tab {
  switch (route.page) {
    case "home": return "home";
    case "progress": case "achievements": case "set": return "progress";
    case "about": return "about";
    case "settings": return "settings";
  }
}

export function navigate(route: Route, { replace = false } = {}) {
  const href = routeHref(route);
  if (replace) {
    history.replaceState(history.state, "", href);
    window.dispatchEvent(new HashChangeEvent("hashchange")); // replaceState doesn't fire it
  } else {
    location.hash = href;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
