import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { chunkBuffer, chunkStream, sha256Hex, verifyChunk } from "@distrifs/chunker";

async function collect(source: AsyncIterable<Buffer | Uint8Array>, chunkSize: number) {
  const chunks = [];
  for await (const chunk of chunkStream(source, chunkSize)) {
    chunks.push(chunk);
  }
  return chunks;
}

function deterministicBuffer(size: number): Buffer {
  const buffer = Buffer.alloc(size);
  for (let index = 0; index < size; index++) {
    buffer[index] = (index * 7 + 3) & 0xff;
  }
  return buffer;
}

describe("chunker", () => {
  it("splits a file into the expected number of chunks", async () => {
    const buffer = deterministicBuffer(20);
    const chunks = await collect(Readable.from([buffer]), 6);
    expect(chunks.map((chunk) => chunk.size)).toEqual([6, 6, 6, 2]);
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2, 3]);
  });

  it("handles files that are an exact multiple of the chunk size", async () => {
    const buffer = deterministicBuffer(12);
    const chunks = await collect(Readable.from([buffer]), 4);
    expect(chunks.map((chunk) => chunk.size)).toEqual([4, 4, 4]);
  });

  it("produces no chunks for an empty file", async () => {
    const chunks = await collect(Readable.from([Buffer.alloc(0)]), 4);
    expect(chunks).toHaveLength(0);
  });

  it("reconstructs the original bytes from ordered chunks", async () => {
    const original = deterministicBuffer(1024 * 1024 + 123);
    const chunks = await collect(Readable.from([original]), 64 * 1024);
    const reconstructed = Buffer.concat(chunks.map((chunk) => chunk.buffer));
    expect(reconstructed.equals(original)).toBe(true);
    expect(sha256Hex(reconstructed)).toBe(sha256Hex(original));
  });

  it("assigns a verifiable sha256 checksum to every chunk", async () => {
    const original = deterministicBuffer(100);
    const chunks = chunkBuffer(original, 32);
    expect(chunks).toHaveLength(4);
    for (const chunk of chunks) {
      expect(verifyChunk(chunk.buffer, chunk.checksum)).toBe(true);
    }
    const tampered = Buffer.from(chunks[0]!.buffer);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(verifyChunk(tampered, chunks[0]!.checksum)).toBe(false);
  });

  it("streams across many small source chunks without losing bytes", async () => {
    const original = deterministicBuffer(5000);
    const pieces = [];
    for (let offset = 0; offset < original.length; offset += 37) {
      pieces.push(original.subarray(offset, offset + 37));
    }
    const chunks = await collect(Readable.from(pieces), 128);
    const reconstructed = Buffer.concat(chunks.map((chunk) => chunk.buffer));
    expect(reconstructed.equals(original)).toBe(true);
  });
});
