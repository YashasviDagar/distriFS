import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { prisma } from "@distrifs/db";
import {
  AppError,
  ErrorCodes,
  EventType,
  NodeStatus,
  ReplicaStatus,
  getConfig,
  selectNodes,
  type PlacementStrategy,
} from "@distrifs/shared";
import { logEvent } from "./events";
import { startHealthMonitor, sweepNodeHealth } from "./healthMonitor";
import { startRecoveryLoop, triggerRecovery } from "./recovery";
import { corruptChunk, setNodeFailure } from "./storageClient";

function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid request body", 400, result.error.flatten());
  }
  return result.data;
}

const registerSchema = z.object({
  nodeName: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive(),
  capacityBytes: z.number().int().nonnegative(),
  availableBytes: z.number().int().nonnegative(),
});

const heartbeatSchema = z.object({
  nodeId: z.string().optional(),
  nodeName: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive(),
  capacityBytes: z.number().int().nonnegative(),
  availableBytes: z.number().int().nonnegative(),
  status: z.enum(["HEALTHY", "OFFLINE", "DECOMMISSIONED"]).optional(),
});

const placementSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  replicationFactor: z.number().int().positive().optional(),
  excludeNodeIds: z.array(z.string()).optional(),
  strategy: z.enum(["round-robin", "least-used"]).optional(),
});

const createChunkSchema = z.object({
  versionId: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  checksum: z.string().min(1),
  replicationFactor: z.number().int().positive().optional(),
  strategy: z.enum(["round-robin", "least-used"]).optional(),
});

const confirmSchema = z.object({
  replicas: z
    .array(
      z.object({
        nodeId: z.string().min(1),
        storedChecksum: z.string().nullable().optional(),
        status: z.enum(["PENDING", "HEALTHY", "CORRUPT", "MISSING", "QUARANTINED"]).optional(),
      }),
    )
    .min(1),
});

export async function buildServer(): Promise<FastifyInstance> {
  const config = getConfig();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  await app.register(cors, { origin: config.CORS_ORIGIN });

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === "/health" || request.url.startsWith("/health?")) return;
    const token = request.headers["x-internal-token"];
    if (token !== config.INTERNAL_SERVICE_TOKEN) {
      reply.code(401).send({ error: { code: ErrorCodes.UNAUTHORIZED, message: "Invalid internal token" } });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    app.log.error(error);
    reply.code(500).send({ error: { code: ErrorCodes.INTERNAL_ERROR, message: "Internal metadata error" } });
  });

  app.get("/health", async () => ({ status: "ok", service: "metadata" }));

  app.post("/internal/nodes/register", async (request) => {
    const body = parseBody(registerSchema, request.body);
    const node = await prisma.storageNode.upsert({
      where: { nodeName: body.nodeName },
      create: {
        nodeName: body.nodeName,
        host: body.host,
        port: body.port,
        capacityBytes: BigInt(body.capacityBytes),
        availableBytes: BigInt(body.availableBytes),
        status: "HEALTHY",
        lastHeartbeat: new Date(),
      },
      update: {
        host: body.host,
        port: body.port,
        capacityBytes: BigInt(body.capacityBytes),
        availableBytes: BigInt(body.availableBytes),
        status: "HEALTHY",
        lastHeartbeat: new Date(),
      },
    });
    await logEvent(EventType.NODE_REGISTERED, `Node ${node.nodeName} registered`, { nodeId: node.id });
    return { nodeId: node.id, nodeName: node.nodeName };
  });

  app.post("/internal/nodes/heartbeat", async (request) => {
    const body = parseBody(heartbeatSchema, request.body);
    const node = await prisma.storageNode.upsert({
      where: { nodeName: body.nodeName },
      create: {
        nodeName: body.nodeName,
        host: body.host,
        port: body.port,
        capacityBytes: BigInt(body.capacityBytes),
        availableBytes: BigInt(body.availableBytes),
        status: body.status ?? "HEALTHY",
        lastHeartbeat: new Date(),
      },
      update: {
        host: body.host,
        port: body.port,
        capacityBytes: BigInt(body.capacityBytes),
        availableBytes: BigInt(body.availableBytes),
        status: body.status ?? "HEALTHY",
        lastHeartbeat: new Date(),
      },
    });
    return { nodeId: node.id, status: node.status };
  });

  app.post("/internal/placement", async (request) => {
    const body = parseBody(placementSchema, request.body);
    const nodes = await prisma.storageNode.findMany({ where: { status: "HEALTHY" } });
    const targets = selectNodes(
      nodes.map((node) => ({
        id: node.id,
        nodeName: node.nodeName,
        availableBytes: Number(node.availableBytes),
        status: node.status as NodeStatus,
      })),
      body.chunkIndex,
      {
        replicationFactor: body.replicationFactor ?? config.REPLICATION_FACTOR,
        strategy: (body.strategy as PlacementStrategy | undefined) ?? "round-robin",
        excludeNodeIds: body.excludeNodeIds,
      },
    );
    return {
      targets: targets.map((target) => ({
        nodeId: target.id,
        nodeName: target.nodeName,
        host: nodes.find((node) => node.id === target.id)?.host ?? "localhost",
        port: nodes.find((node) => node.id === target.id)?.port ?? 0,
      })),
    };
  });

  app.post("/internal/chunks", async (request) => {
    const body = parseBody(createChunkSchema, request.body);
    const nodes = await prisma.storageNode.findMany({ where: { status: "HEALTHY" } });
    const targets = selectNodes(
      nodes.map((node) => ({
        id: node.id,
        nodeName: node.nodeName,
        availableBytes: Number(node.availableBytes),
        status: node.status as NodeStatus,
      })),
      body.chunkIndex,
      {
        replicationFactor: body.replicationFactor ?? config.REPLICATION_FACTOR,
        strategy: (body.strategy as PlacementStrategy | undefined) ?? "round-robin",
      },
    );

    const chunk = await prisma.chunk.create({
      data: {
        versionId: body.versionId,
        chunkIndex: body.chunkIndex,
        size: body.size,
        checksum: body.checksum,
      },
    });

    await prisma.chunkReplica.createMany({
      data: targets.map((target) => ({ chunkId: chunk.id, nodeId: target.id, status: ReplicaStatus.PENDING })),
    });

    return {
      chunkId: chunk.id,
      targets: targets.map((target) => {
        const node = nodes.find((candidate) => candidate.id === target.id);
        return { nodeId: target.id, nodeName: target.nodeName, host: node?.host ?? "localhost", port: node?.port ?? 0 };
      }),
    };
  });

  app.post("/internal/chunks/:chunkId/confirm", async (request) => {
    const { chunkId } = request.params as { chunkId: string };
    const body = parseBody(confirmSchema, request.body);
    for (const replica of body.replicas) {
      await prisma.chunkReplica.updateMany({
        where: { chunkId, nodeId: replica.nodeId },
        data: {
          status: replica.status ?? ReplicaStatus.HEALTHY,
          storedChecksum: replica.storedChecksum ?? null,
        },
      });
    }
    return { updated: body.replicas.length };
  });

  app.get("/internal/chunks/:chunkId/locations", async (request) => {
    const { chunkId } = request.params as { chunkId: string };
    const replicas = await prisma.chunkReplica.findMany({
      where: { chunkId, status: ReplicaStatus.HEALTHY, node: { status: "HEALTHY" } },
      include: { node: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      locations: replicas.map((replica) => ({
        nodeId: replica.nodeId,
        nodeName: replica.node.nodeName,
        host: replica.node.host,
        port: replica.node.port,
      })),
    };
  });

  app.get("/internal/cluster/status", async () => {
    const [nodes, fileCount, files] = await Promise.all([
      prisma.storageNode.findMany({ orderBy: { nodeName: "asc" } }),
      prisma.file.count({ where: { deletedAt: null } }),
      prisma.file.aggregate({ where: { deletedAt: null }, _sum: { size: true } }),
    ]);
    const totalBytes = files._sum.size ?? 0n;
    return {
      totalNodes: nodes.length,
      healthyNodes: nodes.filter((node) => node.status === "HEALTHY").length,
      offlineNodes: nodes.filter((node) => node.status === "OFFLINE").length,
      totalFiles: fileCount,
      totalBytes: totalBytes.toString(),
      replicationFactor: config.REPLICATION_FACTOR,
      nodes: nodes.map((node) => ({
        id: node.id,
        nodeName: node.nodeName,
        host: node.host,
        port: node.port,
        status: node.status,
        capacityBytes: Number(node.capacityBytes),
        availableBytes: Number(node.availableBytes),
        lastHeartbeat: node.lastHeartbeat?.toISOString() ?? null,
      })),
    };
  });

  app.get("/internal/metrics", async () => {
    const [nodes, chunkCount, replicaGroups, recentEvents] = await Promise.all([
      prisma.storageNode.findMany({ orderBy: { nodeName: "asc" } }),
      prisma.chunk.count(),
      prisma.chunkReplica.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.event.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    return {
      nodes: nodes.map((node) => ({
        nodeName: node.nodeName,
        status: node.status,
        capacityBytes: Number(node.capacityBytes),
        availableBytes: Number(node.availableBytes),
        lastHeartbeat: node.lastHeartbeat?.toISOString() ?? null,
      })),
      totalChunks: chunkCount,
      replicasByStatus: Object.fromEntries(replicaGroups.map((group) => [group.status, group._count._all])),
      recentEvents: recentEvents.map((event) => ({
        type: event.type,
        message: event.message,
        nodeId: event.nodeId,
        chunkId: event.chunkId,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  });

  app.post("/internal/admin/nodes/:id/fail", async (request) => {
    const { id } = request.params as { id: string };
    const node = await prisma.storageNode.findUnique({ where: { id } });
    if (!node) throw new AppError(ErrorCodes.NOT_FOUND, "Node not found", 404);
    await prisma.storageNode.update({ where: { id }, data: { status: "OFFLINE" } });
    await prisma.chunkReplica.updateMany({
      where: { nodeId: id, status: ReplicaStatus.HEALTHY },
      data: { status: ReplicaStatus.MISSING },
    });
    await setNodeFailure({ host: node.host, port: node.port }, true).catch(() => undefined);
    await logEvent(EventType.FAULT_INJECTED, `Simulated failure of ${node.nodeName}`, { nodeId: id });
    return { nodeId: id, status: "OFFLINE" };
  });

  app.post("/internal/admin/nodes/:id/recover", async (request) => {
    const { id } = request.params as { id: string };
    const node = await prisma.storageNode.findUnique({ where: { id } });
    if (!node) throw new AppError(ErrorCodes.NOT_FOUND, "Node not found", 404);
    await prisma.storageNode.update({
      where: { id },
      data: { status: "HEALTHY", lastHeartbeat: new Date() },
    });
    await prisma.chunkReplica.updateMany({
      where: { nodeId: id, status: ReplicaStatus.MISSING },
      data: { status: ReplicaStatus.HEALTHY },
    });
    await setNodeFailure({ host: node.host, port: node.port }, false).catch(() => undefined);
    await logEvent(EventType.NODE_RECOVERED, `Node ${node.nodeName} recovered`, { nodeId: id });
    return { nodeId: id, status: "HEALTHY" };
  });

  app.post("/internal/admin/chunks/:id/corrupt", async (request) => {
    const { id } = request.params as { id: string };
    const replica = await prisma.chunkReplica.findFirst({
      where: { chunkId: id, status: ReplicaStatus.HEALTHY, node: { status: "HEALTHY" } },
      include: { node: true },
    });
    if (!replica) throw new AppError(ErrorCodes.NOT_FOUND, "No healthy replica to corrupt", 404);
    await corruptChunk({ host: replica.node.host, port: replica.node.port }, id);
    await prisma.chunkReplica.update({ where: { id: replica.id }, data: { status: ReplicaStatus.CORRUPT } });
    await logEvent(EventType.FAULT_INJECTED, `Corrupted chunk ${id} on ${replica.node.nodeName}`, {
      chunkId: id,
      nodeId: replica.nodeId,
    });
    return { chunkId: id, nodeName: replica.node.nodeName, status: "CORRUPT" };
  });

  app.post("/internal/admin/recovery/trigger", async () => {
    const summary = await triggerRecovery();
    return summary;
  });

  app.post("/internal/admin/health/sweep", async () => {
    const offline = await sweepNodeHealth();
    return { markedOffline: offline };
  });

  startHealthMonitor();
  startRecoveryLoop();

  return app;
}
