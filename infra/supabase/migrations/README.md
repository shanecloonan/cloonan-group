# Supabase migrations — cloonan-group / MoneyFund

Each `.sql` file in this folder is a self-contained, idempotent migration
against the cloonan-group Supabase project (`xvjqxjakckkbfsdrntwk`).

## Which one do I need to run right now?

Just `2026-04-25-permawrite-repo-uniqueness.sql`. It:

- Adds a `genesis_tx` column to `permawrite_repos` (stores the Arweave TX id
  of the on-chain "repo created" declaration).
- Adds a **case-insensitive unique index** on `display_name` so no two users
  can ever have a repo with the same name.
- Adds a unique index on `slug`.
- Adds a permissive SELECT policy so the client-side duplicate-name
  pre-check works before insert.

The app (`lib/permawrite-repos.ts → createRepo`) is resilient to the
migration NOT being applied — it falls back to inserting without
`genesis_tx` and relies on client-side checks. But uniqueness is only
truly guaranteed platform-wide once the SQL has run.

---

## Three ways to apply it

Pick whichever is easiest — all do the same thing.

### 1. Dashboard (30 seconds, zero setup)

1. Open <https://supabase.com/dashboard/project/xvjqxjakckkbfsdrntwk/sql/new>
2. Paste the contents of `2026-04-25-permawrite-repo-uniqueness.sql`
3. Click **Run**

Done.

### 2. `npm run db:migrate` (automatable, recommended for repeat use)

One-time setup:

```bash
# 1. Create a Personal Access Token at
#    https://supabase.com/dashboard/account/tokens
# 2. Put it in .env.local (see .env.example):
#    SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxx
#    SUPABASE_PROJECT_REF=xvjqxjakckkbfsdrntwk
```

Then from the repo root:

```bash
npm run db:migrate
```

The runner (`scripts/apply-supabase-migration.mjs`) splits the SQL on
top-level statement boundaries, POSTs each to Supabase's
`/v1/projects/{ref}/database/query` endpoint, and stops on the first error
with the full statement printed for easy debugging.

### 3. Supabase CLI (if you already use it)

```bash
supabase link --project-ref xvjqxjakckkbfsdrntwk
supabase db execute < infra/supabase/migrations/2026-04-25-permawrite-repo-uniqueness.sql
```

---

## Why isn't this done via MCP?

The Cursor Supabase MCP in this workspace isn't registered right now —
its tools folder only contains the auth stub. The fallback path is the
Management API via personal access token (option 2 above), which gives
us the same capability from any terminal.

The project's publishable (anon) key — `sb_publishable_...` — cannot run
DDL. Supabase enforces that at the API layer. Only a personal access
token or service-role key can alter schema.

---

## Conventions

- File name format: `YYYY-MM-DD-short-summary.sql`.
- Every file must be **idempotent** (`create ... if not exists`, `alter ...
  add column if not exists`, guard clauses for constraints/policies).
- Every file must be **stand-alone**: no dependencies on other migrations
  beyond the base schema that already exists in the project.
- Never reach for `drop` unless guarded and reversible — production data
  is permanent.
