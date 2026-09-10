import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import apiFetch from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";

export default function RepoDetail() {
  const { id } = useParams();
  const [repo, setRepo] = useState(null);
  const [files, setFiles] = useState(null);
  const [error, setError] = useState(null);

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
    return <p className="text-sm text-gray-500">Loading repository…</p>;
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

      <h2 className="mt-8 text-lg font-semibold">Files</h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Path</th>
              <th className="px-4 py-3 text-right">Size</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 bg-gray-950">
            {files.map((file) => (
              <tr key={file.path} className="font-mono hover:bg-gray-900">
                <td className="px-4 py-2 text-gray-300">{file.path}</td>
                <td className="px-4 py-2 text-right text-gray-500">
                  {formatBytes(file.size)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}