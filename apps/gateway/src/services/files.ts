import { prisma } from "@distrifs/db";
import { chunkStream, verifyChunk, type ChunkData } from "@distrifs/chunker";
import {
  badRequest,
  EventType,
  getConfig,
  integrityError,
  notFound,
  nodeUnavailable,
  payloadTooLarge,
} from "@distrifs/shared";
import pLimit from "p-limit";
import { confirmReplicas, createChunk } from "../metadataClient";
import { getChunkFromNode, putChunkToNode } from "../storageClient";

export interface IngestInput {
  ownerId: string;
  filename: string;
  mimeType: string;
  source: AsyncIterable<Buffer | Uint8Array>;
  existingFileId?: string;
}

export interface IngestResult {
  fileId: string;
  versionId: string;
  versionNo: number;
  size: number;
  totalChunks: number;
}

async function storeChunk(versionId: string, chunk: ChunkData): Promise<void> {
  const created = await createChunk({
    versionId,
    chunkIndex: chunk.index,
    size: chunk.size,
    checksum: chunk.checksum,
  });

  const results = await Promise.allSettled(
    created.targets.map((target) => putChunkToNode(target, created.chunkId, chunk.buffer, chunk.checksum)),
  );

  const replicas = created.targets.map((target, index) => ({
    nodeId: target.nodeId,
    storedChecksum: results[index]?.status === "fulfilled" ? chunk.checksum : null,
    status: results[index]?.status === "fulfilled" ? ("HEALTHY" as const) : ("MISSING" as const),
  }));

  await confirmReplicas(created.chunkId, replicas);

  if (replicas.every((replica) => replica.status !== "HEALTHY")) {
    throw nodeUnavailable(`Chunk ${chunk.index} could not be stored on any storage node`);
  }
}

export async function ingestFile(input: IngestInput): Promise<IngestResult> {
  const config = getConfig();
  const chunkSize = config.CHUNK_SIZE_BYTES;
  let createdFile = false;

  let file = input.existingFileId
    ? await prisma.file.findFirst({
        where: { id: input.existingFileId, ownerId: input.ownerId, deletedAt: null },
      })
    : null;

  if (input.existingFileId && !file) {
    throw notFound("File to version was not found");
  }

  let versionNo = 1;
  if (file) {
    const aggregate = await prisma.fileVersion.aggregate({
      where: { fileId: file.id },
      _max: { versionNo: true },
    });
    versionNo = (aggregate._max.versionNo ?? 0) + 1;
  } else {
    file = await prisma.file.create({
      data: {
        ownerId: input.ownerId,
        name: input.filename,
        size: 0n,
        chunkSize,
        totalChunks: 0,
        currentVersionNo: 1,
      },
    });
    createdFile = true;
  }

  const version = await prisma.fileVersion.create({
    data: { fileId: file.id, versionNo, size: 0n, totalChunks: 0 },
  });

  const concurrency = Number(process.env.UPLOAD_CONCURRENCY ?? 4);
  const limit = pLimit(concurrency);
  const inFlight = new Set<Promise<void>>();
  let totalSize = 0;
  let totalChunks = 0;

  try {
    for await (const chunk of chunkStream(input.source, chunkSize)) {
      totalSize += chunk.size;
      totalChunks += 1;
      if (totalSize > config.MAX_FILE_SIZE_BYTES) {
        throw payloadTooLarge(`File exceeds the maximum size of ${config.MAX_FILE_SIZE_BYTES} bytes`);
      }
      const task = limit(() => storeChunk(version.id, chunk)).finally(() => inFlight.delete(task));
      inFlight.add(task);
      if (inFlight.size >= concurrency) {
        await Promise.race(inFlight);
      }
    }
    await Promise.all(inFlight);
  } catch (error) {
    await cleanup(createdFile ? file.id : undefined, version.id);
    throw error;
  }

  await prisma.fileVersion.update({
    where: { id: version.id },
    data: { size: BigInt(totalSize), totalChunks },
  });
  await prisma.file.update({
    where: { id: file.id },
    data: { size: BigInt(totalSize), totalChunks, currentVersionNo: versionNo },
  });
  await prisma.event.create({
    data: {
      type: EventType.FILE_UPLOADED,
      message: `Uploaded ${input.filename} (${totalChunks} chunks, version ${versionNo})`,
    },
  });

  return { fileId: file.id, versionId: version.id, versionNo, size: totalSize, totalChunks };
}

async function cleanup(fileId: string | undefined, versionId: string): Promise<void> {
  try {
    if (fileId) {
      await prisma.file.delete({ where: { id: fileId } });
      return;
    }
    await prisma.fileVersion.delete({ where: { id: versionId } });
  } catch (error) {
    console.error("[gateway] cleanup failed", error);
  }
}

export async function listFiles(ownerId: string) {
  const files = await prisma.file.findMany({
    where: { ownerId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { versions: true } } },
  });
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    size: file.size.toString(),
    chunkSize: file.chunkSize,
    totalChunks: file.totalChunks,
    currentVersionNo: file.currentVersionNo,
    versionCount: file._count.versions,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  }));
}

export async function getFileDetail(ownerId: string, fileId: string) {
  const file = await prisma.file.findFirst({
    where: { id: fileId, ownerId, deletedAt: null },
    include: {
      versions: {
        orderBy: { versionNo: "desc" },
        include: {
          chunks: {
            include: { replicas: { include: { node: true } } },
          },
        },
      },
    },
  });
  if (!file) throw notFound("File not found");

  let totalChunks = 0;
  let healthyReplicas = 0;
  let degradedChunks = 0;
  const target = getConfig().REPLICATION_FACTOR;

  for (const version of file.versions) {
    for (const chunk of version.chunks) {
      totalChunks += 1;
      const healthy = chunk.replicas.filter(
        (replica) => replica.status === "HEALTHY" && replica.node.status === "HEALTHY",
      ).length;
      healthyReplicas += healthy;
      if (healthy < target) degradedChunks += 1;
    }
  }

  return {
    id: file.id,
    name: file.name,
    size: file.size.toString(),
    chunkSize: file.chunkSize,
    totalChunks: file.totalChunks,
    currentVersionNo: file.currentVersionNo,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    replicationFactor: target,
    integrity: {
      status: degradedChunks === 0 ? "HEALTHY" : "DEGRADED",
      totalChunks,
      healthyReplicas,
      degradedChunks,
    },
    versions: file.versions.map((version) => ({
      id: version.id,
      versionNo: version.versionNo,
      size: version.size.toString(),
      totalChunks: version.totalChunks,
      createdAt: version.createdAt.toISOString(),
      chunkLocations: version.chunks
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          chunkId: chunk.id,
          size: chunk.size,
          checksum: chunk.checksum,
          nodes: chunk.replicas.map((replica) => ({
            nodeName: replica.node.nodeName,
            status: replica.status,
            nodeStatus: replica.node.status,
          })),
        })),
    })),
  };
}

export async function openDownload(ownerId: string, fileId: string, versionNo?: number) {
  const file = await prisma.file.findFirst({ where: { id: fileId, ownerId, deletedAt: null } });
  if (!file) throw notFound("File not found");

  const targetVersionNo = versionNo ?? file.currentVersionNo;
  const version = await prisma.fileVersion.findFirst({
    where: { fileId: file.id, versionNo: targetVersionNo },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
        include: { replicas: { include: { node: true } } },
      },
    },
  });
  if (!version) throw notFound("File version not found");

  return { file, version };
}

export async function* streamVersion(
  version: Awaited<ReturnType<typeof openDownload>>["version"],
): AsyncGenerator<Buffer> {
  for (const chunk of version.chunks) {
    const healthyReplicas = chunk.replicas.filter(
      (replica) => replica.status === "HEALTHY" && replica.node.status === "HEALTHY",
    );
    if (healthyReplicas.length === 0) {
      throw nodeUnavailable(`Chunk ${chunk.chunkIndex} is temporarily unavailable`);
    }

    let served = false;
    for (const replica of healthyReplicas) {
      try {
        const { buffer } = await getChunkFromNode(replica.node, chunk.id);
        if (verifyChunk(buffer, chunk.checksum)) {
          yield buffer;
          served = true;
          break;
        }
        await prisma.chunkReplica.update({ where: { id: replica.id }, data: { status: "CORRUPT" } });
        await prisma.event.create({
          data: {
            type: EventType.REPLICA_CORRUPT,
            message: `Corrupt replica of chunk ${chunk.chunkIndex} detected on ${replica.node.nodeName}`,
            chunkId: chunk.id,
            nodeId: replica.nodeId,
          },
        });
      } catch {
        // try the next healthy replica
      }
    }

    if (!served) {
      throw integrityError(`No valid replica available for chunk ${chunk.chunkIndex}`);
    }
  }
}

export async function deleteFile(ownerId: string, fileId: string): Promise<void> {
  const file = await prisma.file.findFirst({ where: { id: fileId, ownerId, deletedAt: null } });
  if (!file) throw notFound("File not found");
  await prisma.file.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
  await prisma.event.create({
    data: { type: EventType.FILE_DELETED, message: `Soft-deleted ${file.name}` },
  });
}

export async function deleteVersion(ownerId: string, fileId: string, versionNo: number): Promise<void> {
  const file = await prisma.file.findFirst({ where: { id: fileId, ownerId, deletedAt: null } });
  if (!file) throw notFound("File not found");

  const version = await prisma.fileVersion.findFirst({ where: { fileId, versionNo } });
  if (!version) throw notFound("Version not found");

  const remaining = await prisma.fileVersion.count({ where: { fileId, versionNo: { not: versionNo } } });
  if (remaining === 0) {
    await prisma.file.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
  }
  await prisma.fileVersion.delete({ where: { id: version.id } });

  if (file.currentVersionNo === versionNo) {
    const latest = await prisma.fileVersion.findFirst({
      where: { fileId },
      orderBy: { versionNo: "desc" },
    });
    if (latest) {
      await prisma.file.update({ where: { id: fileId }, data: { currentVersionNo: latest.versionNo } });
    }
  }
}

export function validateMimeType(mimeType: string): void {
  const allowed = getConfig().allowedMimeTypes;
  if (allowed.length === 0 || allowed.includes("*/*")) return;
  if (!allowed.includes(mimeType)) {
    throw badRequest(`File type ${mimeType} is not allowed`);
  }
}
