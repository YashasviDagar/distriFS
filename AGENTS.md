# AGENTS.md — Working rules for DistriFS

These rules are binding for any AI assistant or contributor working in this
repository.

## 1. Commit and push every change

- After **every** file change (create, edit, delete), stage, commit, and push.
- Remote: `origin` → `https://github.com/YashasviDagar/distriFS.git`
- Branch: `main` (tracking `origin/main`).
- Use Conventional Commits:
  - `feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `test: ...`,
    `chore: ...`, `refactor(scope): ...`
- One logical change per commit. Do not batch unrelated work.
- Verify the working tree is clean before moving on:
  ```
  git status
  git add -A
  git commit -m "type(scope): message"
  git push origin main
  ```

## 2. Never touch `.env` directly

- `.env` contains real secrets and **must never be read, printed, edited, or
  committed**.
- Only **`.env.example`** is tracked. Add new configuration keys there with
  placeholder values.
- Application code reads configuration from `process.env` at runtime (loaded
  via `dotenv` in local development).
- Never log secrets, tokens, or credentials.

## 3. General engineering rules

- TypeScript strict mode. No `any` unless justified in a comment.
- Do not add code comments unless they clarify non-obvious logic.
- Keep components small and single-purpose; mirror existing patterns.
- Prefer streaming over buffering entire files.
- All metadata goes to PostgreSQL; chunk bytes live only on storage-node disks.
- Run `npm run typecheck` and `npm test` before committing when tests exist.

## 4. Architecture at a glance

- `apps/gateway` — public API, auth, chunk orchestration.
- `apps/metadata` — placement, heartbeat monitor, recovery, DB owner.
- `apps/storage-node` — chunk storage (3 processes on ports 5001-5003).
- `apps/web` — Next.js dashboard.
- `packages/shared` — types, config, errors.
- `packages/chunker` — streaming split/merge + SHA-256.
- `packages/db` — Prisma schema and client.
