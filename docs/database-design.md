# Database design

Source of truth: `packages/db/prisma/schema.prisma`.

```mermaid
erDiagram
  users ||--o{ files : owns
  files ||--o{ file_versions : has
  file_versions ||--o{ chunks : splits_into
  chunks ||--o{ chunk_replicas : replicated_as
  storage_nodes ||--o{ chunk_replicas : holds

  users { uuid id PK
          string email UK
          string password_hash
          enum role }
  files { uuid id PK
          uuid owner_id FK
          string name
          bigint size
          int chunk_size
          int total_chunks
          int current_version_no
          timestamp deleted_at }
  file_versions { uuid id PK
                  uuid file_id FK
                  int version_no
                  bigint size
                  int total_chunks }
  chunks { uuid id PK
           uuid version_id FK
           int chunk_index
           int size
           string checksum }
  storage_nodes { uuid id PK
                  string node_name UK
                  string host
                  int port
                  enum status
                  bigint capacity_bytes
                  bigint available_bytes
                  timestamp last_heartbeat }
  chunk_replicas { uuid id PK
                   uuid chunk_id FK
                   uuid node_id FK
                   enum status
                   string stored_checksum }
```

## Other tables

- `events`: append-only log (node offline, recovery, fault injection, uploads) shown on the dashboard.
- `benchmark_runs`: reserved for recorded benchmark results; the current `scripts/benchmark.mjs` prints results to the console and does not write to it yet.

## Constraints and indexes

- `(file_id, version_no)`, `(version_id, chunk_index)` and `(chunk_id, node_id)` are unique, so a chunk can never have two replicas on the same node.
- Deleting a file version cascades to its chunks and replicas.
- Indexes on owner, file, version, node, event type and event time.

## Enums

- `UserRole`: USER, ADMIN
- `NodeStatus`: HEALTHY, OFFLINE, DECOMMISSIONED
- `ReplicaStatus`: PENDING, HEALTHY, CORRUPT, MISSING, QUARANTINED
