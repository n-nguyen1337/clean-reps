// Runs the pgTAP files in this folder against the linked Supabase project
// through the Management API (`supabase db query --linked`), so no Docker is
// needed. Each file rolls itself back. Exits non-zero on any failure.
//
//   npx supabase link --project-ref <ref>   # once
//   node supabase/tests/run-linked.mjs [file.test.sql ...]
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync(here).filter((f) => f.endsWith(".test.sql")).map((f) => join(here, f));

let failed = false;
for (const file of files) {
  console.log(`# ${relative(process.cwd(), file)}`);
  const run = spawnSync("npx", ["supabase", "db", "query", "--linked", "-o", "json", "-f", file], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const lines = parseLines(run.stdout);
  if (run.status !== 0 || !lines) {
    console.log(`not ok - the file did not run\n${run.stderr.trim()}`);
    failed = true;
    continue;
  }
  console.log(lines.join("\n"));
  const planned = Number(/^1\.\.(\d+)$/.exec(lines[0] ?? "")?.[1] ?? NaN);
  const passed = lines.filter((l) => l.startsWith("ok ")).length;
  if (lines.some((l) => l.startsWith("not ok")) || passed !== planned) failed = true;
}
process.exit(failed ? 1 : 0);

function parseLines(stdout) {
  try {
    const start = stdout.indexOf("{");
    const { rows } = JSON.parse(stdout.slice(start));
    return rows.map((r) => r.line);
  } catch {
    return null;
  }
}
