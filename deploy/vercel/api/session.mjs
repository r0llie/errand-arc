import {
  SessionError,
  applyAction,
  createSession,
  normalizeSessionId,
} from "../lib/session-core.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const memory = globalThis.__errandDemoSessions || new Map();
globalThis.__errandDemoSessions = memory;
const fallbackPath = path.join(os.tmpdir(), "errand-demo-sessions-v1.json");

async function hydrateFallback() {
  try {
    const values = JSON.parse(await fs.readFile(fallbackPath, "utf8"));
    for (const [key, value] of Object.entries(values)) memory.set(key, value);
  } catch {
    // No local fallback has been written yet.
  }
}

async function writeFallback() {
  await fs.writeFile(
    fallbackPath,
    JSON.stringify(Object.fromEntries(memory)),
    "utf8",
  );
}

async function runtimeCache() {
  try {
    const { getCache } = await import("@vercel/functions");
    return getCache({ namespace: "errand-demo-v1" });
  } catch {
    return null;
  }
}

export function createStore() {
  return {
    async get(id) {
      const cache = await runtimeCache();
      if (cache) {
        try {
          const value = await cache.get(id);
          if (value) return value;
        } catch {
          // Local development and unsupported runtimes use the in-memory fallback.
        }
      }
      await hydrateFallback();
      return memory.get(id) || createSession();
    },
    async set(id, value) {
      await hydrateFallback();
      memory.set(id, value);
      await writeFallback();
      const cache = await runtimeCache();
      if (cache) {
        try {
          await cache.set(id, value, {
            ttl: 60 * 60 * 24,
            tags: [`session-${id}`],
            name: "judge-demo-session",
          });
        } catch {
          // The warm-instance copy still keeps local development functional.
        }
      }
      return value;
    },
  };
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(payload));
}

export function createHandler(store = createStore()) {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url || "/api/session", "https://errand.local");
      const id = normalizeSessionId(url.searchParams.get("session"));

      if (req.method === "GET") {
        return send(res, 200, { session: id, state: await store.get(id) });
      }

      if (req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        return send(res, 405, { error: "Method not allowed." });
      }

      const body =
        typeof req.body === "object" && req.body !== null ? req.body : {};
      const current = await store.get(id);
      const next = applyAction(current, body);
      if (!next.replayed) await store.set(id, next);
      return send(res, 200, { session: id, state: next });
    } catch (error) {
      if (error instanceof SessionError)
        return send(res, error.status, { error: error.message });
      return send(res, 500, { error: "Session service failed." });
    }
  };
}

export default createHandler();
