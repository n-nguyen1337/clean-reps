// CORS, JSON responses and caller authentication shared by the Edge Functions.

import { createClient, type User } from "npm:@supabase/supabase-js@2.118.0";

// A leading "*." matches any subdomain, for Cloudflare Pages preview deployments.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS")
  ?? "https://clean-reps.pages.dev,https://*.clean-reps.pages.dev,http://localhost:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);

function allowed(origin: string): boolean {
  return ALLOWED_ORIGINS.some((o) => {
    const star = o.indexOf("://*.");
    if (star < 0) return o === origin;
    const [scheme, suffix] = [o.slice(0, star + 3), o.slice(star + 4)];
    return origin.startsWith(scheme) && origin.endsWith(suffix) && !origin.slice(scheme.length, -suffix.length).includes("/");
  });
}

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowed(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
}

/** A client with the service role: bypasses RLS. Server-side only. */
export const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** The signed-in caller, from the request's bearer token; null if missing or invalid. */
export async function caller(req: Request): Promise<User | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}
