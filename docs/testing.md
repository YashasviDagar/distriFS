# Testing and benchmarking

## Running

```bash
npm run typecheck
npm test
```

Tests use Vitest and need no database or running cluster.

## Suites

| File | Scope |
|---|---|
| `tests/chunker.test.ts` | Split, ordering, reconstruction, checksums |
| `tests/placement.test.ts` | Node selection and error cases |
| `tests/internalAuth.test.ts` | HMAC signing, tamper, replay window |
| `tests/storage-node.test.ts` | Storage node API: auth, checksum rejection, 404, delete, corruption, simulated failure |
| `tests/gateway.auth.test.ts` | Register, login, refresh, token type separation, admin guard (Prisma mocked) |
| `tests/failure-recovery.test.ts` | Real storage-node servers on ephemeral ports with an in-memory Prisma stand-in: offline detection, repair onto a spare node, no-op, unrecoverable, corrupt-source handling, retry |

## What is not covered

- No test talks to a real PostgreSQL instance; database behavior is mocked, so Prisma query shapes and migrations are only verified by type checking.
- Upload and download through the gateway with real nodes, concurrent uploads, and the dashboard are verified manually or with the benchmark script, not by automated tests.

## Manual end-to-end check

1. Start PostgreSQL, copy `.env.example` to `.env`, then run `npm run db:migrate` and `npm run db:seed`.
2. `npm run dev` starts the metadata server, three storage nodes, the gateway and the dashboard.
3. Sign in as the seeded admin, upload a file, fail a node, download, trigger recovery.

## Benchmarking

```bash
npm run benchmark
```

`scripts/benchmark.mjs` registers a throwaway user against a running gateway and measures:

- upload and download time and MB/s for each size in `BENCH_SIZES_MB` (default `1,8,32`), with a SHA-256 comparison of the downloaded bytes
- aggregate throughput for `BENCH_CONCURRENCY` (default 4) simultaneous uploads

Variables: `BENCH_API_URL`, `BENCH_SIZES_MB`, `BENCH_CONCURRENCY`, `BENCH_EMAIL`, `BENCH_PASSWORD`. Files created by the run are deleted afterwards. Results print as a table; record them yourself from a real run. To compare replication factors, restart the cluster with `REPLICATION_FACTOR` set to 1, 2 and 3 and rerun. Single-machine numbers reflect local disk and loopback, not a real network.
