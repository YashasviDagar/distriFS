import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@distrifs/db";
import { reassemble } from "@distrifs/chunker";
import {
  AppError,
  ErrorCodes,
  badRequest,
  conflict,
  getConfig,
  notFound,
  unauthorized,
} from "@distrifs/shared";
import { authenticate, requireAdmin } from "./auth";
import * as metadata from "./metadataClient";
import {
  deleteFile,
  deleteVersion,
  getFileDetail,
  ingestFile,
  listFiles,
  openDownload,
  streamVersion,
  validateMimeType,
} from "./services/files";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid request", 400, result.error.flatten());
  }
  return result.data;
}

export async function buildServer(): Promise<FastifyInstance> {
  const config = getConfig();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  await app.register(cors, { origin: config.CORS_ORIGIN });
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: config.JWT_EXPIRES_IN } });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_FILE_SIZE_BYTES, files: 1 },
  });

  app.setErrorHandler((error: Error & { code?: string; validation?: unknown }, _request, reply) => {
    if (error instanceof AppError) {
      reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
      reply.code(413).send({ error: { code: ErrorCodes.PAYLOAD_TOO_LARGE, message: "Uploaded file is too large" } });
      return;
    }
    if ((error as { validation?: unknown }).validation) {
      reply.code(400).send({ error: { code: ErrorCodes.VALIDATION_ERROR, message: error.message } });
      return;
    }
    app.log.error(error);
    reply.code(500).send({ error: { code: ErrorCodes.INTERNAL_ERROR, message: "Internal gateway error" } });
  });

  app.get("/health", async () => ({ status: "ok", service: "gateway" }));

  app.post("/api/auth/register", async (request, reply) => {
    const body = parse(credentialsSchema, request.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw conflict("An account with this email already exists");
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: { email: body.email, passwordHash, role: "USER" },
    });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    reply.code(201);
    return { token, user: { id: user.id, email: user.email, role: user.role } };
  });

  app.post("/api/auth/login", async (request) => {
    const body = parse(credentialsSchema, request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw unauthorized("Invalid email or password");
    }
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return { token, user: { id: user.id, email: user.email, role: user.role } };
  });

  app.get("/api/me", { preHandler: authenticate }, async (request) => request.user);

  async function handleUpload(request: import("fastify").FastifyRequest): Promise<unknown> {
    const data = await request.file();
    if (!data) throw badRequest("No file was provided in the request");
    validateMimeType(data.mimetype);
    const fileId = (request.query as { fileId?: string }).fileId;
    return ingestFile({
      ownerId: request.user.sub,
      filename: data.filename,
      mimeType: data.mimetype,
      source: data.file,
      existingFileId: fileId,
    });
  }

  app.post("/api/files/upload", { preHandler: authenticate }, async (request, reply) => {
    const result = await handleUpload(request);
    reply.code(201);
    return result;
  });

  app.post("/api/files/:id/versions", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = await request.file();
    if (!data) throw badRequest("No file was provided in the request");
    validateMimeType(data.mimetype);
    const result = await ingestFile({
      ownerId: request.user.sub,
      filename: data.filename,
      mimeType: data.mimetype,
      source: data.file,
      existingFileId: id,
    });
    reply.code(201);
    return result;
  });

  app.get("/api/files", { preHandler: authenticate }, async (request) => {
    return listFiles(request.user.sub);
  });

  app.get("/api/files/:id", { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    return getFileDetail(request.user.sub, id);
  });

  app.get("/api/files/:id/versions", { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    const detail = await getFileDetail(request.user.sub, id);
    return detail.versions.map((version) => ({
      versionNo: version.versionNo,
      size: version.size,
      totalChunks: version.totalChunks,
      createdAt: version.createdAt,
      isCurrent: version.versionNo === detail.currentVersionNo,
    }));
  });

  app.get("/api/files/:id/download", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const versionParam = (request.query as { version?: string }).version;
    const versionNo = versionParam ? Number(versionParam) : undefined;
    if (versionParam && !Number.isInteger(versionNo)) throw badRequest("Invalid version number");

    const { file, version } = await openDownload(request.user.sub, id, versionNo);
    reply.header("content-type", "application/octet-stream");
    reply.header("content-disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
    reply.header("content-length", version.size.toString());
    return reply.send(reassemble(streamVersion(version)));
  });

  app.delete("/api/files/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteFile(request.user.sub, id);
    reply.code(204);
    return null;
  });

  app.delete(
    "/api/files/:id/versions/:versionNo",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id, versionNo } = request.params as { id: string; versionNo: string };
      await deleteVersion(request.user.sub, id, Number(versionNo));
      reply.code(204);
      return null;
    },
  );

  app.get("/api/nodes", async () => {
    const status = await metadata.getClusterStatus();
    return status.nodes;
  });

  app.get("/api/nodes/:id", async (request) => {
    const { id } = request.params as { id: string };
    const status = await metadata.getClusterStatus();
    const node = status.nodes.find((candidate) => candidate.id === id || candidate.nodeName === id);
    if (!node) throw notFound("Node not found");
    return node;
  });

  app.get("/api/cluster/status", async () => metadata.getClusterStatus());

  app.get("/api/cluster/health", async () => {
    const status = await metadata.getClusterStatus();
    const degraded = status.healthyNodes < status.replicationFactor;
    return {
      healthy: !degraded,
      healthyNodes: status.healthyNodes,
      totalNodes: status.totalNodes,
      offlineNodes: status.offlineNodes,
      replicationFactor: status.replicationFactor,
      message: degraded
        ? "Cluster cannot satisfy the replication factor with the current healthy nodes"
        : "Cluster is healthy",
    };
  });

  app.get("/api/metrics", { preHandler: requireAdmin }, async () => metadata.getMetrics());

  app.post("/api/admin/nodes/:id/fail", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    return metadata.failNode(id);
  });

  app.post("/api/admin/nodes/:id/recover", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    return metadata.recoverNode(id);
  });

  app.post("/api/admin/chunks/:id/corrupt", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    return metadata.corruptChunk(id);
  });

  app.post("/api/admin/recovery/trigger", { preHandler: requireAdmin }, async () => metadata.triggerRecovery());

  return app;
}
