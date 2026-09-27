export interface StorageNodeRuntimeConfig {
  id: string;
  host: string;
  port: number;
  dataDir: string;
  capacityBytes: number;
  metadataUrl: string;
  internalToken: string;
  heartbeatIntervalMs: number;
}

export function loadNodeConfig(): StorageNodeRuntimeConfig {
  return {
    id: process.env.STORAGE_NODE_ID ?? "node-1",
    host: process.env.STORAGE_NODE_HOST ?? "localhost",
    port: Number(process.env.STORAGE_NODE_PORT ?? 5001),
    dataDir: process.env.STORAGE_NODE_DATA_DIR ?? "storage/node-1/data",
    capacityBytes: Number(process.env.STORAGE_NODE_CAPACITY_BYTES ?? 10 * 1024 * 1024 * 1024),
    metadataUrl: process.env.METADATA_URL ?? "http://localhost:8081",
    internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? "dev-internal-token",
    heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS ?? 5000),
  };
}
