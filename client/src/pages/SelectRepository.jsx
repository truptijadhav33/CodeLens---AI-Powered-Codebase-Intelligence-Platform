import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiFetch from "../lib/api";

const GITHUB_OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const GITHUB_REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;
const CONSECUTIVE_DOTS_RE = /\.{2,}/;

function parseRepoInput(raw) {
  const input = (raw || "").trim();
  if (!input) return { error: "Enter a GitHub URL or owner/repo." };

  const ghUrlRe = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;
  const plainRe = /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/;

  const match = input.match(ghUrlRe) || input.match(plainRe);
  if (!match) {
    return {
      error: "Couldn't parse that. Use a GitHub URL like https://github.com/owner/repo (no need for .git or trailing slash), or a plain owner/repo string.",
    };
  }

  const owner = match[1];
  const repo = match[2];

  if (!GITHUB_OWNER_RE.test(owner)) {
    return {
      error: "Invalid owner: GitHub usernames use letters, numbers, and hyphens, cannot start or end with a hyphen, and are at most 39 characters.",
    };
  }
  if (
    !GITHUB_REPO_RE.test(repo) ||
    CONSECUTIVE_DOTS_RE.test(repo) ||
    repo.startsWith(".") ||
    repo.endsWith(".")
  ) {
    return {
      error: "Invalid repository name: use letters, numbers, hyphens, underscores, and periods (no consecutive or leading/trailing dots), up to 100 characters.",
    };
  }

  return { owner, repo };
}

export default function SelectRepository() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("mine");
  const [repos, setRepos] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [ingesting, setIngesting] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [lookupInput, setLookupInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState(null);
  const [lookupInfo, setLookupInfo] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);

  useEffect(() => {
    if (mode !== "mine") return;
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
  }, [mode, reloadKey]);

  const retry = useCallback(() => {
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  function switchMode(m) {
    setMode(m);
    if (m === "mine") {
      setRepos(null);
      setError(null);
    }
  }

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

  async function handleLookup(e) {
    e.preventDefault();
    setAnalyzeError(null);
    setLookupInfo(null);
    const parsed = parseRepoInput(lookupInput);
    if (parsed.error) {
      setLookupError(parsed.error);
      return;
    }

    setLookupLoading(true);
    setLookupError(null);
    try {
      const data = await apiFetch(
        `/api/repos/lookup?owner=${encodeURIComponent(parsed.owner)}&repo=${encodeURIComponent(parsed.repo)}`
      );
      setLookupInfo(data.repo);
    } catch (err) {
      setLookupError(err.message);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleAnalyzeAny() {
    if (!lookupInfo) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const data = await apiFetch("/api/repos/ingest", {
        method: "POST",
        body: JSON.stringify({ owner: lookupInfo.owner, repo: lookupInfo.name }),
      });
      navigate(`/repos/${data.repository.id}`);
    } catch (err) {
      setAnalyzeError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  const tabClass = (active) =>
    `border-b-2 px-4 py-2 text-sm font-medium transition ${
      active
        ? "border-white text-white"
        : "border-transparent text-gray-500 hover:text-gray-300"
    }`;

  return (
    <div>
      <h1 className="text-2xl font-bold">Select a repository</h1>
      <p className="mt-1 text-sm text-gray-400">
        Pick a repository to ingest (parse + store its source code) — from your GitHub
        repos or any public repository.
      </p>

      <div className="mt-6 flex gap-1 border-b border-gray-800">
        <button onClick={() => switchMode("mine")} className={tabClass(mode === "mine")}>
          My repositories
        </button>
        <button onClick={() => switchMode("any")} className={tabClass(mode === "any")}>
          Analyze any public repository
        </button>
      </div>

      {mode === "any" ? (
        <div className="mt-6 max-w-2xl">
          <form onSubmit={handleLookup} className="flex gap-2">
            <input
              type="text"
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              placeholder="https://github.com/owner/repo or owner/repo"
              className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm outline-none placeholder:text-gray-500 focus:border-gray-500"
            />
            <button
              type="submit"
              disabled={lookupLoading || !lookupInput.trim()}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-gray-200 disabled:opacity-50"
            >
              {lookupLoading ? "Checking…" : "Look up"}
            </button>
          </form>

          {lookupError && (
            <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {lookupError}
            </div>
          )}

          {lookupInfo && (
            <div className="mt-4 flex flex-col gap-4 rounded-lg border border-gray-800 bg-gray-900 p-5 sm:flex-row sm:items-start">
              <img
                src={lookupInfo.avatarUrl || ""}
                alt=""
                className="h-14 w-14 shrink-0 rounded-full border border-gray-700 bg-gray-800"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-white">{lookupInfo.fullName}</p>
                  {lookupInfo.isPrivate && (
                    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                      private
                    </span>
                  )}
                </div>
                {lookupInfo.description && (
                  <p className="mt-0.5 line-clamp-2 text-sm text-gray-500">
                    {lookupInfo.description}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                  <span>★ {lookupInfo.starCount}</span>
                  {lookupInfo.language && <span>{lookupInfo.language}</span>}
                  <span>default branch: {lookupInfo.defaultBranch}</span>
                </div>

                {analyzeError && (
                  <div className="mt-3 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                    {analyzeError}
                  </div>
                )}

                <button
                  onClick={handleAnalyzeAny}
                  disabled={analyzing}
                  className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-gray-200 disabled:opacity-50"
                >
                  {analyzing ? "Analyzing…" : "Analyze"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
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

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your repositories…"
            className="mt-6 w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm outline-none placeholder:text-gray-500 focus:border-gray-500"
          />

          {error ? null : repos === null ? (
            <div className="mt-4 animate-pulse overflow-hidden rounded-lg border border-gray-800">
              <div className="bg-gray-900 px-4 py-3 text-xs uppercase tracking-wide text-gray-500">
                Repository
              </div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 border-t border-gray-800 bg-gray-950/60 px-4 py-3" />
              ))}
            </div>
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
        </>
      )}
    </div>
  );
}