import { createHash } from "node:crypto";
import { Readable } from "node:stream";

export interface ChunkData {
  index: number;
  buffer: Buffer;
  size: number;
  checksum: string;
}

export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function createHasher(): ReturnType<typeof createHash> {
  return createHash("sha256");
}

export async function hashReadable(source: AsyncIterable<Buffer | Uint8Array>): Promise<string> {
  const hasher = createHash("sha256");
  for await (const piece of source) {
    hasher.update(piece);
  }
  return hasher.digest("hex");
}

/**
 * Streams an input source and yields fixed-size chunks with SHA-256 checksums.
 * Only one chunk is held in memory at a time, so arbitrarily large files can be
 * processed without buffering the whole file.
 */
export async function* chunkStream(
  source: AsyncIterable<Buffer | Uint8Array>,
  chunkSize: number,
): AsyncGenerator<ChunkData> {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }

  let parts: Buffer[] = [];
  let pendingBytes = 0;
  let index = 0;

  const flush = (): ChunkData => {
    const buffer = Buffer.concat(parts, pendingBytes);
    parts = [];
    pendingBytes = 0;
    const chunk: ChunkData = {
      index: index++,
      buffer,
      size: buffer.length,
      checksum: sha256Hex(buffer),
    };
    return chunk;
  };

  for await (const piece of source) {
    const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
    let offset = 0;
    while (offset < buffer.length) {
      const space = chunkSize - pendingBytes;
      const take = Math.min(space, buffer.length - offset);
      parts.push(buffer.subarray(offset, offset + take));
      pendingBytes += take;
      offset += take;
      if (pendingBytes === chunkSize) {
        yield flush();
      }
    }
  }

  if (pendingBytes > 0) {
    yield flush();
  }
}

export function chunkBuffer(buffer: Buffer, chunkSize: number): ChunkData[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  const chunks: ChunkData[] = [];
  for (let offset = 0, index = 0; offset < buffer.length; offset += chunkSize, index++) {
    const slice = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
    chunks.push({ index, buffer: slice, size: slice.length, checksum: sha256Hex(slice) });
  }
  return chunks;
}

export function verifyChunk(buffer: Buffer, expectedChecksum: string): boolean {
  return sha256Hex(buffer) === expectedChecksum;
}

/** Turns an ordered async iterable of chunk buffers into a single readable stream. */
export function reassemble(chunks: AsyncIterable<Buffer | Uint8Array>): Readable {
  return Readable.from(chunks);
}

export async function* bufferToChunks(buffer: Buffer): AsyncGenerator<Buffer> {
  yield buffer;
}
