// Deletes the caller's account. Their sets and coach requests go with it
// through `on delete cascade`.

import { admin, caller, cors, json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Use POST." });

  const user = await caller(req);
  if (!user) return json(req, 401, { error: "Sign in first." });

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("deleteUser", error);
    return json(req, 500, { error: "Couldn't delete your account. Try again." });
  }
  return json(req, 200, { deleted: true });
});
