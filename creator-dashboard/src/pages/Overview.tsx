import { useEffect, useState } from "react";
import { JOB_STATUSES, loadJobStatusCounts, type JobStatusCounts } from "../lib/admin";
import type { SupabaseClient } from "../lib/supabase";

interface OverviewProps {
  client: SupabaseClient;
  /**
   * Total jobs from the same source as the header counts
   * (loadDashboardCounts). The per-status cards are a breakdown; the
   * total card must not be a second, separately-computed number.
   */
  totalJobs: number | null;
}

export default function Overview({ client, totalJobs }: OverviewProps) {
  const [counts, setCounts] = useState<JobStatusCounts | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    loadJobStatusCounts(client)
      .then((c) => {
        if (!cancelled) setCounts(c);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load jobs.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadKey]);

  return (
    <section>
      <h2>Overview</h2>
      <p className="muted">Jobs across all users, by status.</p>
      {loading && <p className="muted">Loading jobs…</p>}
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            Try again
          </button>
        </p>
      )}
      {counts && (
        <div className="stat-grid">
          {JOB_STATUSES.map((status) => (
            <div className="stat-card" key={status}>
              <span className="stat-number">{counts[status]}</span>
              <span className="stat-label">{status}</span>
            </div>
          ))}
          <div className="stat-card">
            <span className="stat-number">{totalJobs ?? "—"}</span>
            <span className="stat-label">total jobs</span>
          </div>
        </div>
      )}
    </section>
  );
}
