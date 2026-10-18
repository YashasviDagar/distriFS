# Chunking

Implementation: `packages/chunker/src/index.ts`.

## Streaming split

`chunkStream(source, chunkSize)` is an async generator. It accepts any async iterable of buffers (for example the multipart file stream), accumulates bytes until `chunkSize` is reached and yields `{ index, buffer, size, checksum }`. Only the in-progress chunk is held in memory, so file size is bounded by `MAX_FILE_SIZE_BYTES`, not by RAM. The last chunk may be shorter. An empty input yields no chunks.

## Checksums

Each chunk gets a SHA-256 hex digest (`sha256Hex`) computed when it is cut. The same digest is:

1. sent to the storage node, which rejects mismatching uploads with HTTP 400,
2. stored in PostgreSQL on the chunk row,
3. re-checked by the gateway on every download (`verifyChunk`),
4. re-checked by the recovery worker before copying a chunk.

## Reassembly

`reassemble` turns the ordered sequence of verified chunk buffers into a readable stream that the gateway pipes to the client. The gateway sets `content-length` from stored metadata.

## Helpers

- `chunkBuffer`: in-memory variant used by tests.
- `hashReadable`: streaming whole-stream digest.

## Tests

`tests/chunker.test.ts` covers chunk counts, ordering, exact reconstruction and checksum behavior.
