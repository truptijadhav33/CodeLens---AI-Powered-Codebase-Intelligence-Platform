import { useCallback, useEffect, useState } from "react";
import apiFetch from "../lib/api";

const SEVERITY_STYLES = {
  high: "bg-red-500/15 text-red-300 border-red-800",
  medium: "bg-amber-500/15 text-amber-300 border-amber-800",
  low: "bg-gray-500/15 text-gray-300 border-gray-700",
};

const TYPE_LABELS = {
  lint: "Lint",
  complexity: "Complexity",
  "missing-test": "Missing test",
  dependency: "Dependency",
  duplication: "Duplication",
};

function severityBadge(severity) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEVERITY_STYLES[severity] || SEVERITY_STYLES.low}`}
    >
      {severity}
    </span>
  );
}

function detailSummary(issue) {
  switch (issue.type) {
    case "lint":
      return `rule ${issue.detail.ruleId} · line ${issue.detail.line}`;
    case "complexity":
      return `score ${issue.detail.complexityScore} · ${(issue.detail.functions || []).length} function(s) over threshold ${issue.detail.threshold}`;
    case "missing-test":
      return "name-based heuristic (no real coverage data)";
    case "dependency":
      return `in-degree ${issue.detail.inDegree} · internal files ${issue.detail.internalFiles}`;
    case "duplication":
      return `"${issue.detail.functionName}" ~${issue.detail.estimatedLinesA} vs ~${issue.detail.estimatedLinesB} lines`;
    default:
      return "";
  }
}

export default function IssuesTab({ repoId }) {
  const [issues, setIssues] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [typeFilter, setTypeFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [explainingId, setExplainingId] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadIssues = useCallback(
    async (targetPage, append = false) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(targetPage), limit: String(limit) });
        if (typeFilter) params.set("type", typeFilter);
        if (severityFilter) params.set("severity", severityFilter);
        const data = await apiFetch(`/api/repos/${repoId}/issues?${params}`);
        setIssues((prev) => (append ? [...prev, ...data.issues] : data.issues));
        setTotal(data.total);
        setSummary(data.summary);
        setPage(targetPage);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [repoId, typeFilter, severityFilter, limit]
  );

  useEffect(() => {
    loadIssues(1);
  }, [loadIssues]);

  const hasEverDetected = summary !== null && (summary.total > 0 || issues.length > 0 || total > 0);
  const empty = summary?.total === 0;

  async function runDetection() {
    setDetecting(true);
    setError(null);
    try {
      await apiFetch(`/api/repos/${repoId}/detect-issues`, { method: "POST" });
      setExpanded(new Set());
      await loadIssues(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setDetecting(false);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      await loadIssues(page + 1, true);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function explain(issue) {
    setExplainingId(issue.id);
    try {
      const data = await apiFetch(`/api/repos/${repoId}/issues/${issue.id}/explain`, { method: "POST" });
      setIssues((prev) =>
        prev.map((i) =>
          i.id === issue.id
            ? { ...i, aiExplanation: data.aiExplanation, aiSuggestion: data.aiSuggestion }
            : i
        )
      );
    } catch (e) {
      setExplainingId(null);
      setError(`Explain failed: ${e.message}`);
    }
  }

  const groups = [
    ["high", issues.filter((i) => i.severity === "high")],
    ["medium", issues.filter((i) => i.severity === "medium")],
    ["low", issues.filter((i) => i.severity === "low")],
  ].filter(([, list]) => list.length > 0);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Issues & technical debt</h2>
          <p className="mt-1 text-xs text-gray-500">
            Deterministic detection (lint, complexity, missing-test heuristic, dependency risk, approximate duplication). AI explanation is on-demand only.
          </p>
        </div>
        <button
          onClick={runDetection}
          disabled={detecting}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-gray-200 disabled:opacity-50"
        >
          {detecting ? "Detecting…" : hasEverDetected ? "Re-detect issues" : "Run issue detection"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && issues.length === 0 && (
        <p className="mt-6 text-sm text-gray-500">Loading issues…</p>
      )}

      {!loading && empty && (
        <div className="mt-6 rounded-lg border border-gray-800 bg-gray-950 px-6 py-10 text-center">
          <p className="text-sm text-gray-400">No issues detected yet for this repository.</p>
          <p className="mt-1 text-xs text-gray-600">
            Run issue detection to scan lint findings, complexity, missing tests, dependency risk, and possible duplication.
          </p>
        </div>
      )}

      {summary && summary.total > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
            <p className="text-xs text-gray-500">Total</p>
            <p className="mt-0.5 text-lg font-semibold">{summary.total}</p>
          </div>
          {["high", "medium", "low"].map((s) => (
            <div key={s} className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
              <p className="text-xs text-gray-500 capitalize">{s}</p>
              <p className="mt-0.5 text-lg font-semibold">{summary.bySeverity?.[s] || 0}</p>
            </div>
          ))}
          <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
            <p className="text-xs text-gray-500">Lint</p>
            <p className="mt-0.5 text-lg font-semibold">{summary.byType?.lint || 0}</p>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="">All severities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        {(typeFilter || severityFilter) && (
          <button
            onClick={() => {
              setTypeFilter("");
              setSeverityFilter("");
            }}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Clear filters
          </button>
        )}
      </div>

      {issues.length === 0 && !loading && !empty && (
        <p className="mt-6 text-sm text-gray-500">No issues match the current filters.</p>
      )}

      {issues.length > 0 && (
        <div className="mt-4 space-y-4">
          {groups.map(([sev, list]) => (
            <div key={sev}>
              <div className="mb-1 flex items-center gap-2 text-sm">
                <span className={`h-2 w-2 rounded-full ${sev === "high" ? "bg-red-500" : sev === "medium" ? "bg-amber-500" : "bg-gray-500"}`} />
                <span className="font-medium capitalize text-gray-300">{sev}</span>
                <span className="text-xs text-gray-600">{list.length}</span>
              </div>
              <div className="space-y-2">
                {list.map((issue) => {
                  const isOpen = expanded.has(issue.id);
                  const isExplaining = explainingId === issue.id;
                  const hasExplanation = Boolean(issue.aiExplanation);
                  return (
                    <div
                      key={issue.id}
                      className="overflow-hidden rounded-lg border border-gray-800 bg-gray-950"
                    >
                      <button
                        onClick={() => toggleExpand(issue.id)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-900/60"
                      >
                        {severityBadge(issue.severity)}
                        <span className="min-w-[90px] rounded border border-gray-700 px-1.5 py-0.5 text-center text-[10px] text-gray-300">
                          {TYPE_LABELS[issue.type] || issue.type}
                        </span>
                        <span className="flex-1">
                          <span className="block text-sm text-gray-200">{issue.message}</span>
                          <span className="mt-0.5 block font-mono text-[11px] text-gray-500">{issue.filePath}</span>
                        </span>
                        <span className="text-gray-600">{isOpen ? "−" : "+"}</span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-gray-800 px-4 py-3">
                          <p className="text-xs text-gray-500">{detailSummary(issue)}</p>

                          {hasExplanation ? (
                            <div className="mt-3 space-y-3">
                              <div className="rounded-lg bg-gray-900 p-3">
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">AI explanation</p>
                                <p className="whitespace-pre-wrap text-sm text-gray-200">{issue.aiExplanation}</p>
                              </div>
                              {issue.aiSuggestion && (
                                <div className="rounded-lg bg-gray-900 p-3">
                                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Suggested fix</p>
                                  <p className="whitespace-pre-wrap text-sm text-gray-200">{issue.aiSuggestion}</p>
                                </div>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => explain(issue)}
                              disabled={isExplaining}
                              className="mt-3 rounded-lg border border-blue-800 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-950/50 disabled:opacity-50"
                            >
                              {isExplaining ? "Explaining…" : "Explain with AI"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {total > issues.length && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full rounded-lg border border-gray-800 py-2 text-sm text-gray-400 hover:bg-gray-900 disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : `Load more (${total - issues.length} remaining)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}