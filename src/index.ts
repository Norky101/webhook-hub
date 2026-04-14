import { Hono } from "hono";

/** Env bindings for Cloudflare Workers */
export type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

// Health check — proves the worker is alive
app.get("/", (c) => c.json({ status: "ok", service: "webhook-hub" }));
app.get("/api/health", (c) => c.json({ status: "ok", service: "webhook-hub" }));

export default {
  fetch: app.fetch,

  // Cron trigger for retry engine (Phase 5)
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    // TODO: process retry queue
  },
};
