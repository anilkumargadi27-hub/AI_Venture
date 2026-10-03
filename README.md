# AI Venture Studio

Turn a startup idea into a structured venture blueprint with a guided AI-agent workflow.

## Quick start

1. Install Node.js 20 or newer and run `npm install` at the repository root.
2. Copy `server/.env.example` to `server/.env` and set `JWT_SECRET` (and optional service settings).
3. Run `npm run dev`. The client runs at http://localhost:5173 and the API at http://localhost:4000.

The dashboard works in local demo mode without MongoDB or Ollama. To persist data and generate reports with a local model, configure MongoDB and run Ollama, then set `OLLAMA_MODEL` in the server environment. Tavily, SMTP, and ChromaDB are optional integrations.

## Project layout

- `client/` React + Vite venture dashboard
- `server/` Express API, Mongoose models, agent orchestration, exports and integrations

## Configuration

See `server/.env.example`. Never commit secrets. Search falls back to DuckDuckGo when Tavily is not configured; report generation falls back to a deterministic local template when Ollama is unavailable.
