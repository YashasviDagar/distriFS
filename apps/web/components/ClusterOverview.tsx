import { formatBytes, type ClusterStatus, type Metrics } from "@/lib/api";

export function ClusterOverview({ cluster, metrics }: { cluster: ClusterStatus; metrics: Metrics | null }) {
  const degraded = cluster.healthyNodes < cluster.replicationFactor;
  const replicaSummary =
    Object.entries(metrics?.replicasByStatus ?? {})
      .map(([status, count]) => `${count} ${status.toLowerCase()}`)
      .join(", ") || "no replicas";

  return (
    <div className="panel">
      <div className="row spread">
        <h2>Cluster</h2>
        <span className={`badge ${degraded ? "DEGRADED" : "HEALTHY"}`}>{degraded ? "DEGRADED" : "HEALTHY"}</span>
      </div>
      <div className="grid">
        <div>
          <div className="stat">
            {cluster.healthyNodes}/{cluster.totalNodes}
          </div>
          <span className="muted">healthy nodes</span>
        </div>
        <div>
          <div className="stat">{cluster.totalFiles}</div>
          <span className="muted">files ({formatBytes(cluster.totalBytes)})</span>
        </div>
        <div>
          <div className="stat">{cluster.replicationFactor}x</div>
          <span className="muted">replication factor</span>
        </div>
        {metrics && (
          <div>
            <div className="stat">{metrics.totalChunks}</div>
            <span className="muted">chunks ({replicaSummary})</span>
          </div>
        )}
      </div>
    </div>
  );
}
