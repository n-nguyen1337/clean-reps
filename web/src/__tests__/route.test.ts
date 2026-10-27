import { describe, expect, it } from "vitest";
import { parseRoute, routeHref, tabOf, type Route } from "../route";

describe("parseRoute", () => {
  it("reads each page", () => {
    expect(parseRoute("")).toEqual({ page: "home" });
    expect(parseRoute("#/")).toEqual({ page: "home" });
    expect(parseRoute("#/progress")).toEqual({ page: "progress" });
    expect(parseRoute("#/progress/achievements")).toEqual({ page: "achievements" });
    expect(parseRoute("#/set/abc-123")).toEqual({ page: "set", id: "abc-123" });
    expect(parseRoute("#/about")).toEqual({ page: "about" });
    expect(parseRoute("#/settings")).toEqual({ page: "settings" });
  });

  it("tolerates a missing slash and a trailing one", () => {
    expect(parseRoute("#progress")).toEqual({ page: "progress" });
    expect(parseRoute("#/about/")).toEqual({ page: "about" });
  });

  it("sends unknown routes home", () => {
    for (const hash of ["#/nope", "#/set", "#/progress/other", "#/about/extra", "#/settings/x/y"]) {
      expect(parseRoute(hash)).toEqual({ page: "home" });
    }
  });

  it("round-trips through routeHref, including odd set ids", () => {
    const routes: Route[] = [
      { page: "home" }, { page: "progress" }, { page: "achievements" }, { page: "about" }, { page: "settings" },
      { page: "set", id: "a/b c#d" },
    ];
    for (const r of routes) expect(parseRoute(routeHref(r))).toEqual(r);
  });
});

describe("tabOf", () => {
  it("groups achievements and past sets under Progress, and Settings under its own tab", () => {
    expect(tabOf({ page: "achievements" })).toBe("progress");
    expect(tabOf({ page: "set", id: "x" })).toBe("progress");
    expect(tabOf({ page: "settings" })).toBe("settings");
  });
});
