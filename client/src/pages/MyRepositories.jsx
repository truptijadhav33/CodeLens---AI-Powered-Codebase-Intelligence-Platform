import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import apiFetch from "../lib/api";
import { formatBytes } from "../lib/format";

const statusStyles = {
  complete: "bg-emerald-900/40 text-emerald-300 border-emerald-800",
  ingesting: "bg-amber-900/40 text-amber-300 border-amber-800",
  pending: "bg-gray-800/40 text-gray-300 border-gray-700",
  failed: "bg-red-900/40 text-red-300 border-red-800",
};

function repoHealth(health) {
  const h = health || { high: 0, medium: 0, low: 0, total: 0 };
  if (h.high > 0) return { dot: "bg-red-500", text: `${h.high} high severity issue(s)` };
  if (h.medium > 0) return { dot: "bg-amber-500", text: `${h.medium} medium severity issue(s)` };
  if (h.total > 0) return { dot: "bg-emerald-500", text: `${h.total} low severity issue(s)` };
  return { dot: "bg-gray-600", text: "No issues detected" };
}

export default function MyRepositories() {
  const [repos, setRepos] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRepos(null);
    setError(null);
    (async () => {
      try {
        const data = await apiFetch("/api/repos/mine");
        if (!cancelled) setRepos(data.repos || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div>
      <h1 className="text-2xl font-bold">My repositories</h1>
      <p className="mt-1 text-sm text-gray-400">
        Repositories you have ingested with CodeLens.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          <p>{error}</p>
          <button
            onClick={retry}
            className="mt-2 rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-200 transition hover:bg-red-900/40"
          >
            Retry
          </button>
        </div>
      )}

      {error ? null : repos === null ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-lg border border-gray-800 bg-gray-900"
            />
          ))}
        </div>
      ) : repos.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-gray-800 p-10 text-center">
          <p className="text-gray-400">
            You haven’t ingested any repositories yet.
          </p>
          <Link
            to="/repos"
            className="mt-4 inline-block rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-gray-200"
          >
            Select a repository
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {repos.map((repo) => {
            const health = repoHealth(repo.health);
            return (
              <div
                key={repo.id}
                className="rounded-lg border border-gray-800 bg-gray-900 p-5 transition hover:border-gray-700"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      to={`/repos/${repo.id}`}
                      className="font-semibold text-white hover:text-gray-300"
                    >
                      <span
                        className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${health.dot}`}
                        title={health.text}
                        aria-label={health.text}
                      />
                      {repo.fullName}
                    </Link>
                    {repo.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                        {repo.description}
                      </p>
                    )}
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${statusStyles[repo.status] || statusStyles.pending}`}
                  >
                    {repo.status}
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
                  <span>{repo.language || "—"}</span>
                  <span>{repo.fileCount} files</span>
                  <span>{formatBytes(repo.totalSizeBytes)}</span>
                </div>

                {repo.status === "failed" && repo.errorMessage && (
                  <p className="mt-3 text-xs text-red-400">{repo.errorMessage}</p>
                )}

                {repo.status === "complete" && (
                  <Link
                    to={`/repos/${repo.id}`}
                    className="mt-4 inline-block rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition hover:bg-gray-800 hover:text-white"
                  >
                    View dashboard →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}