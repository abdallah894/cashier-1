# Operations runbook

## Monitoring
- `GET /api/health` is public and cheap (liveness; the database answer is cached for 5 seconds). `GET /api/health?deep=1` with `Authorization: Bearer $OPS_API_TOKEN` also checks the database and AI providers.
- A GitHub Actions schedule (`.github/workflows/ops-cron.yml`, every 30 minutes; needs the variable `POS_APP_URL` and the secret `CRON_SECRET`) calls `/api/ops/check`, authenticated by `CRON_SECRET`. Vercel's free plan allows only one cron a day, so it is not used. A failed run emails you from GitHub. It evaluates `ops_alerts()` in SQL and posts new alerts to `ALERT_WEBHOOK_URL`.
- Server errors are logged as structured, redacted JSON and recorded in `ops_events`; `ERROR_WEBHOOK_URL` receives the critical ones.
- Alerts: stuck offline sync backlog, rejected offline sales, failed payments awaiting resolution, error spikes, missing/failed backup, integrity failures.

## Security signals in the logs
- `csp_violation`: the browser's CSP reported something it would block (see `docs/security.md`). A new one right after a deploy usually means a new external address the policy does not allow.
- `ip_rate_limit_unavailable`: the shared rate limiter could not reach the database (requests were let through).
- `client_render_error`: a page crashed in someone's browser; the same line goes to `ERROR_WEBHOOK_URL`.
- Responses of `429` on `/api/ops/*` or `/api/health` come from the per-IP limits.

## Backups and restore drill
1. Daily: run `scripts/backup-db.sh` from a scheduler (needs `SUPABASE_DB_URL`, `APP_URL`, `OPS_API_TOKEN`). It makes **two** dumps: the `public` schema and the **data of `auth.users` / `auth.identities`** (staff cannot sign in without them, because `profiles.id` references `auth.users`). Both are encrypted (`BACKUP_AGE_RECIPIENT` for `age`, or `BACKUP_GPG_RECIPIENT`) and uploaded off-site with `BACKUP_UPLOAD_CMD` (for example `rclone copyto "$1" remote:pos-backups/$(basename "$1")`). The script refuses to run without both, and deletes the local copies after a successful upload. It reports to `/api/ops/backup-result`; no report in 36 h raises `backup_overdue`. Keep the **age private key** somewhere other than the machine that makes backups (password manager + a printed copy in the safe): without it the backups cannot be opened.
2. Also keep Supabase's own PITR/daily backups enabled (paid plans).
3. Quarterly drill: create a scratch Supabase project, decrypt the two files (`age -d -i key.txt -o x.dump x.dump.age`), restore **auth first, then public**:
   `pg_restore --no-owner --data-only --disable-triggers -d "$SCRATCH_DB_URL" pos-<ts>-auth.dump` then `pg_restore --no-owner -d "$SCRATCH_DB_URL" pos-<ts>.dump`.
   Then `RESTORE_SUPABASE_URL=... RESTORE_SERVICE_ROLE_KEY=... npx tsx scripts/restore-verify.ts` (checks the integrity rules **and** that every active staff profile has a login account). Finally sign in as a real staff member on the scratch project. Record the date and result. Never restore over production without a second operator and a fresh backup of the current state.

## Migration rollout
1. CI runs `scripts/validate-migrations.ts` (naming, RLS on every table, pinned `search_path`, no unreviewed destructive SQL, types not drifted).
2. Apply with `supabase db push` outside trading hours; additive first, destructive changes only after a release that no longer reads the old shape (mark them `-- safety: destructive change reviewed`).
3. Regenerate `lib/supabase/database.types.ts` (`npm run db:types`) and commit it.
4. Rollback: migrations are forward-only. Fix forward with a new migration; for data loss restore from backup per above.

## Incidents
- **Register cannot reach the server**: sales queue offline automatically; confirm the till shows the queue, restore connectivity, watch it drain. Rejected rows appear in Offline sales for a manager.
- **AI assistant down / quota**: advisory only; the register is unaffected. Check `/api/health?deep=1` for provider state; rotate `GROQ_API_KEY`/`GEMINI_API_KEY` if needed.
- **Failed/unknown card payment**: reconcile on `/payments` against the terminal slip before retrying the sale.
- **Leaked key**: rotate in Supabase/Vercel immediately, redeploy, review `audit_events` for the exposure window.
- **Integrity alert**: run `select * from verify_database_integrity()` as service role, find the failing check, stop trading changes that touch that area, fix forward.
