# API reference (gateway)

Base URL: `http://localhost:8080`. All bodies are JSON unless noted. Errors use `{ "error": { "code", "message", "details?" } }`.

Authenticated routes need `Authorization: Bearer <access token>`.

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/register` | `{ email, password (min 8) }` | 201 `{ token, refreshToken, user }`; 409 if the email exists |
| POST | `/api/auth/login` | `{ email, password }` | `{ token, refreshToken, user }`; 401 on bad credentials |
| POST | `/api/auth/refresh` | `{ refreshToken }` | New `{ token, refreshToken, user }`; 401 if invalid, expired, or not a refresh token |
| GET | `/api/me` | | Token claims `{ sub, email, role }` |

Access tokens last `JWT_EXPIRES_IN` (default 1 h); refresh tokens last `JWT_REFRESH_EXPIRES_IN` (default 7 d). A refresh token is rejected on normal routes.

## Files (authenticated, owner only)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/files/upload` | `multipart/form-data` with one `file` part. 201 `{ fileId, versionId, versionNo, size, totalChunks }`. MIME type must be in `ALLOWED_MIME_TYPES` |
| POST | `/api/files/:id/versions` | Same multipart body; adds a new version |
| GET | `/api/files` | List the caller's files |
| GET | `/api/files/:id` | Detail with integrity summary and per-chunk replica locations |
| GET | `/api/files/:id/versions` | Version list |
| GET | `/api/files/:id/download?version=N` | Streams bytes; defaults to the current version |
| DELETE | `/api/files/:id` | Soft delete, 204 |
| DELETE | `/api/files/:id/versions/:versionNo` | Delete one version, 204 |

Other users' files return 404.

## Cluster (public)

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{ status: "ok" }` |
| GET | `/api/nodes` | Node list |
| GET | `/api/nodes/:id` | One node by id or name |
| GET | `/api/cluster/status` | Node counts, file totals, replication factor, nodes |
| GET | `/api/cluster/health` | `{ healthy, healthyNodes, totalNodes, offlineNodes, replicationFactor, message }` |

## Admin (role `ADMIN`)

| Method | Path |
|---|---|
| GET | `/api/metrics` |
| POST | `/api/admin/nodes/:id/fail` |
| POST | `/api/admin/nodes/:id/recover` |
| POST | `/api/admin/chunks/:id/corrupt` |
| POST | `/api/admin/recovery/trigger` |

## Error codes

`VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `INTEGRITY_ERROR`, `NODE_UNAVAILABLE` (503), `INSUFFICIENT_STORAGE` (507), `INTERNAL_ERROR` (500). Authoritative list: `packages/shared/src/errors.ts`.

## Internal APIs

Metadata (`:8081`) and storage nodes (`:5001-5003`) are not public. Every call except `/health` must carry the HMAC headers described in `security.md`.
