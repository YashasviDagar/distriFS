#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";

const baseUrl = process.env.BENCH_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const sizesMb = (process.env.BENCH_SIZES_MB ?? "1,8,32").split(",").map(Number);
const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 4);
const email = process.env.BENCH_EMAIL ?? `bench-${Date.now()}@distrifs.local`;
const password = process.env.BENCH_PASSWORD ?? randomBytes(9).toString("hex");

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const mbps = (bytes, ms) => (bytes / (1024 * 1024) / (ms / 1000)).toFixed(1);

async function call(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${response.status} ${await response.text()}`);
  return response;
}

async function authenticate() {
  const body = JSON.stringify({ email, password });
  const headers = { "content-type": "application/json" };
  const registered = await fetch(`${baseUrl}/api/auth/register`, { method: "POST", headers, body });
  if (registered.ok) return (await registered.json()).token;
  return (await (await call("/api/auth/login", { method: "POST", headers, body })).json()).token;
}

async function upload(token, name, buffer) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "application/octet-stream" }), name);
  const started = performance.now();
  const response = await call("/api/files/upload", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { result: await response.json(), ms: performance.now() - started };
}

async function download(token, id) {
  const started = performance.now();
  const response = await call(`/api/files/${id}/download`, { headers: { authorization: `Bearer ${token}` } });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, ms: performance.now() - started };
}

async function remove(token, id) {
  await call(`/api/files/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
}

const rows = [];

function report(label, bytes, ms, extra = "") {
  rows.push({ test: label, size: `${(bytes / (1024 * 1024)).toFixed(0)} MB`, "time (ms)": Math.round(ms), "MB/s": mbps(bytes, ms), notes: extra });
}

console.log(`Benchmarking ${baseUrl} (sizes: ${sizesMb.join(", ")} MB, concurrency: ${concurrency})`);
const token = await authenticate();
const created = [];

for (const sizeMb of sizesMb) {
  const buffer = randomBytes(sizeMb * 1024 * 1024);
  const expected = sha256(buffer);
  const { result, ms: uploadMs } = await upload(token, `bench-${sizeMb}mb.bin`, buffer);
  created.push(result.fileId);
  report("upload", buffer.length, uploadMs, `${result.totalChunks} chunks`);

  const { buffer: received, ms: downloadMs } = await download(token, result.fileId);
  const intact = sha256(received) === expected;
  report("download", buffer.length, downloadMs, intact ? "checksum ok" : "CHECKSUM MISMATCH");
  if (!intact) process.exitCode = 1;
}

const concurrentSize = Math.min(...sizesMb) * 1024 * 1024;
const payloads = Array.from({ length: concurrency }, () => randomBytes(concurrentSize));
const started = performance.now();
const uploaded = await Promise.all(payloads.map((payload, index) => upload(token, `bench-concurrent-${index}.bin`, payload)));
const elapsed = performance.now() - started;
created.push(...uploaded.map((entry) => entry.result.fileId));
report(`concurrent upload x${concurrency}`, concurrentSize * concurrency, elapsed, "aggregate throughput");

for (const id of created) await remove(token, id).catch(() => undefined);

console.table(rows);
