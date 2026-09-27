import { prisma } from "@distrifs/db";
import { verifyChunk } from "@distrifs/chunker";
import { EventType, getConfig } from "@distrifs/shared";
import { logEvent } from "./events";
import { getChunk, putChunk } from "./storageClient";

export interface RecoverySummary {
  scanned: number;
  repaired: number;
  failed: number;
  unrecoverable: number;
}

let running = false;

/**
 * Background recovery: restores the configured replication factor for any chunk
 * that has fewer healthy replicas than required, by copying from a healthy
 * replica to a new healthy node. Never blocks user requests.
 */
export async function runRecoveryOnce(): Promise<RecoverySummary> {
  const summary: RecoverySummary = { scanned: 0, repaired: 0, failed: 0, unrecoverable: 0 };
  const { REPLICATION_FACTOR } = getConfig();

  const healthyNodes = await prisma.storageNode.findMany({ where: { status: "HEALTHY" } });
  const chunks = await prisma.chunk.findMany({
    include: { replicas: { include: { node: true } } },
  });

  summary.scanned = chunks.length;

  for (const chunk of chunks) {
    const healthyReplicas = chunk.replicas.filter(
      (replica) => replica.status === "HEALTHY" && replica.node.status === "HEALTHY",
    );
    if (healthyReplicas.length >= REPLICATION_FACTOR) continue;

    if (healthyReplicas.length === 0) {
      summary.unrecoverable++;
      await logEvent(
        EventType.RECOVERY_FAILED,
        `Chunk ${chunk.id} has no healthy replica — data temporarily unavailable`,
        { chunkId: chunk.id },
      );
      continue;
    }

    const holderIds = new Set(chunk.replicas.map((replica) => replica.nodeId));
    const candidates = healthyNodes.filter((node) => !holderIds.has(node.id));
    const needed = REPLICATION_FACTOR - healthyReplicas.length;

    for (let index = 0; index < needed && index < candidates.length; index++) {
      const target = candidates[index];
      if (!target) continue;

      const sourceBuffer = await readVerifiedChunk(chunk.id, chunk.checksum, healthyReplicas);
      if (!sourceBuffer) {
        summary.failed++;
        await logEvent(
          EventType.RECOVERY_FAILED,
          `Chunk ${chunk.id} source replicas failed integrity verification`,
          { chunkId: chunk.id },
        );
        break;
      }

      try {
        await putChunk({ host: target.host, port: target.port }, chunk.id, sourceBuffer, chunk.checksum);
        await prisma.chunkReplica.create({
          data: {
            chunkId: chunk.id,
            nodeId: target.id,
            status: "HEALTHY",
            storedChecksum: chunk.checksum,
          },
        });
        summary.repaired++;
        await logEvent(
          EventType.RECOVERY_COMPLETED,
          `Recovered chunk ${chunk.id} onto ${target.nodeName}`,
          { chunkId: chunk.id, nodeId: target.id },
        );
      } catch (error) {
        summary.failed++;
        await logEvent(
          EventType.RECOVERY_FAILED,
          `Failed to recover chunk ${chunk.id} onto ${target.nodeName}: ${String(error)}`,
          { chunkId: chunk.id, nodeId: target.id },
        );
      }
    }

    if (healthyReplicas.length + Math.min(needed, candidates.length) >= REPLICATION_FACTOR) {
      await prisma.chunkReplica.deleteMany({
        where: { chunkId: chunk.id, status: "MISSING" },
      });
    }
  }

  return summary;
}

async function readVerifiedChunk(
  chunkId: string,
  expectedChecksum: string,
  replicas: Array<{ id: string; node: { host: string; port: number } }>,
): Promise<Buffer | null> {
  for (const replica of replicas) {
    try {
      const { buffer } = await getChunk(replica.node, chunkId);
      if (verifyChunk(buffer, expectedChecksum)) {
        return buffer;
      }
      await prisma.chunkReplica.update({
        where: { id: replica.id },
        data: { status: "CORRUPT" },
      });
      await logEvent(
        EventType.REPLICA_CORRUPT,
        `Corrupt replica of chunk ${chunkId} detected during recovery`,
        { chunkId },
      );
    } catch {
      // try the next healthy replica
    }
  }
  return null;
}

export function startRecoveryLoop(): () => void {
  const { RECOVERY_INTERVAL_MS } = getConfig();
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runRecoveryOnce()
      .catch((error) => console.error("[metadata] recovery run failed", error))
      .finally(() => {
        running = false;
      });
  }, RECOVERY_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function triggerRecovery(): Promise<RecoverySummary> {
  if (running) {
    return { scanned: 0, repaired: 0, failed: 0, unrecoverable: 0 };
  }
  running = true;
  try {
    return await runRecoveryOnce();
  } finally {
    running = false;
  }
}
