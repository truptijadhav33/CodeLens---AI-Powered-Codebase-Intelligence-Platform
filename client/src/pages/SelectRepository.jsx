import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiFetch from "../lib/api";

export default function SelectRepository() {
  const navigate = useNavigate();
  const [repos, setRepos] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [ingesting, setIngesting] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch("/api/repos");
        if (!cancelled) setRepos(data.repos || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q)
    );
  }, [repos, query]);

  async function handleIngest(repo) {
    setIngesting(repo.fullName);
    setError(null);
    try {
      const data = await apiFetch("/api/repos/ingest", {
        method: "POST",
        body: JSON.stringify({ owner: repo.owner, repo: repo.name }),
      });
      navigate(`/repos/${data.repository.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setIngesting(null);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Select a repository</h1>
      <p className="mt-1 text-sm text-gray-400">
        Pick a GitHub repository to ingest (parse + store its source code).
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your repositories…"
        className="mt-6 w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm outline-none placeholder:text-gray-500 focus:border-gray-500"
      />

      {repos === null ? (
        <p className="mt-8 text-sm text-gray-500">Loading repositories…</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-900 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Repository</th>
                <th className="hidden px-4 py-3 md:table-cell">Language</th>
                <th className="hidden px-4 py-3 md:table-cell">Updated</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 bg-gray-950">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    No repositories match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((repo) => (
                  <tr key={repo.id} className="hover:bg-gray-900">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{repo.fullName}</p>
                      {repo.description && (
                        <p className="mt-0.5 max-w-md truncate text-xs text-gray-500">
                          {repo.description}
                        </p>
                      )}
                      {repo.isPrivate && (
                        <span className="mt-1 inline-block rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                          private
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-gray-400 md:table-cell">
                      {repo.language || "—"}
                    </td>
                    <td className="hidden px-4 py-3 text-gray-400 md:table-cell">
                      {repo.updatedAt
                        ? new Date(repo.updatedAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleIngest(repo)}
                        disabled={ingesting === repo.fullName}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-950 transition hover:bg-gray-200 disabled:opacity-50"
                      >
                        {ingesting === repo.fullName ? "Analyzing…" : "Analyze"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}