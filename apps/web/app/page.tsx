"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ClusterOverview } from "@/components/ClusterOverview";
import { EventLog } from "@/components/EventLog";
import { FilesPanel } from "@/components/FilesPanel";
import { NodesPanel } from "@/components/NodesPanel";
import { api, loadSession, saveSession, type ClusterStatus, type Metrics, type User } from "@/lib/api";

const POLL_MS = 3000;

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [cluster, setCluster] = useState<ClusterStatus | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    setUser(session.user);
  }, [router]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      setCluster(await api<ClusterStatus>("/api/cluster/status"));
      if (user.role === "ADMIN") setMetrics(await api<Metrics>("/api/metrics"));
      setError(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to load cluster";
      if (message === "Session expired") {
        router.replace("/login");
        return;
      }
      setError(message);
    }
  }, [user, router]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  function logout() {
    saveSession(null);
    router.replace("/login");
  }

  if (!user) return null;

  return (
    <main>
      <div className="header">
        <div>
          <h1>DistriFS</h1>
          <span className="muted">Distributed file storage cluster</span>
        </div>
        <div className="row">
          <span className="muted">
            {user.email} ({user.role})
          </span>
          <button onClick={logout}>Sign out</button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {cluster && <ClusterOverview cluster={cluster} metrics={metrics} />}
      {cluster && <NodesPanel nodes={cluster.nodes} isAdmin={user.role === "ADMIN"} onChanged={refresh} />}
      <FilesPanel isAdmin={user.role === "ADMIN"} onChanged={refresh} />
      {user.role === "ADMIN" && metrics && <EventLog events={metrics.recentEvents} />}
    </main>
  );
}
