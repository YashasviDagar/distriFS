# System design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language / runtime | TypeScript (strict), Node 20+ | One language across services and UI; shared types |
| Services | Fastify | Low overhead, first-class streaming and plugin ecosystem |
| Metadata store | PostgreSQL via Prisma | Relational model fits file, version, chunk and replica relationships; unique constraints prevent duplicate replicas |
| Chunk size | 4 MB default (`CHUNK_SIZE_BYTES`) | Balances metadata volume against parallelism |
| Replication | Full copies, factor from `REPLICATION_FACTOR` (default 2) | Simple, observable; erasure coding is out of scope |
| Placement | Round-robin or least-used, distinct nodes per chunk | See `replication.md` |
| Integrity | SHA-256 per chunk, checked on node upload, download and recovery | Detects bit rot and tampering end to end |
| Failure detection | Heartbeat timeout | Simple and explainable |
| Service-to-service auth | HMAC over timestamp, method and path | Replay window limited; no request body hashing so chunk streams stay cheap |
| Deletes | Soft delete of file rows | Allows later garbage collection; chunk bytes are not yet reclaimed |

## Consistency model

The metadata server is the source of truth. Replica rows begin `PENDING` and are confirmed by the gateway after node writes succeed. Reads only use replicas that are `HEALTHY` on `HEALTHY` nodes. Recovery is eventually consistent: under-replicated chunks stay readable from remaining replicas until the next recovery pass.

## Concurrency

- Uploads process up to `UPLOAD_CONCURRENCY` chunks at once using `p-limit`, with a bounded in-flight set so memory stays proportional to concurrency times chunk size.
- Recovery runs one pass at a time (a module-level guard prevents overlap).
