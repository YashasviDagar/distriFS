import { prisma } from "@distrifs/db";
import { EventType, getConfig } from "@distrifs/shared";
import { logEvent } from "./events";

/**
 * Sweeps storage nodes and marks those whose last heartbeat is older than the
 * configured timeout as OFFLINE. Replicas held by an offline node are flagged
 * MISSING so availability and recovery computations ignore them.
 */
export async function sweepNodeHealth(): Promise<number> {
  const { HEARTBEAT_TIMEOUT_MS } = getConfig();
  const threshold = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

  const staleNodes = await prisma.storageNode.findMany({
    where: {
      status: "HEALTHY",
      OR: [{ lastHeartbeat: null }, { lastHeartbeat: { lt: threshold } }],
    },
  });

  for (const node of staleNodes) {
    await prisma.storageNode.update({
      where: { id: node.id },
      data: { status: "OFFLINE" },
    });
    await prisma.chunkReplica.updateMany({
      where: { nodeId: node.id, status: "HEALTHY" },
      data: { status: "MISSING" },
    });
    await logEvent(
      EventType.NODE_OFFLINE,
      `Node ${node.nodeName} marked OFFLINE (heartbeat timeout)`,
      { nodeId: node.id },
    );
  }

  return staleNodes.length;
}

export function startHealthMonitor(): () => void {
  const { HEALTH_SWEEP_INTERVAL_MS } = getConfig();
  const timer = setInterval(() => {
    sweepNodeHealth().catch((error) => console.error("[metadata] health sweep failed", error));
  }, HEALTH_SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
