# DistriFS — Distributed File Storage System

A simplified, educational distributed file system that demonstrates the core
concepts behind systems like HDFS, Ceph, and Amazon S3: **file chunking,
metadata management, chunk replication, node health monitoring, failure
detection, automatic recovery, and checksum-based data integrity.**

DistriFS is a 3rd-year Computer Science engineering project. It is **not** a
production replacement for HDFS/Ceph/S3 — it is a manageable implementation
built to make distributed-systems concepts observable, testable, and
demonstrable.

---

## Table of Contents

- [Overview](#overview)
- [Core Concepts Demonstrated](#core-concepts-demonstrated)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Folder Structure](#folder-structure)
- [Database Schema](#database-schema)
- [API Overview](#api-overview)
- [How It Works](#how-it-works)
- [Getting Started](#getting-started)
- [Running a Local Multi-Node Cluster](#running-a-local-multi-node-cluster)
- [Demonstration Procedure](#demonstration-procedure)
- [Testing](#testing)
- [Performance Benchmarking](#performance-benchmarking)
- [Development Roadmap](#development-roadmap)
- [Security](#security)
- [Known Limitations](#known-limitations)
- [Future Improvements](#future-improvements)
- [Documentation](#documentation)

---

## Overview

When a user uploads a file, DistriFS:

1. Streams the file and splits it into fixed-size **chunks** (default 4 MB).
2. Computes a **SHA-256 checksum** for every chunk.
3. Distributes each chunk across multiple **storage nodes** according to a
   placement algorithm.
4. Stores **replicas** of each chunk (configurable replication factor) so the
   system survives node failures.
5. Records only *metadata* (files, chunks, nodes, replicas, checksums) in
   PostgreSQL — never the file bytes themselves.

On download, DistriFS looks up chunk locations, selects a healthy replica for
each chunk, verifies checksums, reconstructs the file in order, and streams it
back — transparently tolerating failed nodes.

---

## Core Concepts Demonstrated

| Concept | Where It Appears |
|---|---|
| File chunking | Streaming split/merge in `packages/chunker` |
| Metadata management | Metadata server + PostgreSQL schema |
| Replication | Configurable replication factor, distinct-node placement |
| Node health monitoring | Periodic heartbeats + health monitor |
| Failure detection | Heartbeat timeout → node marked `OFFLINE` |
| Automatic recovery | Background worker restores replication factor |
| Data integrity | SHA-256 verified on upload, download, replication, recovery |
| Fault tolerance | Failover download from healthy replicas |
| Scalability | Add storage nodes without changing metadata layout |
| Concurrency | Concurrent uploads/downloads/recovery with locking |

---

## Architecture

```
                         ┌───────────────┐
                         │    Client     │
                         └───────┬───────┘
                                 │
                                 ▼
                         ┌───────────────┐
                         │  API Gateway  │
                         └───────┬───────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ┌───────────────┐         ┌───────────────┐
            │ Metadata      │         │ Storage Node  │
            │ Server        │         │ Manager       │
            └───────┬───────┘         └───────┬───────┘
                    │                         │
                    │              ┌──────────┼──────────┐
                    │              ▼          ▼          ▼
                    │           Node 1      Node 2      Node 3
                    │
                    ▼
              Metadata DB (PostgreSQL)
```

### Component Responsibilities

| Component | Responsibility | Behavior on Failure |
|---|---|---|
| **API Gateway** | Public entry point. Authenticates users, validates input, extracts metadata, drives chunking, requests placement, fans out chunk writes, streams downloads. | Stateless; can be restarted. |
| **Metadata Server** | Knows *where* every chunk lives. Owns placement logic, heartbeat monitor, and background recovery. Stores metadata only. | No new placements/reads; stored data intact. Single point of failure. |
| **Storage Node** | Independent service. Registers, heartbeats, stores/returns chunks, verifies checksums, reports disk usage. Deals only with chunks, never whole files. | Its replicas become unavailable; other nodes serve traffic; recovery restores replication. |
| **Metadata DB** | Relational truth: files, versions, chunks, nodes, replicas, events, metrics. | Read-only/frozen until restored. |
| **Web Dashboard** | Monitoring, file management, fault-injection controls, cluster visualization. | APIs still function without it. |

---

## Technology Stack

**Frontend**
- Next.js + React + TypeScript
- Tailwind CSS + shadcn/ui
- Recharts

**Backend**
- Node.js + TypeScript
- Fastify (API Gateway, Metadata Server, Storage Nodes)

**Database**
- PostgreSQL (metadata only — file chunks are never stored in the database)

**Storage**
- Each storage node owns a local directory:
  ```
  storage/node-1/data/
  storage/node-2/data/
  storage/node-3/data/
  ```

**Tooling**
- npm workspaces (monorepo)
- Prisma (schema, migrations, typed client)
- Vitest (unit + integration tests)

---

## Folder Structure

```
distriFS/
├── package.json                 # npm workspaces root + scripts
├── tsconfig.base.json
├── .env.example                 # CHUNK_SIZE, REPLICATION_FACTOR, HB_INTERVAL, HB_TIMEOUT
├── apps/
│   ├── gateway/                 # Fastify :8080 — user APIs + auth
│   ├── metadata/                # Fastify :8081 — placement, health, recovery
│   ├── storage-node/            # Fastify :500x — chunk store (3 instances)
│   └── web/                     # Next.js dashboard
├── packages/
│   ├── shared/                  # types, enums, config loader, error codes
│   ├── db/                      # Prisma schema + client + migrations + seed
│   ├── chunker/                 # streaming chunk split/merge + SHA-256
│   └── sdk/                     # typed gateway client
├── scripts/                     # start-cluster, fault-inject, benchmark, seed
├── tests/                       # integration + failure + performance
├── docs/                        # architecture, system-design, api, security, ...
└── storage/                     # node data dirs (gitignored)
```

---

## Database Schema

```
users            (id, email, password_hash, role, created_at)
files            (id, owner_id, name, size, chunk_size, total_chunks,
                  current_version_id, created_at, updated_at, deleted_at)
file_versions    (id, file_id, version_no, size, total_chunks, created_at)
chunks           (id, version_id, chunk_index, size, checksum, created_at)
storage_nodes    (id, node_name, host, port, status, capacity_bytes,
                  available_bytes, last_heartbeat, created_at)
chunk_replicas   (id, chunk_id, node_id, status, stored_checksum, created_at)
events           (id, type, node_id, chunk_id, message, created_at)
benchmark_runs   (id, label, replication_factor, op, bytes, duration_ms,
                  chunk_count, created_at)
```

**Relationships**
- `users 1—* files` — authorization boundary.
- `files 1—* file_versions` — versioning; `current_version_id` points to the active version.
- `file_versions 1—* chunks` — ordered by `chunk_index`.
- `chunks *—* storage_nodes` — many-to-many via `chunk_replicas` (carries replica status and per-node checksum).
- `storage_nodes 1—* chunk_replicas`.
- `events` and `benchmark_runs` are append-only observability tables.

**Enums**
- Replica status: `PENDING | HEALTHY | CORRUPT | MISSING | QUARANTINED`
- Node status: `HEALTHY | OFFLINE | DECOMMISSIONED`

A full ER diagram lives in `docs/database-design.md`.

---

## API Overview

### User APIs (Gateway, JWT-protected)
```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/files/upload
GET    /api/files
GET    /api/files/:id
GET    /api/files/:id/download
GET    /api/files/:id/versions
DELETE /api/files/:id
DELETE /api/files/:id/versions/:versionNo
```

### Metadata / Internal APIs (service-token protected)
```
POST   /internal/placement
GET    /internal/chunks/:id/locations
POST   /internal/chunks/:id/replicas
GET    /internal/cluster/status
```

### Storage-Node APIs (internal only)
```
POST   /register
POST   /heartbeat
PUT    /chunks/:chunkId
GET    /chunks/:chunkId
DELETE /chunks/:chunkId
GET    /health
```

### Admin / Fault-Injection APIs (role=admin)
```
POST   /api/admin/nodes/:id/fail
POST   /api/admin/nodes/:id/recover
POST   /api/admin/chunks/:id/corrupt
POST   /api/admin/recovery/trigger
GET    /api/cluster/health
GET    /api/metrics
```

Full request/response schemas are documented in `docs/api.md`.

---

## How It Works

### Upload Flow
```
User selects file
        ↓
API Gateway
        ↓
File Metadata Extraction
        ↓
File Chunking (streaming)
        ↓
Chunk Hashing (SHA-256)
        ↓
Replication / Placement
        ↓
Storage Nodes
        ↓
Metadata Database
        ↓
Upload Complete
```

### Download Flow
```
User requests file
        ↓
Metadata Server → chunk locations
        ↓
Select a healthy replica per chunk
        ↓
Download chunks
        ↓
Verify checksums
        ↓
Order chunks by index
        ↓
Reconstruct file
        ↓
Stream to user
```

If a node is unavailable, its chunks are fetched from another healthy replica —
the user does not notice the failure.

### Failure Detection & Recovery
- Nodes send a heartbeat every `HB_INTERVAL` (default 5s).
- The metadata server marks a node `OFFLINE` if no heartbeat arrives within
  `HB_TIMEOUT` (default 15s).
- A background recovery worker finds chunks with fewer than
  `REPLICATION_FACTOR` healthy replicas and copies them from a healthy replica
  to a new healthy node, verifying checksums. Recovery runs without blocking
  user requests.

### Placement
Starts with **round-robin** across healthy nodes; replication selects distinct
nodes per chunk. Optional extensions: **least-used storage** and **consistent
hashing**. Design tradeoffs are documented in `docs/replication.md`.

---

## Getting Started

### Prerequisites
- Node.js 20+ and npm
- PostgreSQL 16+

### Setup
```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#    set DATABASE_URL and secrets in .env

# 3. Create database schema and seed data
npm run db:migrate
npm run db:seed

# 4. Start the full cluster (metadata + 3 nodes + gateway + web)
npm run dev
```

Default ports:

| Service | Port |
|---|---|
| Web dashboard | 3000 |
| API Gateway | 8080 |
| Metadata Server | 8081 |
| Storage Node 1 | 5001 |
| Storage Node 2 | 5002 |
| Storage Node 3 | 5003 |

---

## Running a Local Multi-Node Cluster

For a local demonstration, each storage node runs as a separate process on the
same machine with its own data directory:

```
Node 1 → storage/node-1/data → :5001
Node 2 → storage/node-2/data → :5002
Node 3 → storage/node-3/data → :5003
```

`npm run dev` starts all of them via the `scripts/start-cluster` script. Nodes
register with the metadata server on boot and begin heartbeating immediately.

---

## Demonstration Procedure

1. Start the cluster and confirm three `HEALTHY` nodes.
2. Upload `example.pdf` and show the chunk → node placement map.
3. Download the file successfully.
4. Simulate `Node 1 → OFFLINE` and show the file is still downloadable.
5. Show recovery: replication factor drops, background worker copies a healthy
   replica, replication is restored.
6. Corrupt a chunk and demonstrate checksum-based detection and repair.

This scenario is the centerpiece of the project presentation.

---

## Testing

```bash
npm test
```

Coverage includes:

- **File handling** — upload, download, delete, large files, empty files.
- **Chunking** — correct chunk count, correct ordering, byte-identical reconstruction.
- **Replication** — correct replica count, distinct placement, replica recovery.
- **Failure** — node failure, heartbeat timeout, recovery, multiple failures.
- **Integrity** — checksum correctness, corruption detection, recovery from a healthy replica.
- **Authorization** — users cannot access files belonging to other users.

See `docs/testing.md` for the full strategy.

---

## Performance Benchmarking

A scripted harness (`scripts/benchmark.ts`) measures real behavior:

- Upload throughput, download throughput
- Chunking overhead, replication overhead
- Recovery time, node failure detection latency
- Metadata lookup latency, storage utilization

Results are recorded in the `benchmark_runs` table and compared across
replication factors **1, 2, and 3**. All figures come from actual runs — none
are fabricated. Methodology is documented in `docs/testing.md`.

---

## Development Roadmap

| Phase | Deliverable |
|---|---|
| 0. Setup | Workspace scaffold, Prisma, config, cluster start script |
| 1. Basic Storage | Upload/download to local disk + DB metadata |
| 2. Chunking | Streaming split/merge, SHA-256, chunk metadata |
| 3. Multiple Nodes | Storage-node service, registration, heartbeats |
| 4. Replication | Placement algorithm, replica tracking |
| 5. Fault Tolerance | Failure detection, failover, automatic recovery |
| 6. Integrity | Checksum verification, corruption detection, repair |
| 7. Dashboard | Cluster visualization, metrics, fault-injection controls |
| 8. Testing & Docs | Unit/integration/failure tests, benchmarks, documentation |

---

## Security

- JWT authentication with short-lived access tokens and refresh.
- Password hashing (argon2/bcrypt).
- Per-file ownership checks (authorization).
- Internal node/metadata endpoints bound to localhost and protected by a shared-secret HMAC header — never exposed publicly.
- Input validation, file-size limits, MIME allowlist, rate limiting.
- Secrets supplied via environment variables; HTTPS-ready architecture.

Details and threat model: `docs/security.md`.

---

## Known Limitations

- The metadata server and database are **single points of failure** (no consensus/HA).
- Replication only — **no erasure coding** (storage overhead equals the replication factor).
- Single-host simulation; no real network partitions or inter-host latency.
- No cross-region/global replication and no distributed transactions.
- Recovery is eventually consistent, not instantaneous.

---

## Future Improvements

- Consistent-hashing based rebalancing.
- Erasure coding to reduce storage overhead.
- Raft-based metadata high availability.
- Real multi-host deployment.
- S3-compatible gateway.
- Prometheus/Grafana metrics integration.
- Object lifecycle and retention policies.

---

## Documentation

| Document | Contents |
|---|---|
| `docs/architecture.md` | System architecture and component interactions |
| `docs/system-design.md` | Design decisions and rationale |
| `docs/database-design.md` | Schema and ER diagram |
| `docs/chunking.md` | Chunking strategy and streaming |
| `docs/replication.md` | Placement and replication algorithms |
| `docs/failure-recovery.md` | Heartbeats, detection, and recovery |
| `docs/api.md` | Full API specification |
| `docs/security.md` | Authentication, authorization, threat model |
| `docs/testing.md` | Test strategy and benchmarking methodology |

---

## License

Developed as an academic project for educational purposes.
