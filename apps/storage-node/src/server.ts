import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { sha256Hex } from "@distrifs/chunker";
import { ErrorCodes } from "@distrifs/shared";
import { ChunkStore } from "./chunkStore";
import type { StorageNodeRuntimeConfig } from "./config";

export interface NodeState {
  failed: boolean;
}

export async function buildServer(
  config: StorageNodeRuntimeConfig,
  store: ChunkStore,
  state: NodeState,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "warn" } });

  await app.register(cors, { origin: true });

  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health" || request.url.startsWith("/health?")) return;
    if (request.headers["x-internal-token"] !== config.internalToken) {
      reply.code(401).send({ error: { code: ErrorCodes.UNAUTHORIZED, message: "Invalid internal token" } });
    }
  });

  app.addHook("preHandler", async (request, reply) => {
    if (state.failed && (request.url.startsWith("/chunks") || request.url.startsWith("/stats"))) {
      reply
        .code(503)
        .send({ error: { code: ErrorCodes.NODE_UNAVAILABLE, message: `Node ${config.id} is simulated as failed` } });
    }
  });

  app.get("/health", async () => ({
    status: state.failed ? "FAILED" : "ok",
    nodeId: config.id,
    nodeName: config.id,
    host: config.host,
    port: config.port,
    chunkCount: store.chunkCount,
    usedBytes: store.usedBytes,
    availableBytes: store.availableBytes,
  }));

  app.get("/stats", async () => ({
    nodeId: config.id,
    chunkCount: store.chunkCount,
    usedBytes: store.usedBytes,
    availableBytes: store.availableBytes,
    capacityBytes: config.capacityBytes,
    chunkIds: store.listChunkIds(),
  }));

  app.put("/chunks/:chunkId", async (request, reply) => {
    const { chunkId } = request.params as { chunkId: string };
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      return reply.code(400).send({ error: { code: ErrorCodes.VALIDATION_ERROR, message: "Expected binary body" } });
    }
    const expected = request.headers["x-chunk-checksum"];
    const actual = sha256Hex(body);
    if (typeof expected === "string" && expected.length > 0 && expected !== actual) {
      return reply
        .code(400)
        .send({ error: { code: ErrorCodes.INTEGRITY_ERROR, message: "Chunk checksum mismatch on upload" } });
    }
    if (body.length > store.availableBytes) {
      return reply
        .code(507)
        .send({ error: { code: ErrorCodes.INSUFFICIENT_STORAGE, message: "Not enough disk space on node" } });
    }
    await store.put(chunkId, body);
    return { chunkId, size: body.length, checksum: actual };
  });

  app.get("/chunks/:chunkId", async (request, reply) => {
    const { chunkId } = request.params as { chunkId: string };
    if (!store.has(chunkId)) {
      return reply.code(404).send({ error: { code: ErrorCodes.NOT_FOUND, message: "Chunk not found" } });
    }
    const data = await store.get(chunkId);
    reply.header("content-type", "application/octet-stream");
    reply.header("x-chunk-checksum", sha256Hex(data));
    return reply.send(data);
  });

  app.delete("/chunks/:chunkId", async (request) => {
    const { chunkId } = request.params as { chunkId: string };
    await store.delete(chunkId);
    return { deleted: chunkId };
  });

  app.post("/internal/admin/fail", async () => {
    state.failed = true;
    return { nodeId: config.id, failed: true };
  });

  app.post("/internal/admin/recover", async () => {
    state.failed = false;
    return { nodeId: config.id, failed: false };
  });

  app.post("/internal/admin/chunks/:chunkId/corrupt", async (request, reply) => {
    const { chunkId } = request.params as { chunkId: string };
    if (!store.has(chunkId)) {
      return reply.code(404).send({ error: { code: ErrorCodes.NOT_FOUND, message: "Chunk not found" } });
    }
    await store.corrupt(chunkId);
    return { chunkId, corrupted: true };
  });

  return app;
}
