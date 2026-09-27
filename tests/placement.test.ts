import { describe, expect, it } from "vitest";
import { selectNodes, type PlacementNode } from "@distrifs/shared";

function nodes(): PlacementNode[] {
  return [
    { id: "1", nodeName: "node-1", availableBytes: 100, status: "HEALTHY" },
    { id: "2", nodeName: "node-2", availableBytes: 300, status: "HEALTHY" },
    { id: "3", nodeName: "node-3", availableBytes: 200, status: "HEALTHY" },
  ];
}

describe("placement", () => {
  it("places each replica on a distinct node", () => {
    const picked = selectNodes(nodes(), 0, { replicationFactor: 3 });
    const ids = new Set(picked.map((node) => node.id));
    expect(picked).toHaveLength(3);
    expect(ids.size).toBe(3);
  });

  it("spreads consecutive chunks across different starting nodes (round-robin)", () => {
    const starts = [0, 1, 2].map((index) => selectNodes(nodes(), index, { replicationFactor: 1 })[0]!.nodeName);
    expect(new Set(starts).size).toBe(3);
  });

  it("is deterministic for the same chunk index", () => {
    const first = selectNodes(nodes(), 4, { replicationFactor: 2 }).map((node) => node.id);
    const second = selectNodes(nodes(), 4, { replicationFactor: 2 }).map((node) => node.id);
    expect(first).toEqual(second);
  });

  it("skips excluded nodes", () => {
    const picked = selectNodes(nodes(), 0, { replicationFactor: 2, excludeNodeIds: ["1"] });
    expect(picked.map((node) => node.id)).not.toContain("1");
    expect(picked).toHaveLength(2);
  });

  it("prefers nodes with the most free space under least-used", () => {
    const picked = selectNodes(nodes(), 0, { replicationFactor: 2, strategy: "least-used" });
    expect(picked[0]!.nodeName).toBe("node-2");
    expect(picked[1]!.nodeName).toBe("node-3");
  });

  it("ignores unhealthy nodes", () => {
    const mixed = nodes();
    mixed[0]!.status = "OFFLINE";
    const picked = selectNodes(mixed, 0, { replicationFactor: 2 });
    expect(picked.map((node) => node.nodeName)).toEqual(["node-2", "node-3"]);
  });

  it("throws when there are not enough healthy nodes", () => {
    expect(() => selectNodes(nodes(), 0, { replicationFactor: 4 })).toThrowError(/Not enough healthy nodes/);
  });
});
