async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
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