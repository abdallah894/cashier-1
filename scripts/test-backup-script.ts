/**
 * Backup script behaviour (Phase 0, review P0-6), run with fake pg_dump / age /
 * curl so no database or network is needed. It must:
 *  - refuse to run without encryption or an off-site upload (and report failed);
 *  - dump BOTH the public schema and the auth users;
 *  - encrypt, upload every file, delete the local copies, and report ok;
 *  - report failed (and keep nothing) when the upload fails.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

const root = mkdtempSync(join(tmpdir(), "backup-test-"));
const bin = join(root, "bin");
mkdirSync(bin);
const log = join(root, "calls.log");
const script = (name: string, body: string) => {
  writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};
// fake pg_dump: records its args, writes the --file target
script("pg_dump", `echo "pg_dump $*" >> "${log}"; for a in "$@"; do case "$a" in --file=*) echo "DUMP" > "\${a#--file=}";; esac; done`);
// fake age: age -r KEY -o OUT IN
script("age", `echo "age $*" >> "${log}"; out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done; echo "ENCRYPTED" > "$out"`);
script("curl", `echo "curl $*" >> "${log}"; exit 0`);

function run(extra: Record<string, string>) {
  const dir = join(root, "out");
  rmSync(dir, { recursive: true, force: true });
  rmSync(log, { force: true });
  const result = spawnSync("bash", ["scripts/backup-db.sh"], {
    env: { ...process.env, BACKUP_AGE_RECIPIENT: "", BACKUP_GPG_RECIPIENT: "", BACKUP_UPLOAD_CMD: "", BACKUP_ALLOW_UNENCRYPTED: "", BACKUP_KEEP_LOCAL: "", PATH: `${bin}:${process.env.PATH}`, HOME: root, SUPABASE_DB_URL: "postgres://x", APP_URL: "https://pos.test", OPS_API_TOKEN: "t".repeat(32), BACKUP_DIR: dir, ...extra },
    encoding: "utf8",
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
  return { status: result.status, calls, left: existsSync(dir) ? readdirSync(dir) : [], stderr: result.stderr };
}

// 1. no encryption configured
{
  const r = run({ BACKUP_UPLOAD_CMD: "true" });
  check("refuses to run without encryption", r.status !== 0 && !r.calls.includes("pg_dump"), r.stderr.trim());
  check("reports the refusal as failed", r.calls.includes('"status":"failed"'));
}
// 2. no off-site upload configured
{
  const r = run({ BACKUP_AGE_RECIPIENT: "age1test" });
  check("refuses to run without an off-site upload", r.status !== 0 && !r.calls.includes("pg_dump"));
}
// 3. happy path
{
  const uploaded = join(root, "uploaded.txt");
  rmSync(uploaded, { force: true });
  const r = run({ BACKUP_AGE_RECIPIENT: "age1test", BACKUP_UPLOAD_CMD: `echo "$1" >> "${uploaded}"` });
  check("a configured backup succeeds", r.status === 0, r.stderr.trim());
  check("dumps the public schema", /pg_dump .*--schema=public/.test(r.calls));
  check("dumps auth users and identities (data only)", /--data-only --table=auth\.users --table=auth\.identities/.test(r.calls));
  check("encrypts both dumps", (r.calls.match(/^age /gm) ?? []).length === 2);
  const names = existsSync(uploaded) ? readFileSync(uploaded, "utf8").trim().split("\n") : [];
  check("uploads both encrypted files", names.length === 2 && names.every((n) => n.endsWith(".age")), names.join(","));
  check("leaves no local copy behind", r.left.length === 0, r.left.join(","));
  check("reports ok", r.calls.includes('"status":"ok"'));
}
// 4. upload failure
{
  const r = run({ BACKUP_AGE_RECIPIENT: "age1test", BACKUP_UPLOAD_CMD: "exit 3" });
  check("a failed upload fails the backup", r.status !== 0);
  check("a failed upload is reported and keeps no plaintext", r.calls.includes('"status":"failed"') && r.left.length === 0, r.left.join(","));
}

rmSync(root, { recursive: true, force: true });
if (failures > 0) process.exit(1);
console.log("Backup script tests passed.");
