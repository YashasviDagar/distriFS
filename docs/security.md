# Security

## Authentication and authorization

- Passwords are hashed with bcrypt (cost 10) and never returned.
- Login and register return a short-lived access JWT and a longer-lived refresh JWT. Tokens carry a `typ` claim; the gateway refuses refresh tokens on normal routes and access tokens on `/api/auth/refresh`.
- File routes filter by owner id, so other users' files appear as 404.
- Admin routes require the `ADMIN` role (403 otherwise). The seed script creates the first admin from `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.

## Internal service authentication

Gateway, metadata server and storage nodes sign every request:

- `x-internal-timestamp`: milliseconds since epoch
- `x-internal-signature`: hex HMAC-SHA256 of `<timestamp>.<METHOD>.<path>` keyed with `INTERNAL_SERVICE_TOKEN`

Receivers verify with a constant-time comparison and reject timestamps more than 60 s from their clock. The query string and body are not signed (this keeps chunk streaming cheap). `/health` is unauthenticated. Implementation: `packages/shared/src/internalAuth.ts`, tests in `tests/internalAuth.test.ts`.

## Input and abuse controls

- zod validation on credentials and internal payloads.
- Upload limits: `MAX_FILE_SIZE_BYTES`, single file per request, MIME allowlist `ALLOWED_MIME_TYPES`.
- Global rate limit of 300 requests per minute per client on the gateway.
- Checksums are verified on node upload, download and recovery.
- CORS restricted to `CORS_ORIGIN`.

## Secrets

All secrets come from environment variables. Only `.env.example` is tracked. Replace `JWT_SECRET` and `INTERNAL_SERVICE_TOKEN` defaults before any real deployment.

## Threat model

| Threat | Mitigation | Residual risk |
|---|---|---|
| Unauthenticated access to files | JWT plus owner check | Tokens are bearer tokens in browser local storage on the dashboard; XSS would expose them |
| Direct calls to storage nodes or metadata | HMAC with replay window | Within 60 s a captured request can be replayed; no TLS in the default local setup |
| Bit rot or tampered chunk | SHA-256 verification and failover | Metadata database compromise defeats checksums |
| Large-upload DoS | Size limit, rate limit | No per-user quota |
| Credential stuffing | bcrypt, global rate limit | No per-account lockout |
| Stolen refresh token | Short expiry | Refresh tokens are stateless, so they cannot be revoked before expiry |

Internal ports should be bound to localhost or a private network. The architecture is HTTPS-ready behind a reverse proxy but TLS is not configured here.
