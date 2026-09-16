// Requests are always same-origin: /api and /auth are proxied to the backend by
// Vercel's rewrites in production (client/vercel.json) and by the Vite dev
// proxy locally (client/vite.config.js). No env var is needed — leaving the
// base empty keeps both flows strictly relative.
export const API_URL = "";