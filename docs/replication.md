# Placement and replication

Implementation: `packages/shared/src/placement.ts`, used by `apps/metadata`.

## `selectNodes(nodes, chunkIndex, options)`

1. Keep only `HEALTHY` nodes that are not in `excludeNodeIds`.
2. If fewer than `replicationFactor` remain, fail with `INSUFFICIENT_STORAGE` (HTTP 507). Uploads are refused rather than silently under-replicated.
3. Order the eligible nodes:
   - `round-robin` (default): by node name. The starting index rotates with `chunkIndex`, so consecutive chunks begin on different nodes.
   - `least-used`: by free space descending, ties broken by name.
4. Take `replicationFactor` consecutive nodes from the ordered list, wrapping around. Replicas of one chunk therefore always sit on distinct nodes.

## Replica lifecycle

| Status | Meaning |
|---|---|
| `PENDING` | Row created at placement time, bytes not yet confirmed |
| `HEALTHY` | Stored and verified |
| `MISSING` | Node offline, simulated failure, or write failed |
| `CORRUPT` | Checksum mismatch detected on read |
| `QUARANTINED` | Reserved for manual isolation |

## Replication factor

`REPLICATION_FACTOR` (default 2) applies to new chunks and is the target the recovery worker restores. Setting it above the number of nodes makes placement fail with 507.

## Reads

The gateway uses only replicas that are `HEALTHY` on `HEALTHY` nodes, in creation order, and fails over to the next on error or checksum mismatch.

## Tests

`tests/placement.test.ts` covers distinctness, rotation, exclusion and insufficient-node errors.
