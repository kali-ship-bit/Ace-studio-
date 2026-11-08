import { useEffect, useState } from "react";
import {
  displayProfileEmail,
  loadProfilesPage,
  PROFILES_PAGE_SIZE,
  type ProfileRow,
} from "../lib/admin";
import { formatDateTime } from "../lib/format";
import type { SupabaseClient } from "../lib/supabase";

interface UsersProps {
  client: SupabaseClient;
}

const SEARCH_DEBOUNCE_MS = 300;

export default function Users({ client }: UsersProps) {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Wait for the user to stop typing before searching the server.
  // A new search starts back at the first page; both updates happen
  // together so the list loads once, not twice.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    loadProfilesPage(client, { page, pageSize: PROFILES_PAGE_SIZE, query: debouncedQuery })
      .then(({ rows, total: serverTotal }) => {
        if (cancelled) return;
        setProfiles(rows);
        setTotal(serverTotal);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load users.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, page, debouncedQuery, reloadKey]);

  const pageCount = Math.max(1, Math.ceil(total / PROFILES_PAGE_SIZE));

  return (
    <section>
      <h2>Users</h2>
      <p className="muted">
        {total} user{total === 1 ? "" : "s"} — newest first.
      </p>
      <label className="search-label">
        Search by email or phone
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. ada@example.com or 0801…"
        />
      </label>
      {loading && <p className="muted">Loading users…</p>}
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            Try again
          </button>
        </p>
      )}
      {!loading && !error && profiles.length === 0 && (
        <p className="muted">No users match that search.</p>
      )}
      {!loading && !error && profiles.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Phone</th>
                <th>Country</th>
                <th>Dial code</th>
                <th>Created</th>
                <th>Admin</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td>{displayProfileEmail(p)}</td>
                  <td>{p.phone ?? "—"}</td>
                  <td>{p.country ?? "—"}</td>
                  <td>{p.dial_code ?? "—"}</td>
                  <td>{formatDateTime(p.created_at)}</td>
                  <td>{p.is_admin ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && pageCount > 1 && (
        <p className="muted">
          <button
            type="button"
            className="secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </button>{" "}
          Page {page + 1} of {pageCount}{" "}
          <button
            type="button"
            className="secondary"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
          </button>
        </p>
      )}
    </section>
  );
}
