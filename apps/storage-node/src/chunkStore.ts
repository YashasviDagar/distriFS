import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Owns a single storage node's on-disk chunk directory. Maintains an in-memory
 * index of chunk sizes so available-space calculations do not require rescanning
 * the directory on every heartbeat.
 */
export class ChunkStore {
  private readonly index = new Map<string, number>();
  private used = 0;

  constructor(
    private readonly dataDir: string,
    private readonly capacityBytes: number,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await this.reload();
  }

  private chunkPath(chunkId: string): string {
    return join(this.dataDir, `${chunkId}.chunk`);
  }

  private async reload(): Promise<void> {
    this.index.clear();
    this.used = 0;
    const entries = await readdir(this.dataDir);
    for (const entry of entries) {
      if (!entry.endsWith(".chunk")) continue;
      const info = await stat(join(this.dataDir, entry));
      const chunkId = entry.slice(0, -".chunk".length);
      this.index.set(chunkId, info.size);
      this.used += info.size;
    }
  }

  has(chunkId: string): boolean {
    return this.index.has(chunkId);
  }

  get chunkCount(): number {
    return this.index.size;
  }

  get usedBytes(): number {
    return this.used;
  }

  get availableBytes(): number {
    return Math.max(0, this.capacityBytes - this.used);
  }

  listChunkIds(): string[] {
    return [...this.index.keys()];
  }

  async put(chunkId: string, data: Buffer): Promise<void> {
    await writeFile(this.chunkPath(chunkId), data);
    const previous = this.index.get(chunkId) ?? 0;
    this.used += data.length - previous;
    this.index.set(chunkId, data.length);
  }

  async get(chunkId: string): Promise<Buffer> {
    return readFile(this.chunkPath(chunkId));
  }

  async delete(chunkId: string): Promise<void> {
    await rm(this.chunkPath(chunkId), { force: true });
    const previous = this.index.get(chunkId);
    if (previous !== undefined) {
      this.used -= previous;
      this.index.delete(chunkId);
    }
  }

  async corrupt(chunkId: string): Promise<void> {
    const data = await this.get(chunkId);
    if (data.length === 0) {
      throw new Error(`Chunk ${chunkId} is empty and cannot be corrupted`);
    }
    data[0] = (data[0] ?? 0) ^ 0xff;
    await writeFile(this.chunkPath(chunkId), data);
  }
}
