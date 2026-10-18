import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@distrifs/chunker";
import { signInternalRequest } from "@distrifs/shared";
import { ChunkStore } from "../apps/storage-node/src/chunkStore";
import { buildServer, type NodeState } from "../apps/storage-node/src/server";

const secret = "storage-test-secret";
let root: string;
let app: Awaited<ReturnType<typeof buildServer>>;
let store: ChunkStore;
const state: NodeState = { failed: false };

function signed(method: string, url: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...signInternalRequest(secret, method, url), ...extra };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "distrifs-node-"));
  store = new ChunkStore(root, 16 * 1024 * 1024);
  await store.init();
  app = await buildServer(
    {
      id: "test-node",
      host: "127.0.0.1",
      port: 0,
      dataDir: root,
      capacityBytes: 16 * 1024 * 1024,
      metadataUrl: "http://127.0.0.1:1",
      internalToken: secret,
      heartbeatIntervalMs: 5000,
    },
    store,
    state,
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

const data = Buffer.from("hello chunk");

describe("storage node API", () => {
  it("serves /health without authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().nodeId).toBe("test-node");
  });

  it("rejects unsigned and wrongly signed requests", async () => {
    const unsigned = await app.inject({ method: "GET", url: "/stats" });
    expect(unsigned.statusCode).toBe(401);
    const wrong = await app.inject({
      method: "GET",
      url: "/stats",
      headers: signInternalRequest("another-secret", "GET", "/stats"),
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("stores and returns a chunk with its checksum", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/chunks/c1",
      payload: data,
      headers: signed("PUT", "/chunks/c1", {
        "content-type": "application/octet-stream",
        "x-chunk-checksum": sha256Hex(data),
      }),
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: "/chunks/c1", headers: signed("GET", "/chunks/c1") });
    expect(get.statusCode).toBe(200);
    expect(get.rawPayload.equals(data)).toBe(true);
    expect(get.headers["x-chunk-checksum"]).toBe(sha256Hex(data));
  });

  it("accepts a chunk larger than the default 1 MiB Fastify body limit", async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    const res = await app.inject({
      method: "PUT",
      url: "/chunks/big",
      payload: big,
      headers: signed("PUT", "/chunks/big", {
        "content-type": "application/octet-stream",
        "x-chunk-checksum": sha256Hex(big),
      }),
    });
    expect(res.statusCode).toBe(200);
    await store.delete("big");
  });

  it("rejects an upload whose checksum does not match", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/chunks/bad",
      payload: data,
      headers: signed("PUT", "/chunks/bad", {
        "content-type": "application/octet-stream",
        "x-chunk-checksum": sha256Hex("something else"),
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(store.has("bad")).toBe(false);
  });

  it("returns 404 for missing chunks and deletes existing ones", async () => {
    const missing = await app.inject({ method: "GET", url: "/chunks/nope", headers: signed("GET", "/chunks/nope") });
    expect(missing.statusCode).toBe(404);

    const del = await app.inject({ method: "DELETE", url: "/chunks/c1", headers: signed("DELETE", "/chunks/c1") });
    expect(del.statusCode).toBe(200);
    expect(store.has("c1")).toBe(false);
  });

  it("detects corruption: stored bytes no longer match the original checksum", async () => {
    await store.put("c2", data);
    const url = "/internal/admin/chunks/c2/corrupt";
    const res = await app.inject({ method: "POST", url, headers: signed("POST", url) });
    expect(res.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: "/chunks/c2", headers: signed("GET", "/chunks/c2") });
    expect(get.headers["x-chunk-checksum"]).not.toBe(sha256Hex(data));
  });

  it("answers 503 for chunk access while simulated as failed, then recovers", async () => {
    const fail = await app.inject({
      method: "POST",
      url: "/internal/admin/fail",
      headers: signed("POST", "/internal/admin/fail"),
    });
    expect(fail.statusCode).toBe(200);

    const blocked = await app.inject({ method: "GET", url: "/chunks/c2", headers: signed("GET", "/chunks/c2") });
    expect(blocked.statusCode).toBe(503);

    await app.inject({
      method: "POST",
      url: "/internal/admin/recover",
      headers: signed("POST", "/internal/admin/recover"),
    });
    const ok = await app.inject({ method: "GET", url: "/chunks/c2", headers: signed("GET", "/chunks/c2") });
    expect(ok.statusCode).toBe(200);
  });
});
