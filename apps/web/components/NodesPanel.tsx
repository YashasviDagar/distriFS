"use client";

import { useState } from "react";
import { api, formatBytes, type NodeInfo } from "@/lib/api";

function age(timestamp: string | null): string {
  if (!timestamp) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
  return `${seconds}s ago`;
}

export function NodesPanel({
  nodes,
  isAdmin,
  onChanged,
}: {
  nodes: NodeInfo[];
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(key: string, path: string) {
    setBusy(key);
    setMessage(null);
    try {
      const result = await api<Record<string, unknown>>(path, { method: "POST" });
      if (key === "recovery") setMessage(`Recovery: ${JSON.stringify(result)}`);
      await onChanged();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel">
      <div className="row spread">
        <h2>Storage nodes</h2>
        {isAdmin && (
          <button disabled={busy !== null} onClick={() => run("recovery", "/api/admin/recovery/trigger")}>
            Trigger recovery
          </button>
        )}
      </div>
      {message && <div className="muted">{message}</div>}
      <div className="grid">
        {nodes.map((node) => {
          const used = node.capacityBytes - node.availableBytes;
          const percent = node.capacityBytes > 0 ? Math.round((used / node.capacityBytes) * 100) : 0;
          return (
            <div key={node.id} className="panel" style={{ marginBottom: 0 }}>
              <div className="row spread">
                <strong>{node.nodeName}</strong>
                <span className={`badge ${node.status}`}>{node.status}</span>
              </div>
              <div className="muted">
                {node.host}:{node.port} · heartbeat {age(node.lastHeartbeat)}
              </div>
              <div className="bar">
                <div style={{ width: `${percent}%` }} />
              </div>
              <div className="muted">
                {formatBytes(used)} of {formatBytes(node.capacityBytes)} used
              </div>
              {isAdmin && (
                <div className="row" style={{ marginTop: 10 }}>
                  {node.status === "HEALTHY" ? (
                    <button
                      className="danger"
                      disabled={busy !== null}
                      onClick={() => run(node.id, `/api/admin/nodes/${node.id}/fail`)}
                    >
                      Fail node
                    </button>
                  ) : (
                    <button disabled={busy !== null} onClick={() => run(node.id, `/api/admin/nodes/${node.id}/recover`)}>
                      Recover node
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
