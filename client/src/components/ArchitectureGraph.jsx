import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import apiFetch from "../lib/api";

const NODE_W = 160;
const NODE_H = 40;

function layoutElements(rawNodes, rawEdges) {
  if (rawNodes.length === 0) return { nodes: [], edges: [] };

  const degree = new Map(rawNodes.map((n) => [n.id, 0]));
  for (const e of rawEdges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }

  const connectedIds = new Set(
    [...degree.entries()].filter(([, d]) => d > 0).map(([id]) => id)
  );
  const connectedNodes = rawNodes.filter((n) => connectedIds.has(n.id));
  const isolatedNodes = rawNodes.filter((n) => !connectedIds.has(n.id));
  const connectedEdges = rawEdges.filter(
    (e) => connectedIds.has(e.source) && connectedIds.has(e.target)
  );

  const positioned = new Map();
  let maxY = 0;

  if (connectedNodes.length > 0) {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "TB", nodesep: 30, ranksep: 70, marginx: 20, marginy: 20 });
    for (const n of connectedNodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
    for (const e of connectedEdges) g.setEdge(e.source, e.target);
    dagre.layout(g);

    // Reflow: if a rank is too wide (>6 nodes in same y), wrap into multiple rows
    const yGroups = new Map();
    for (const n of connectedNodes) {
      const p = g.node(n.id);
      const y = Math.round(p.y);
      if (!yGroups.has(y)) yGroups.set(y, []);
      yGroups.get(y).push({ id: n.id, x: p.x, y: p.y });
    }
    const COL_LIMIT = 6;
    for (const [, group] of yGroups) {
      if (group.length <= COL_LIMIT) {
        for (const item of group) {
          positioned.set(item.id, { x: item.x - NODE_W / 2, y: item.y - NODE_H / 2 });
          maxY = Math.max(maxY, item.y + NODE_H / 2);
        }
      } else {
        // Wrap wide rank into rows
        const sorted = [...group].sort((a, b) => a.x - b.x);
        for (let i = 0; i < sorted.length; i++) {
          const col = i % COL_LIMIT;
          const row = Math.floor(i / COL_LIMIT);
          const baseX = sorted[col]?.x ?? sorted[0].x;
          // Spread evenly across original width
          const span = Math.max(...group.map((x) => x.x)) - Math.min(...group.map((x) => x.x));
          const step = COL_LIMIT > 1 ? span / (COL_LIMIT - 1) : 0;
          const minX = Math.min(...group.map((x) => x.x));
          const x = minX + col * step;
          const y = sorted[i].y + row * (NODE_H + 18);
          positioned.set(sorted[i].id, { x: x - NODE_W / 2, y: y - NODE_H / 2 });
          maxY = Math.max(maxY, y + NODE_H / 2);
        }
      }
    }
  }

  if (isolatedNodes.length > 0) {
    const cols = 5;
    const startY = maxY > 0 ? maxY + 60 : 20;
    const gapX = 16;
    const gapY = 14;
    isolatedNodes.forEach((n, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positioned.set(n.id, {
        x: col * (NODE_W + gapX) + 20,
        y: startY + row * (NODE_H + gapY),
      });
    });
  }

  const nodes = rawNodes.map((n) => {
    const p = positioned.get(n.id) || { x: 20, y: 20 };
    return {
      id: n.id,
      position: { x: p.x, y: p.y },
      data: { label: n.label, node: n },
      style:
        n.type === "external"
          ? {
              background: "#f59e0b",
              color: "#111827",
              border: "1px solid #d97706",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              padding: 6,
            }
          : {
              background: "#1e3a5f",
              color: "#e5e7eb",
              border: "1px solid #3b82f6",
              borderRadius: 8,
              fontSize: 11,
              padding: 6,
            },
      type: "default",
    };
  });

  const edges = rawEdges.map((e, i) => ({
    id: `e-${e.source}-${e.target}-${i}`,
    source: e.source,
    target: e.target,
    animated: e.type === "external",
    style:
      e.type === "external"
        ? { stroke: "#f59e0b", strokeDasharray: "6 4" }
        : { stroke: "#60a5fa" },
  }));

  return { nodes, edges };
}

export default function ArchitectureGraph({ repoId }) {
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showExternals, setShowExternals] = useState(true);
  const [selected, setSelected] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch(`/api/repos/${repoId}/graph`);
        if (!cancelled) setGraph(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  const filtered = useMemo(() => {
    if (!graph) return null;
    if (showExternals) return graph;
    return {
      ...graph,
      nodes: graph.nodes.filter((n) => n.type === "internal"),
      edges: graph.edges.filter((e) => e.type === "internal"),
    };
  }, [graph, showExternals]);

  useEffect(() => {
    if (!filtered) return;
    const { nodes: ln, edges: le } = layoutElements(filtered.nodes, filtered.edges);
    setNodes(ln);
    setEdges(le);
    setSelected(null);
  }, [filtered, setNodes, setEdges]);

  const onNodeClick = useCallback((_, node) => {
    setSelected(node.data.node);
  }, []);

  const outgoing = useMemo(() => {
    if (!selected || !filtered) return [];
    return filtered.edges.filter((e) => e.source === selected.id).map((e) => e.target);
  }, [selected, filtered]);

  if (loading)
    return <p className="py-8 text-center text-sm text-gray-500">Loading dependency graph…</p>;
  if (error) {
    const isNoAnalysis = /No analysis found/.test(error);
    return (
      <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-6 text-center">
        <p className="text-sm text-amber-300">{error}</p>
        {isNoAnalysis && (
          <p className="mt-1 text-xs text-amber-400/70">Run code analysis first, then revisit this tab.</p>
        )}
      </div>
    );
  }

  if (!filtered || filtered.nodes.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">No dependencies found for this repository.</p>;
  }

  return (
    <div>
      <style>{`
        .react-flow__controls { background: #1f2937 !important; border: 1px solid #374151 !important; border-radius: 8px !important; }
        .react-flow__controls-button { background: #1f2937 !important; border-bottom: 1px solid #374151 !important; color: #9ca3af !important; fill: #9ca3af !important; }
        .react-flow__controls-button:hover { background: #374151 !important; }
        .react-flow__controls-button svg { fill: #9ca3af !important; }
        .react-flow__minimap { border: 1px solid #374151 !important; }
      `}</style>

      {graph.warning && (
        <div className="mb-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-2 text-sm text-amber-300">
          {graph.warning} — {graph.stats.totalNodes} nodes. Use the filter below to simplify.
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-400">
          {filtered.nodes.filter((n) => n.type === "internal").length} files
          {" · "}
          {filtered.nodes.filter((n) => n.type === "external").length} packages
          {" · "}
          {filtered.edges.length} edges
        </span>
        <label className="ml-auto flex items-center gap-2 text-gray-300">
          <input
            type="checkbox"
            checked={showExternals}
            onChange={(e) => setShowExternals(e.target.checked)}
            className="accent-blue-500"
          />
          Show external packages
        </label>
        <span className="flex items-center gap-2 text-xs">
          <span className="inline-block h-3 w-3 rounded bg-[#1e3a5f] ring-1 ring-blue-500" /> internal
          <span className="inline-block h-3 w-3 rounded bg-amber-500" /> external
        </span>
      </div>

      <div className="h-[560px] overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.22 }}
          minZoom={0.12}
          maxZoom={1.6}
          nodesDraggable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1.2} color="#1f2937" />
          <Controls position="top-left" showInteractive={false} />
          <MiniMap
            nodeColor={(n) => (n.style?.background === "#f59e0b" ? "#f59e0b" : "#3b82f6")}
            maskColor="rgba(0,0,0,0.55)"
            style={{ background: "#111827", border: "1px solid #1f2937" }}
          />
        </ReactFlow>
      </div>

      {selected && (
        <div className="mt-3 rounded-lg border border-gray-800 bg-gray-900 p-4">
          <p className="font-mono text-sm font-semibold text-white">{selected.label}</p>
          <p className="mt-1 break-all font-mono text-xs text-gray-400">{selected.id.replace(/^ext:/, "")}</p>
          {selected.type === "internal" && (
            <p className="mt-2 text-xs text-gray-400">
              In-degree: <span className="font-semibold text-gray-200">{selected.inDegree}</span>
              {" · "}Type: internal file
            </p>
          )}
          {selected.type === "external" && <p className="mt-2 text-xs text-amber-300">External package</p>}
          {outgoing.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-400">Depends on ({outgoing.length}):</p>
              <ul className="mt-1 max-h-32 list-inside list-disc overflow-auto font-mono text-xs text-gray-300">
                {outgoing.map((t) => (
                  <li key={t} className="truncate">
                    {t.replace(/^ext:/, "")}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-500">No outgoing dependencies.</p>
          )}
        </div>
      )}
    </div>
  );
}