# CodeLens

AI-Powered Codebase Intelligence Platform that connects to GitHub repositories, analyzes source code and structure, and helps developers understand architecture, measure code health, identify technical debt, and interact with their codebase through context-aware AI Q&A.

## Project Structure

```
codelens/
├── client/          # React + Vite + Tailwind CSS frontend
├── server/          # Node.js + Express backend
├── package.json     # Root package with dev scripts
└── SPEC.md          # Full project specification
```

## Prerequisites

- Node.js (v18+)
- npm
- MongoDB Atlas account (or local MongoDB)

## Setup

1. **Install all dependencies:**

   ```bash
   npm run install:all
   ```

2. **Configure environment variables:**

   ```bash
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```

   Edit `server/.env` with your MongoDB URI and other credentials.

3. **Run both servers in dev mode:**

   ```bash
   npm run dev
   ```

   - Client: http://localhost:5173
   - Server: http://localhost:5000
   - Health check: http://localhost:5000/api/health
