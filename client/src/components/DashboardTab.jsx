import { useCallback, useEffect, useState } from "react";
import apiFetch from "../lib/api";

const SEVERITY = [
  { key: "high", label: "High", dot: "bg-red-500", bar: "bg-red-500", text: "text-red-400" },
  { key: "medium", label: "Medium", dot: "bg-amber-500", bar: "bg-amber-500", text: "text-amber-400" },
  { key: "low", label: "Low", dot: "bg-sky-500", bar: "bg-sky-500", text: "text-sky-400" },
];

const QUICK_LINKS = [
  ["analysis", "Code analysis", "Parsing, complexity, ESLint"],
  ["architecture", "Architecture", "Dependency graph"],
  ["issues", "Issues", "Technical debt + explanations"],
  ["docs", "Docs", "AI-generated documentation"],
  ["ask", "Ask", "Chat with the codebase"],
];

function healthLabel(bySeverity) {
  if (bySeverity.high > 0) return { label: "Needs attention", cls: "border-red-800 bg-red-950/40 text-red-300" };
  if (bySeverity.medium > 0) return { label: "Moderate", cls: "border-amber-800 bg-amber-950/40 text-amber-300" };
  return { label: "Healthy", cls: "border-emerald-800 bg-emerald-950/40 text-emerald-300" };
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border border-gray-800 bg-gray-900" />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="h-56 rounded-lg border border-gray-800 bg-gray-900" />
        <div className="h-56 rounded-lg border border-gray-800 bg-gray-900" />
      </div>
    </div>
  );
}

export default function DashboardTab({ repoId, onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/repos/${repoId}/dashboard`);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoId, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  if (error) {
    return (
      <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-6 text-center">
        <p className="text-sm text-red-300">Couldn’t load the dashboard: {error}</p>
        <button
          onClick={retry}
          className="mt-3 rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-200 transition hover:bg-red-900/40"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return <DashboardSkeleton />;

  const { files, issues, dependencies, documentation, repository } = data;

  if (files.analyzed === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-800 p-10 text-center">
        <p className="text-gray-400">Nothing to summarize yet.</p>
        <p className="mt-1 text-sm text-gray-500">
          Run code analysis to populate complexity, lint, issues, and dependencies.
        </p>
        <button
          onClick={() => onNavigate?.("analysis")}
          className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-gray-200"
        >
          Go to Code analysis
        </button>
      </div>
    );
  }

  const total = issues.total || 0;
  const health = healthLabel(issues.bySeverity);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Overview</h2>
          <p className="mt-1 text-xs text-gray-500">
            Summary of analysis, issues, dependencies, and documentation for this repository.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${health.cls}`}>
          {health.label}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Total issues"
          value={total}
          sub={`${issues.bySeverity.high} high · ${issues.bySeverity.medium} medium · ${issues.bySeverity.low} low`}
        />
        <StatCard label="High severity" value={issues.bySeverity.high} sub="Fix these first" />
        <StatCard label="Files analyzed" value={files.analyzed} sub={`${repository.fileCount} ingested`} />
        <StatCard label="Avg complexity" value={files.averageComplexity} sub={`${files.totalFunctions} functions`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <h3 className="text-sm font-semibold text-gray-200">Issues by severity</h3>
          {total === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No issues detected.</p>
          ) : (
            <>
              <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-gray-800">
                {SEVERITY.map((s) => {
                  const count = issues.bySeverity[s.key];
                  if (!count) return null;
                  return (
                    <div
                      key={s.key}
                      className={s.bar}
                      style={{ width: `${(count / total) * 100}%` }}
                      title={`${count} ${s.label.toLowerCase()}`}
                    />
                  );
                })}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {SEVERITY.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => onNavigate?.("issues")}
                    className="rounded-lg border border-gray-800 p-3 text-left transition hover:border-gray-700"
                  >
                    <span className="flex items-center gap-2 text-xs text-gray-400">
                      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                      {s.label}
                    </span>
                    <p className={`mt-1 text-lg font-semibold ${s.text}`}>
                      {issues.bySeverity[s.key]}
                    </p>
                  </button>
                ))}
              </div>
              {issues.lastDetectedAt && (
                <p className="mt-4 text-xs text-gray-500">
                  Last detected {new Date(issues.lastDetectedAt).toLocaleString()}
                </p>
              )}
            </>
          )}
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-200">Most depended-on files</h3>
            <button
              onClick={() => onNavigate?.("architecture")}
              className="text-xs text-gray-400 transition hover:text-white"
            >
              View graph →
            </button>
          </div>
          {dependencies.topFiles.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No internal dependencies found.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-800">
              {dependencies.topFiles.map((f) => (
                <li key={f.path} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate font-mono text-xs text-gray-300" title={f.path}>
                    {f.path}
                  </span>
                  <span className="shrink-0 rounded-full border border-gray-700 px-2 py-0.5 text-[10px] text-gray-400">
                    {f.inDegree} imports
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-gray-500">
            {dependencies.internalEdges} internal edges · {dependencies.externalPackages} external packages
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <h3 className="text-sm font-semibold text-gray-200">Codebase</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Lines of code</p>
              <p className="mt-0.5 text-gray-200">{files.totalLinesOfCode}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Functions</p>
              <p className="mt-0.5 text-gray-200">{files.totalFunctions}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Lint issues</p>
              <p className="mt-0.5 text-gray-200">{files.totalLintIssues}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Embeddings</p>
              <p className="mt-0.5 text-gray-200">
                {repository.embeddingStatus === "complete"
                  ? repository.embeddingCount
                  : repository.embeddingStatus === "running"
                    ? "Indexing…"
                    : "Not indexed"}
              </p>
            </div>
          </div>
          {files.languages.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {files.languages.map((l) => (
                <span
                  key={l.language}
                  className="rounded-full border border-gray-700 px-2.5 py-0.5 text-xs text-gray-400"
                >
                  {l.language} · {l.count}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-200">Documentation</h3>
            <button
              onClick={() => onNavigate?.("docs")}
              className="text-xs text-gray-400 transition hover:text-white"
            >
              Open Docs →
            </button>
          </div>
          <p className="mt-3 text-2xl font-semibold">
            {documentation.generated}
            <span className="text-base font-normal text-gray-500"> / {documentation.total} sections</span>
          </p>
          {documentation.sections.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {documentation.sections.map((s) => (
                <span
                  key={s.sectionType}
                  className="rounded-full border border-emerald-900 bg-emerald-950/30 px-2.5 py-0.5 text-xs capitalize text-emerald-300"
                >
                  {s.sectionType}
                </span>
              ))}
            </div>
          )}
          {documentation.generatedAt && (
            <p className="mt-4 text-xs text-gray-500">
              Last generated {new Date(documentation.generatedAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-gray-200">Explore</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {QUICK_LINKS.map(([key, label, desc]) => (
            <button
              key={key}
              onClick={() => onNavigate?.(key)}
              className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-left transition hover:border-gray-600"
            >
              <p className="text-sm font-medium text-white">{label}</p>
              <p className="mt-0.5 text-xs text-gray-500">{desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}