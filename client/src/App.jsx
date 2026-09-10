import { useAuth } from './context/AuthContext'

function App() {
  const { user, loading, login, logout } = useAuth()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white">
      <h1 className="text-5xl font-bold tracking-tight">CodeLens</h1>
      <p className="mt-4 text-lg text-gray-400">
        AI-Powered Codebase Intelligence Platform
      </p>

      {loading ? (
        <p className="mt-8 text-sm text-gray-500">Checking your session…</p>
      ) : user ? (
        <div className="mt-8 flex flex-col items-center gap-4">
          <img
            src={user.avatarUrl}
            alt={`${user.username} avatar`}
            className="h-16 w-16 rounded-full border border-gray-700"
          />
          <p className="text-lg font-medium">Signed in as {user.username}</p>
          <button
            onClick={logout}
            className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-300 transition hover:bg-gray-800"
          >
            Sign out
          </button>
        </div>
      ) : (
        <div className="mt-8 flex flex-col items-center gap-4">
          <button
            onClick={login}
            className="rounded-lg bg-white px-6 py-3 font-semibold text-gray-950 transition hover:bg-gray-200"
          >
            Sign in with GitHub
          </button>
        </div>
      )}
    </div>
  )
}

export default App