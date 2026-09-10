import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import apiFetch from "../lib/api";
import { formatBytes } from "../lib/format";

const statusStyles = {
  complete: "bg-emerald-900/40 text-emerald-300 border-emerald-800",
  ingesting: "bg-amber-900/40 text-amber-300 border-amber-800",
  pending: "bg-gray-800/40 text-gray-300 border-gray-700",
  failed: "bg-red-900/40 text-red-300 border-red-800",
};

export default function MyRepositories() {
  const [repos, setRepos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold">My repositories</h1>
      <p className="mt-1 text-sm text-gray-400">
        Repositories you have ingested with CodeLens.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {repos === null ? (
        <p className="mt-8 text-sm text-gray-500">Loading…</p>
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
          {repos.map((repo) => (
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
                  View files →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}