import { API_URL } from "./config";

async function apiFetch(path, options = {}) {
  // credentials:"include" always — without it the sameSite cookie (prod) or lax
  // cookie (dev) never reaches the backend on cross-origin requests.
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }

  if (!res.ok) {
    const error = new Error(data?.error || data?.message || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }

  return data;
}

export default apiFetch;