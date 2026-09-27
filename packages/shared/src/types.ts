export const NodeStatus = {
  HEALTHY: "HEALTHY",
  OFFLINE: "OFFLINE",
  DECOMMISSIONED: "DECOMMISSIONED",
} as const;
export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];

export const ReplicaStatus = {
  PENDING: "PENDING",
  HEALTHY: "HEALTHY",
  CORRUPT: "CORRUPT",
  MISSING: "MISSING",
  QUARANTINED: "QUARANTINED",
} as const;
export type ReplicaStatus = (typeof ReplicaStatus)[keyof typeof ReplicaStatus];

export const UserRole = {
  USER: "USER",
  ADMIN: "ADMIN",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const EventType = {
  NODE_REGISTERED: "NODE_REGISTERED",
  NODE_OFFLINE: "NODE_OFFLINE",
  NODE_RECOVERED: "NODE_RECOVERED",
  REPLICA_CREATED: "REPLICA_CREATED",
  REPLICA_CORRUPT: "REPLICA_CORRUPT",
  RECOVERY_STARTED: "RECOVERY_STARTED",
  RECOVERY_COMPLETED: "RECOVERY_COMPLETED",
  RECOVERY_FAILED: "RECOVERY_FAILED",
  FILE_UPLOADED: "FILE_UPLOADED",
  FILE_DELETED: "FILE_DELETED",
  FAULT_INJECTED: "FAULT_INJECTED",
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export interface StorageNodeInfo {
  id: string;
  nodeName: string;
  host: string;
  port: number;
  status: NodeStatus;
  capacityBytes: number;
  availableBytes: number;
  lastHeartbeat: string | null;
}

export interface ReplicaTarget {
  nodeId: string;
  nodeName: string;
  host: string;
  port: number;
}

export interface PlacementResult {
  chunkIndex: number;
  targets: ReplicaTarget[];
}

export interface ChunkDescriptor {
  index: number;
  size: number;
  checksum: string;
}

export interface HeartbeatPayload {
  nodeId: string;
  nodeName: string;
  host: string;
  port: number;
  availableBytes: number;
  capacityBytes: number;
  status: NodeStatus;
  timestamp: string;
}

export interface ClusterStatus {
  totalNodes: number;
  healthyNodes: number;
  offlineNodes: number;
  totalFiles: number;
  totalBytes: number;
  replicationFactor: number;
  nodes: StorageNodeInfo[];
}
