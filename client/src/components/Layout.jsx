import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const navLinkClass = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-gray-800 text-white"
      : "text-gray-400 hover:bg-gray-800/50 hover:text-white"
  }`;

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="text-lg font-bold tracking-tight">
            CodeLens
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/repos" className={navLinkClass}>
              Select repository
            </NavLink>
            <NavLink to="/my" className={navLinkClass}>
              My repositories
            </NavLink>
            <div className="ml-3 flex items-center gap-2 border-l border-gray-800 pl-3">
              {user?.avatarUrl && (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-7 w-7 rounded-full border border-gray-700"
                />
              )}
              <span className="hidden text-sm text-gray-400 sm:inline">
                {user?.username}
              </span>
              <button
                onClick={logout}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition hover:bg-gray-800"
              >
                Sign out
              </button>
            </div>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}