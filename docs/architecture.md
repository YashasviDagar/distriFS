# Architecture

DistriFS is split into four runtime services plus shared packages.

| Component | Path | Role |
|---|---|---|
| API gateway | `apps/gateway` | Public REST API, JWT auth, upload/download orchestration, admin APIs |
| Metadata server | `apps/metadata` | Placement, node registry, heartbeat monitor, background recovery; the only service that mutates cluster state |
| Storage nodes | `apps/storage-node` | Store chunk bytes on local disk; three processes on ports 5001-5003 |
| Dashboard | `apps/web` | Next.js UI for cluster state, files and fault injection |
| `packages/shared` | | Types, config loader (zod), error classes, placement algorithm, internal HMAC auth |
| `packages/chunker` | | Streaming split/merge and SHA-256 helpers |
| `packages/db` | | Prisma schema, migrations, client, seed |

## Data placement rule

All metadata lives in PostgreSQL. Chunk bytes live only on storage-node disks. The gateway never persists file bytes.

## Upload flow

1. Client sends a multipart upload to the gateway with a bearer token.
2. The gateway streams the file through `chunkStream`, holding at most one chunk per in-flight task in memory.
3. For each chunk the gateway asks the metadata server to create a chunk row and choose target nodes (`POST /internal/chunks`).
4. The gateway writes the chunk to every target node in parallel; each node verifies the supplied SHA-256 before storing it.
5. The gateway reports per-replica outcomes (`HEALTHY` or `MISSING`) to the metadata server. A chunk with zero stored replicas fails the upload and the partial file is cleaned up.

## Download flow

1. The gateway loads the version's chunks and replicas, ordered by chunk index.
2. For each chunk it tries healthy replicas on healthy nodes in order, verifying SHA-256 on read.
3. A replica that fails verification is marked `CORRUPT` and the next replica is used.
4. If no valid replica exists the download fails with an integrity or node-unavailable error.

## Background processes (metadata server)

- Health monitor: marks nodes `OFFLINE` after a heartbeat timeout and flags their replicas `MISSING`.
- Recovery loop: copies chunks from healthy replicas to spare healthy nodes until the replication factor is met.

## Trust boundaries

Clients only talk to the gateway. Gateway, metadata server and storage nodes talk to each other with HMAC-signed requests (see `security.md`).
