import { getConfig, type PlacementStrategy } from "@distrifs/shared";

export interface ReplicaTarget {
  nodeId: string;
  nodeName: string;
  host: string;
  port: number;
}

export interface CreatedChunk {
  chunkId: string;
  targets: ReplicaTarget[];
}

export interface ReplicaConfirmation {
  nodeId: string;
  storedChecksum: string | null;
  status: "PENDING" | "HEALTHY" | "CORRUPT" | "MISSING" | "QUARANTINED";
}

export interface ClusterStatusResponse {
  totalNodes: number;
  healthyNodes: number;
  offlineNodes: number;
  totalFiles: number;
  totalBytes: string;
  replicationFactor: number;
  nodes: Array<{
    id: string;
    nodeName: string;
    host: string;
    port: number;
    status: string;
    capacityBytes: number;
    availableBytes: number;
    lastHeartbeat: string | null;
  }>;
}

function headers(): Record<string, string> {
  return { "content-type": "application/json", "x-internal-token": getConfig().INTERNAL_SERVICE_TOKEN };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getConfig().METADATA_URL}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Metadata call ${path} failed (${response.status}): ${text}`);
  }
  return (await response.json()) as T;
}

export function createChunk(input: {
  versionId: string;
  chunkIndex: number;
  size: number;
  checksum: string;
  replicationFactor?: number;
  strategy?: PlacementStrategy;
}): Promise<CreatedChunk> {
  return requestJson<CreatedChunk>("/internal/chunks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function confirmReplicas(chunkId: string, replicas: ReplicaConfirmation[]): Promise<{ updated: number }> {
  return requestJson<{ updated: number }>(`/internal/chunks/${chunkId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ replicas }),
  });
}

export function getClusterStatus(): Promise<ClusterStatusResponse> {
  return requestJson<ClusterStatusResponse>("/internal/cluster/status");
}

export function getMetrics(): Promise<unknown> {
  return requestJson<unknown>("/internal/metrics");
}

export function failNode(nodeId: string): Promise<unknown> {
  return requestJson(`/internal/admin/nodes/${nodeId}/fail`, { method: "POST" });
}

export function recoverNode(nodeId: string): Promise<unknown> {
  return requestJson(`/internal/admin/nodes/${nodeId}/recover`, { method: "POST" });
}

export function corruptChunk(chunkId: string): Promise<unknown> {
  return requestJson(`/internal/admin/chunks/${chunkId}/corrupt`, { method: "POST" });
}

export function triggerRecovery(): Promise<unknown> {
  return requestJson(`/internal/admin/recovery/trigger`, { method: "POST" });
}
