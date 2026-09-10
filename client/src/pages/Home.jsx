import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Home() {
  const { user, loading, login } = useAuth();

  return (
    <div className="flex flex-col items-center py-24 text-center">
      <h1 className="text-5xl font-bold tracking-tight">CodeLens</h1>
      <p className="mt-4 max-w-xl text-lg text-gray-400">
        AI-Powered Codebase Intelligence Platform. Connect your GitHub, ingest a
        repository, and get answers about your code.
      </p>

      {loading ? (
        <p className="mt-8 text-sm text-gray-500">Checking your session…</p>
      ) : user ? (
        <div className="mt-8 flex flex-col items-center gap-4">
          <Link
            to="/repos"
            className="rounded-lg bg-white px-6 py-3 font-semibold text-gray-950 transition hover:bg-gray-200"
          >
            Select a repository
          </Link>
          <p className="text-sm text-gray-500">
            Signed in as <span className="text-gray-300">{user.username}</span>
          </p>
        </div>
      ) : (
        <button
          onClick={login}
          className="mt-8 rounded-lg bg-white px-6 py-3 font-semibold text-gray-950 transition hover:bg-gray-200"
        >
          Sign in with GitHub
        </button>
      )}
    </div>
  );
}