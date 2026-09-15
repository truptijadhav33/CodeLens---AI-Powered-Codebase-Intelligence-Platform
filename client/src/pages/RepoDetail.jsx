import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import apiFetch from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";
import IssuesTab from "../components/IssuesTab";
import DashboardTab from "../components/DashboardTab";

// Heavy tabs — React Flow, markdown, chat UI — loaded only when opened.
const ArchitectureGraph = lazy(() => import("../components/ArchitectureGraph"));
const AskTab = lazy(() => import("../components/AskTab"));
const DocsTab = lazy(() => import("../components/DocsTab"));

function TabLoading() {
  return (
    <div className="mt-4 animate-pulse">
      <div className="h-8 w-48 rounded bg-gray-800" />
      <div className="mt-4 h-10 rounded bg-gray-800/60" />
      <div className="mt-3 h-40 rounded-lg border border-gray-800 bg-gray-900" />
    </div>
  );
}

export default function RepoDetail() {
  const { id } = useParams();
  const [repo, setRepo] = useState(null);
  const [files, setFiles] = useState(null);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [fileView, setFileView] = useState(null); // { path, content, size, error, loading }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch(`/api/repos/${id}`);
        if (!cancelled) {
          setRepo(data.repository);
          setFiles(data.files || []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch(`/api/repos/${id}/analysis`);
        if (!cancelled && data.repository.analysisStatus === "complete") setAnalysis(data);
      } catch {
        // no analysis yet — ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const data = await apiFetch(`/api/repos/${id}/analyze`, { method: "POST" });
      setAnalysis(data);
    } catch (err) {
      setAnalysisError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function openFile(file) {
    if (fileView && fileView.path === file.path) {
      setFileView(null);
      return;
    }
    setFileView({ path: file.path, loading: true, error: null, content: null, size: file.size });
    try {
      // Purged files have id === null → fetch by path and re-fetch live from GitHub.
      const url =
        file.id != null
          ? `/api/repos/${id}/files/${file.id}`
          : `/api/repos/${id}/files/by-path?path=${encodeURIComponent(file.path)}`;
      const data = await apiFetch(url);
      setFileView({ path: file.path, loading: false, error: null, content: data.file.content, size: data.file.size });
    } catch (err) {
      setFileView({ path: file.path, loading: false, error: err.message, content: null, size: null });
    }
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Repository</h1>
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
        <Link to="/my" className="mt-4 inline-block text-sm text-gray-400 hover:text-white">
          ← Back to my repositories
        </Link>
      </div>
    );
  }

  if (!repo || files === null) {
    return (
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-gray-800" />
        <div className="mt-4 h-8 w-64 rounded bg-gray-800" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-gray-800/60" />
          ))}
        </div>
        <div className="mt-8 h-64 rounded-lg border border-gray-800 bg-gray-900" />
      </div>
    );
  }

  const meta = [
    ["Owner", repo.owner],
    ["Language", repo.language || "—"],
    ["Default branch", repo.defaultBranch || "—"],
    ["Visibility", repo.isPrivate ? "Private" : "Public"],
    ["Star count", repo.starCount != null ? formatCount(repo.starCount) : "—"],
    ["Ingested", repo.ingestedAt ? new Date(repo.ingestedAt).toLocaleString() : "—"],
  ];

  return (
    <div>
      <Link to="/my" className="text-sm text-gray-400 hover:text-white">
        ← Back to my repositories
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{repo.fullName}</h1>
          {repo.description && (
            <p className="mt-1 max-w-2xl text-sm text-gray-400">
              {repo.description}
            </p>
          )}
        </div>
        <div className="flex gap-6 rounded-lg border border-gray-800 bg-gray-900 px-5 py-3 text-sm">
          <div>
            <p className="text-xs text-gray-500">Files</p>
            <p className="mt-0.5 font-semibold">{repo.fileCount}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Total size</p>
            <p className="mt-0.5 font-semibold">
              {formatBytes(repo.totalSizeBytes)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-gray-800 bg-gray-900 p-5 text-sm sm:grid-cols-3">
        {meta.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-0.5 truncate text-gray-200">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 flex gap-1 overflow-x-auto border-b border-gray-800">
        {[
          ["dashboard", "Dashboard"],
          ["files", "Files"],
          ["analysis", "Code analysis"],
          ["architecture", "Architecture"],
          ["issues", "Issues"],
          ["ask", "Ask"],
          ["docs", "Docs"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
              activeTab === key
                ? "border-white text-white"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "dashboard" && (
        <div className="mt-4">
          <DashboardTab repoId={id} onNavigate={setActiveTab} />
        </div>
      )}

      {activeTab === "files" && (
        <div className="mt-4">
          <div className="overflow-hidden rounded-lg border border-gray-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-900 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Path</th>
                  <th className="px-4 py-3 text-right">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 bg-gray-950">
                {files.map((file) => {
                  const active = fileView && fileView.path === file.path;
                  return (
                    <tr
                      key={file.path}
                      onClick={() => openFile(file)}
                      className={`cursor-pointer font-mono hover:bg-gray-900 ${
                        active ? "bg-gray-900" : ""
                      }`}
                    >
                      <td className="flex items-center gap-2 px-4 py-2 text-gray-300">
                        {file.path}
                        {file.purged && (
                          <span className="shrink-0 rounded bg-teal-900/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-teal-300">
                            re-fetch
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">
                        {formatBytes(file.size)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {fileView && fileView.path === file.path && (
            <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950">
              <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
                <span className="font-mono text-xs text-gray-400">{fileView.path}</span>
                <span className="text-xs text-gray-500">{formatBytes(fileView.size)}</span>
              </div>
              {fileView.loading ? (
                <div className="p-4">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-gray-800" />
                  <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-gray-800" />
                  <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-gray-800" />
                </div>
              ) : fileView.error ? (
                <div className="p-4 text-sm text-red-300">{fileView.error}</div>
              ) : (
                <pre className="max-h-96 overflow-auto p-4 font-mono text-xs leading-relaxed text-gray-300">
                  {fileView.content}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "analysis" && (
        <div>
          <div className="mt-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Code analysis</h2>
          <p className="mt-1 text-xs text-gray-500">
            Deterministic parsing, complexity, and lint (ESLint) — JS/TS only.
          </p>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-gray-200 disabled:opacity-50"
        >
          {analyzing ? "Analyzing…" : "Run code analysis"}
        </button>
      </div>

      {analysisError && (
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {analysisError}
        </div>
      )}

      {analyzing && (
        <p className="mt-4 text-sm text-gray-500">
          Running parser + complexity + ESLint on {repo.fileCount} files…
        </p>
      )}

      {analysis && (
        <>
          {analysis.summary.message && (
            <div className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
              {analysis.summary.message}
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            {[
              ["Files analyzed", analysis.summary.analyzedFiles],
              ["Unsupported", analysis.summary.unsupportedFiles],
              ["Lint issues", analysis.summary.totalLintIssues],
              ["Avg complexity", analysis.summary.averageComplexity],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-gray-800 bg-gray-900 p-4"
              >
                <p className="text-xs text-gray-500">{label}</p>
                <p className="mt-1 text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-gray-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-900 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Path</th>
                  <th className="px-4 py-3">Language</th>
                  <th className="px-4 py-3 text-right">Lines</th>
                  <th className="px-4 py-3 text-right">Complexity</th>
                  <th className="px-4 py-3 text-right">Lint issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 bg-gray-950">
                {analysis.files.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      No JavaScript/TypeScript files to analyze.
                    </td>
                  </tr>
                ) : (
                  analysis.files.map((f) => (
                    <tr key={f.path} className="font-mono hover:bg-gray-900">
                      <td className="px-4 py-2 text-gray-300">{f.path}</td>
                      <td className="px-4 py-2 text-gray-400">{f.language}</td>
                      <td className="px-4 py-2 text-right text-gray-500">{f.linesOfCode}</td>
                      <td className="px-4 py-2 text-right text-gray-500">{f.complexityScore}</td>
                      <td
                        className={`px-4 py-2 text-right ${
                          f.lintIssueCount > 0 ? "text-red-400" : "text-gray-500"
                        }`}
                      >
                        {f.lintIssueCount}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
        </div>
      )}

      {activeTab === "architecture" && (
        <div className="mt-4">
          <Suspense fallback={<TabLoading />}>
            <ArchitectureGraph repoId={id} />
          </Suspense>
        </div>
      )}

      {activeTab === "issues" && (
        <div className="mt-4">
          <IssuesTab repoId={id} />
        </div>
      )}

      {activeTab === "ask" && (
        <div className="mt-4">
          <Suspense fallback={<TabLoading />}>
            <AskTab repoId={id} />
          </Suspense>
        </div>
      )}

      {activeTab === "docs" && (
        <div className="mt-4">
          <Suspense fallback={<TabLoading />}>
            <DocsTab repoId={id} repoName={repo.fullName} />
          </Suspense>
        </div>
      )}
    </div>
  );
}