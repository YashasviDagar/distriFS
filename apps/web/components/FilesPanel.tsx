"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, downloadFile, formatBytes, uploadFile, type FileDetail, type FileSummary } from "@/lib/api";

export function FilesPanel({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => Promise<void> }) {
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setFiles(await api<FileSummary[]>("/api/files"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load files");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function guarded(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const upload = () =>
    guarded(async () => {
      const file = input.current?.files?.[0];
      if (!file) throw new Error("Choose a file first");
      await uploadFile(file);
      if (input.current) input.current.value = "";
      await load();
      await onChanged();
    });

  const remove = (id: string) =>
    guarded(async () => {
      await api(`/api/files/${id}`, { method: "DELETE" });
      if (detail?.id === id) setDetail(null);
      await load();
      await onChanged();
    });

  const inspect = (id: string) => guarded(async () => setDetail(await api<FileDetail>(`/api/files/${id}`)));

  const corrupt = (chunkId: string) =>
    guarded(async () => {
      await api(`/api/admin/chunks/${chunkId}/corrupt`, { method: "POST" });
      if (detail) setDetail(await api<FileDetail>(`/api/files/${detail.id}`));
    });

  const current = detail?.versions.find((version) => version.versionNo === detail.currentVersionNo);

  return (
    <div className="panel">
      <h2>Files</h2>
      <div className="row">
        <input ref={input} type="file" />
        <button className="primary" disabled={busy} onClick={upload}>
          Upload
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Chunks</th>
            <th>Version</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {files.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No files uploaded yet
              </td>
            </tr>
          )}
          {files.map((file) => (
            <tr key={file.id}>
              <td>{file.name}</td>
              <td>{formatBytes(file.size)}</td>
              <td>{file.totalChunks}</td>
              <td>v{file.currentVersionNo}</td>
              <td>
                <div className="row">
                  <button disabled={busy} onClick={() => inspect(file.id)}>
                    Chunks
                  </button>
                  <button disabled={busy} onClick={() => guarded(() => downloadFile(file.id, file.name))}>
                    Download
                  </button>
                  <button className="danger" disabled={busy} onClick={() => remove(file.id)}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && current && (
        <div style={{ marginTop: 16 }}>
          <div className="row spread">
            <strong>{detail.name}</strong>
            <span className={`badge ${detail.integrity.status}`}>
              {detail.integrity.status} · {detail.integrity.degradedChunks} degraded chunk(s)
            </span>
          </div>
          <div className="muted">Hover a chunk to see its replicas{isAdmin ? "; click to corrupt one replica" : ""}.</div>
          <div className="chunkgrid">
            {current.chunkLocations.map((chunk) => {
              const healthy = chunk.nodes.filter((n) => n.status === "HEALTHY" && n.nodeStatus === "HEALTHY").length;
              const ok = healthy >= detail.replicationFactor;
              return (
                <div
                  key={chunk.chunkId}
                  className={`chunk ${ok ? "ok" : "bad"}`}
                  title={`#${chunk.chunkIndex} ${chunk.nodes.map((n) => `${n.nodeName}:${n.status}`).join(", ")}`}
                  onClick={() => {
                    if (isAdmin && window.confirm(`Corrupt chunk #${chunk.chunkIndex} on one replica?`)) {
                      void corrupt(chunk.chunkId);
                    }
                  }}
                >
                  {chunk.chunkIndex}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
