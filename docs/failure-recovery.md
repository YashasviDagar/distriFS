# Failure detection and recovery

## Heartbeats

Each storage node registers with the metadata server at start-up and then posts a heartbeat every `HEARTBEAT_INTERVAL_MS` (default 5 s) with its current free space. Heartbeat requests are HMAC-signed.

## Detection

`sweepNodeHealth` (`apps/metadata/src/healthMonitor.ts`) runs every `HEALTH_SWEEP_INTERVAL_MS` (default 3 s). A `HEALTHY` node whose `last_heartbeat` is older than `HEARTBEAT_TIMEOUT_MS` (default 15 s), or null, is set to `OFFLINE`. Its `HEALTHY` replicas are flagged `MISSING` and a `NODE_OFFLINE` event is logged. Worst-case detection latency is roughly timeout plus one sweep interval.

## Recovery

`runRecoveryOnce` (`apps/metadata/src/recovery.ts`) runs every `RECOVERY_INTERVAL_MS` (default 10 s) and on demand from the admin API. For each chunk:

1. Count replicas that are `HEALTHY` on `HEALTHY` nodes. If the count meets the replication factor, skip.
2. If none remain, count the chunk as `unrecoverable` and log `RECOVERY_FAILED`.
3. Otherwise pick healthy nodes that do not already hold the chunk, read the chunk from a surviving replica and verify its SHA-256. A replica that fails verification is marked `CORRUPT`.
4. Write the verified bytes to the new node (which re-verifies), insert a `HEALTHY` replica row and log `RECOVERY_COMPLETED`.
5. When the target count is reached, stale `MISSING` rows for the chunk are deleted.

Corrupt bytes are never propagated. A single run reports `{ scanned, repaired, failed, unrecoverable }`. Concurrent runs are prevented by a module-level guard.

## Fault injection (admin only)

| Endpoint | Effect |
|---|---|
| `POST /api/admin/nodes/:id/fail` | Marks the node `OFFLINE`, its replicas `MISSING`, and makes the node return 503 for chunk calls |
| `POST /api/admin/nodes/:id/recover` | Brings the node back and restores its `MISSING` replicas |
| `POST /api/admin/chunks/:id/corrupt` | Flips a byte in one healthy replica and marks it `CORRUPT` |
| `POST /api/admin/recovery/trigger` | Runs a recovery pass immediately |

## Demonstration

1. Upload a file larger than a few chunks.
2. Fail one node on the dashboard. Downloads still succeed from other replicas.
3. Watch the file become degraded, then trigger recovery or wait for the next pass and watch it return to healthy.
4. Corrupt a chunk, download the file, and observe failover plus a `REPLICA_CORRUPT` event.

## Tests

`tests/failure-recovery.test.ts` starts real storage-node servers and exercises detection, repair onto a spare node, no-op when healthy, unrecoverable chunks, refusal to copy corrupt data and retry after a simulated failure ends. `tests/storage-node.test.ts` covers the node API.
