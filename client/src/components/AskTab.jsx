import { useEffect, useState } from "react";
import apiFetch from "../lib/api";

export default function AskTab({ repoId }) {
  const [embedStatus, setEmbedStatus] = useState(null);
  const [embedding, setEmbedding] = useState(false);
  const [embedError, setEmbedError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [askError, setAskError] = useState(null);

  async function loadEmbedStatus() {
    try {
      const data = await apiFetch(`/api/repos/${repoId}/embed-status`);
      setEmbedStatus(data);
    } catch (e) {
      setEmbedStatus({ embeddingStatus: "none" });
    }
  }

  async function loadHistory() {
    try {
      const data = await apiFetch(`/api/repos/${repoId}/chat-history?limit=50`);
      const sorted = [...(data.messages || [])].reverse();
      setMessages(sorted);
    } catch {}
  }

  useEffect(() => {
    loadEmbedStatus();
  }, [repoId]);

  useEffect(() => {
    if (embedStatus?.embeddingStatus === "complete") loadHistory();
  }, [embedStatus?.embeddingStatus]);

  async function handleGenerateEmbeddings() {
    setEmbedding(true);
    setEmbedError(null);
    try {
      await apiFetch(`/api/repos/${repoId}/embed`, { method: "POST" });
      await loadEmbedStatus();
    } catch (e) {
      if (/already exist/.test(e.message)) {
        setEmbedError(e.message + " (use re-generate if needed)");
        await loadEmbedStatus();
      } else {
        setEmbedError(e.message);
      }
    } finally {
      setEmbedding(false);
    }
  }

  async function handleForceRegenerate() {
    setEmbedding(true);
    setEmbedError(null);
    try {
      await apiFetch(`/api/repos/${repoId}/embed?force=true`, { method: "POST" });
      await loadEmbedStatus();
    } catch (e) {
      setEmbedError(e.message);
    } finally {
      setEmbedding(false);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    const q = input.trim();
    if (!q || sending) return;
    setAskError(null);
    setInput("");
    const userMsg = { role: "user", content: q, id: `tmp-${Date.now()}`, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    try {
      const data = await apiFetch(`/api/repos/${repoId}/ask`, {
        method: "POST",
        body: JSON.stringify({ question: q }),
      });
      const assistantMsg = {
        role: "assistant",
        content: data.answer,
        sourceFiles: data.sourceFiles || [],
        id: data.messages?.[1]?.id || `a-${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev.slice(0, -1), { ...userMsg, id: data.messages?.[0]?.id || userMsg.id }, assistantMsg]);
    } catch (err) {
      const isRetryable = err.status === 503 || /busy|overloaded|high demand/i.test(err.message);
      const errorMsg = isRetryable 
        ? "The AI service is temporarily busy. Please try again in a moment."
        : err.message;
      const errorMsgObj = {
        role: "system",
        content: errorMsg,
        id: `err-${Date.now()}`,
        createdAt: new Date().toISOString(),
        isError: true,
      };
      setMessages((prev) => [...prev.slice(0, -1), errorMsgObj]);
      setInput(q);
    } finally {
      setSending(false);
    }
  }

  if (!embedStatus) {
    return <p className="py-8 text-center text-sm text-gray-500">Checking embeddings…</p>;
  }

  if (embedStatus.embeddingStatus !== "complete") {
    return (
      <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-6 py-8 text-center">
        <p className="text-sm font-medium text-amber-300">Embeddings not ready</p>
        <p className="mt-1 text-xs text-amber-400/70">
          Generate embeddings first — this chunks your JS/TS + markdown files and indexes them for semantic search.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            onClick={handleGenerateEmbeddings}
            disabled={embedding}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-gray-200 disabled:opacity-50"
          >
            {embedding ? "Generating…" : "Generate embeddings"}
          </button>
          {embedStatus.embeddingCount > 0 && (
            <button
              onClick={handleForceRegenerate}
              disabled={embedding}
              className="rounded-lg border border-amber-800 px-4 py-2 text-sm text-amber-300 hover:bg-amber-950/50 disabled:opacity-50"
            >
              Re-generate
            </button>
          )}
        </div>
        {embedError && <p className="mt-3 text-xs text-red-400">{embedError}</p>}
        {embedStatus.embeddingCount > 0 && (
          <p className="mt-2 text-xs text-gray-500">{embedStatus.embeddingCount} chunks from previous run still stored.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[560px] flex-col rounded-lg border border-gray-800 bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2 text-xs text-gray-500">
        <span>
          {embedStatus.embeddingCount} chunks indexed · {embedStatus.model || "gemini-embedding-001"} · 768d
        </span>
        <button onClick={handleForceRegenerate} disabled={embedding} className="text-amber-400 hover:text-amber-300 disabled:opacity-50">
          {embedding ? "Re-generating…" : "Re-generate embeddings"}
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4">
        {messages.length === 0 && (
          <p className="py-12 text-center text-sm text-gray-500">
            Ask anything about this codebase — e.g. “Where is authentication implemented?” or “How does the publish flow work?”
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-blue-600 text-white" : m.isError ? "bg-red-950/40 text-red-300" : "bg-gray-800 text-gray-100"}`}>
              <p className="whitespace-pre-wrap break-words">{m.content}</p>
              {m.role === "assistant" && m.sourceFiles?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.sourceFiles.map((f) => (
                    <span key={f} className="rounded bg-gray-700 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && <p className="text-xs text-gray-500">Thinking… retrieving relevant chunks and asking Gemini…</p>}
        {askError && <p className="rounded bg-red-950/40 px-3 py-2 text-xs text-red-300">{askError}</p>}
      </div>

      <form onSubmit={handleSend} className="flex gap-2 border-t border-gray-800 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this codebase…"
          className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
          disabled={sending || embedding}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-gray-200 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}