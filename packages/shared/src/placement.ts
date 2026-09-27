import { AppError, ErrorCodes } from "./errors";
import type { NodeStatus } from "./types";

export type PlacementStrategy = "round-robin" | "least-used";

export interface PlacementNode {
  id: string;
  nodeName: string;
  availableBytes: number;
  status: NodeStatus;
}

export interface PlacementOptions {
  replicationFactor: number;
  strategy?: PlacementStrategy;
  excludeNodeIds?: string[];
}

/**
 * Chooses distinct healthy nodes for a chunk.
 *
 * - round-robin: rotates the starting point by chunk index so load spreads
 *   evenly and consecutive chunks land on different nodes.
 * - least-used: prefers nodes with the most free space (ties broken by name).
 *
 * Replicas of a single chunk are always placed on distinct nodes.
 */
export function selectNodes(
  nodes: PlacementNode[],
  chunkIndex: number,
  options: PlacementOptions,
): PlacementNode[] {
  const { replicationFactor, strategy = "round-robin", excludeNodeIds = [] } = options;

  if (!Number.isInteger(replicationFactor) || replicationFactor <= 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "replicationFactor must be a positive integer", 400);
  }

  const excluded = new Set(excludeNodeIds);
  const eligible = nodes.filter((node) => node.status === "HEALTHY" && !excluded.has(node.id));

  if (eligible.length < replicationFactor) {
    throw new AppError(
      ErrorCodes.INSUFFICIENT_STORAGE,
      `Not enough healthy nodes: need ${replicationFactor}, found ${eligible.length}`,
      507,
    );
  }

  const ordered =
    strategy === "least-used"
      ? [...eligible].sort(
          (a, b) => b.availableBytes - a.availableBytes || a.nodeName.localeCompare(b.nodeName),
        )
      : [...eligible].sort((a, b) => a.nodeName.localeCompare(b.nodeName));

  const start = ((chunkIndex % ordered.length) + ordered.length) % ordered.length;
  const picked: PlacementNode[] = [];
  for (let offset = 0; offset < ordered.length && picked.length < replicationFactor; offset++) {
    const node = ordered[(start + offset) % ordered.length];
    if (node) picked.push(node);
  }
  return picked;
}
