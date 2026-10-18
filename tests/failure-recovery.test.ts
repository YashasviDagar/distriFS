import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.REPLICATION_FACTOR = "2";
  process.env.HEARTBEAT_TIMEOUT_MS = "15000";
});

type Status = "HEALTHY" | "OFFLINE";
interface NodeRow {
  id: string;
  nodeName: string;
  host: string;
  port: number;
  status: Status;
  lastHeartbeat: Date | null;
}
interface ReplicaRow {
  id: string;
  chunkId: string;
  nodeId: string;
  status: string;
  storedChecksum: string | null;
  node: NodeRow;
}
interface ChunkRow {
  id: string;
  checksum: string;
  replicas: ReplicaRow[];
}

const db = vi.hoisted(() => ({
  nodes: [] as NodeRow[],
  chunks: [] as ChunkRow[],
  events: [] as string[],
  seq: 0,
}));

vi.mock("@distrifs/db", () => ({
  prisma: {
    storageNode: {
      findMany: async ({ where }: { where?: { status?: string; OR?: unknown[] } }) => {
        let rows = db.nodes.filter((n) => !where?.status || n.status === where.status);
        if (where?.OR) {
          const cutoff = (where.OR[1] as { lastHeartbeat: { lt: Date } }).lastHeartbeat.lt;
          rows = rows.filter((n) => n.lastHeartbeat === null || n.lastHeartbeat < cutoff);
        }
        return rows;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<NodeRow> }) => {
        const node = db.nodes.find((n) => n.id === where.id);
        if (!node) throw new Error("node not found");
        Object.assign(node, data);
        return node;
      },
    },
    chunk: { findMany: async () => db.chunks },
    chunkReplica: {
      create: async ({ data }: { data: { chunkId: string; nodeId: string; status: string; storedChecksum: string } }) => {
        const chunk = db.chunks.find((c) => c.id === data.chunkId);
        const node = db.nodes.find((n) => n.id === data.nodeId);
        if (!chunk || !node) throw new Error("bad replica");
        const row: ReplicaRow = { id: `r${++db.seq}`, ...data, node };
        chunk.replicas.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<ReplicaRow> }) => {
        const row = db.chunks.flatMap((c) => c.replicas).find((r) => r.id === where.id);
        if (!row) throw new Error("replica not found");
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: { nodeId: string; status: string }; data: { status: string } }) => {
        for (const row of db.chunks.flatMap((c) => c.replicas)) {
          if (row.nodeId === where.nodeId && row.status === where.status) row.status = data.status;
        }
      },
      deleteMany: async ({ where }: { where: { chunkId: string; status: string } }) => {
        const chunk = db.chunks.find((c) => c.id === where.chunkId);
        if (chunk) chunk.replicas = chunk.replicas.filter((r) => r.status !== where.status);
      },
    },
    event: {
      create: async ({ data }: { data: { type: string } }) => {
        db.events.push(data.type);
      },
    },
  },
}));

import { sha256Hex } from "@distrifs/chunker";
import { runRecoveryOnce } from "../apps/metadata/src/recovery";
import { sweepNodeHealth } from "../apps/metadata/src/healthMonitor";
import { ChunkStore } from "../apps/storage-node/src/chunkStore";
import { buildServer, type NodeState } from "../apps/storage-node/src/server";

interface RunningNode {
  row: NodeRow;
  store: ChunkStore;
  state: NodeState;
  close: () => Promise<void>;
}

let root: string;
const running: RunningNode[] = [];
const payload = Buffer.from("distributed file system chunk payload ".repeat(100));
const checksum = sha256Hex(payload);

async function startNode(name: string): Promise<RunningNode> {
  const dataDir = join(root, name);
  const store = new ChunkStore(dataDir, 1024 * 1024 * 100);
  await store.init();
  const state: NodeState = { failed: false };
  const app = await buildServer(
    {
      id: name,
      host: "127.0.0.1",
      port: 0,
      dataDir,
      capacityBytes: 1024 * 1024 * 100,
      metadataUrl: "http://127.0.0.1:1",
      internalToken: "dev-internal-token",
      heartbeatIntervalMs: 5000,
    },
    store,
    state,
  );
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const row: NodeRow = {
    id: name,
    nodeName: name,
    host: "127.0.0.1",
    port,
    status: "HEALTHY",
    lastHeartbeat: new Date(),
  };
  return { row, store, state, close: () => app.close() };
}

function seedChunk(holders: RunningNode[], statuses: string[] = []): ChunkRow {
  const chunk: ChunkRow = { id: "chunk-1", checksum, replicas: [] };
  holders.forEach((holder, index) => {
    chunk.replicas.push({
      id: `seed-${index}`,
      chunkId: chunk.id,
      nodeId: holder.row.id,
      status: statuses[index] ?? "HEALTHY",
      storedChecksum: checksum,
      node: holder.row,
    });
  });
  db.chunks.push(chunk);
  return chunk;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "distrifs-test-"));
});

afterAll(async () => {
  await Promise.all(running.splice(0).map((node) => node.close()));
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await Promise.all(running.splice(0).map((node) => node.close()));
  for (const name of ["a", "b", "c"]) {
    const node = await startNode(`${name}-${Math.random().toString(36).slice(2, 8)}`);
    running.push(node);
  }
  db.nodes = running.map((node) => node.row);
  db.chunks = [];
  db.events = [];
  for (const node of running.slice(0, 2)) await node.store.put("chunk-1", payload);
});

describe("failure detection and automatic recovery", () => {
  it("marks a node with a stale heartbeat OFFLINE and its replicas MISSING", async () => {
    const [a, b] = running as [RunningNode, RunningNode, RunningNode];
    const chunk = seedChunk([a, b]);
    a.row.lastHeartbeat = new Date(Date.now() - 60_000);

    expect(await sweepNodeHealth()).toBe(1);
    expect(a.row.status).toBe("OFFLINE");
    expect(chunk.replicas.find((r) => r.nodeId === a.row.id)?.status).toBe("MISSING");
    expect(chunk.replicas.find((r) => r.nodeId === b.row.id)?.status).toBe("HEALTHY");
    expect(db.events).toContain("NODE_OFFLINE");
  });

  it("restores the replication factor on a spare node after a node failure", async () => {
    const [a, b, c] = running as [RunningNode, RunningNode, RunningNode];
    const chunk = seedChunk([a, b]);
    a.row.lastHeartbeat = new Date(Date.now() - 60_000);
    await sweepNodeHealth();

    const summary = await runRecoveryOnce();

    expect(summary.repaired).toBe(1);
    expect(c.store.has("chunk-1")).toBe(true);
    expect(sha256Hex(await c.store.get("chunk-1"))).toBe(checksum);
    const healthy = chunk.replicas.filter((r) => r.status === "HEALTHY").map((r) => r.nodeId);
    expect(healthy.sort()).toEqual([b.row.id, c.row.id].sort());
    expect(chunk.replicas.some((r) => r.status === "MISSING")).toBe(false);
    expect(db.events).toContain("RECOVERY_COMPLETED");
  });

  it("does nothing when replication is already satisfied", async () => {
    const [a, b] = running as [RunningNode, RunningNode, RunningNode];
    seedChunk([a, b]);
    const summary = await runRecoveryOnce();
    expect(summary).toMatchObject({ scanned: 1, repaired: 0, failed: 0, unrecoverable: 0 });
  });

  it("reports unrecoverable chunks when no healthy replica remains", async () => {
    const [a, b] = running as [RunningNode, RunningNode, RunningNode];
    seedChunk([a, b], ["MISSING", "MISSING"]);
    const summary = await runRecoveryOnce();
    expect(summary.unrecoverable).toBe(1);
    expect(summary.repaired).toBe(0);
  });

  it("does not copy corrupt data and flags the corrupt replica", async () => {
    const [a, b] = running as [RunningNode, RunningNode, RunningNode];
    const chunk = seedChunk([a, b], ["HEALTHY", "MISSING"]);
    await a.store.corrupt("chunk-1");

    const summary = await runRecoveryOnce();

    expect(summary.repaired).toBe(0);
    expect(summary.failed).toBe(1);
    expect(chunk.replicas.find((r) => r.nodeId === a.row.id)?.status).toBe("CORRUPT");
    expect(running[2]?.store.has("chunk-1")).toBe(false);
    expect(db.events).toContain("REPLICA_CORRUPT");
  });

  it("cannot recover from a replica on a node that is simulated as failed", async () => {
    const [a, b] = running as [RunningNode, RunningNode, RunningNode];
    seedChunk([a, b], ["HEALTHY", "MISSING"]);
    a.state.failed = true;

    const summary = await runRecoveryOnce();
    expect(summary.repaired).toBe(0);
    expect(summary.failed).toBe(1);

    a.state.failed = false;
    const retry = await runRecoveryOnce();
    expect(retry.repaired).toBe(1);
  });
});
