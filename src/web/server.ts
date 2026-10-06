import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { SettingsStore } from "../settings.ts";

export interface WebRuntime {
  status(): unknown;
  apply(): Promise<void>;
  reload(): Promise<void>;
  reconnect(): Promise<void>;
}

export function createWebHandler(store: SettingsStore, runtime: WebRuntime, password?: string, staticDir = path.resolve("web/dist")) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
    // Health remains local/internal on its separate listener, never here.
    if (password) {
      let provided = "";
      try {
        const auth = req.headers.get("authorization") ?? "";
        if (auth.startsWith("Basic ")) provided = Buffer.from(auth.slice(6), "base64").toString().split(":").slice(1).join(":");
      } catch {}
      const a = Buffer.from(provided), b = Buffer.from(password);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Sign in with username admin and the configured Web UI password.", { status: 401, headers: { "www-authenticate": 'Basic realm="Chatzy Bot"' } });
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      // Only same-origin browser mutations; no cross-site settings changes.
      const origin = req.headers.get("origin");
      const externalOrigin = req.headers.get("x-forwarded-proto") === "https" ? `https://${url.host}` : url.origin;
      if (origin !== url.origin && origin !== externalOrigin) return json({ error: "Same-origin requests required" }, 403);
      if (req.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Cross-site requests denied" }, 403);
      if (!req.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON required" }, 415);
      if (Number(req.headers.get("content-length") ?? 0) > 4_000_000) return json({ error: "Request too large" }, 413);
    }
    try {
      if (url.pathname === "/api/status" && req.method === "GET") return json(runtime.status());
      if (url.pathname === "/api/settings" && req.method === "GET") return json(store.publicSettings());
      if (url.pathname === "/api/settings" && req.method === "PUT") {
        const text = await req.text();
        if (text.length > 100_000) return json({ error: "Settings too large" }, 413);
        await store.saveEnv(JSON.parse(text));
        await runtime.apply();
        return json(store.publicSettings());
      }
      if (url.pathname === "/api/jokes" && req.method === "GET") return json(store.jokes);
      if (url.pathname === "/api/commands" && req.method === "GET") return json(store.commands);
      if (url.pathname === "/api/commands" && req.method === "PUT") {
        const text = await req.text();
        if (text.length > 4_000_000) return json({ error: "Commands too large" }, 413);
        await store.saveCommands(JSON.parse(text));
        return json(store.commands);
      }
      if (url.pathname === "/api/jokes" && req.method === "PUT") {
        const text = await req.text();
        if (text.length > 4_000_000) return json({ error: "Jokes too large" }, 413);
        await store.saveJokes(JSON.parse(text));
        return json(store.jokes);
      }
      if (req.method === "POST") {
        if (url.pathname === "/api/reload") { await runtime.reload(); return json({ ok: true }); }
        if (url.pathname === "/api/reconnect") { await runtime.reconnect(); return json({ ok: true }); }
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
      if (!["GET", "HEAD"].includes(req.method)) return new Response("Method not allowed", { status: 405 });
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const filePath = path.resolve(staticDir, relative || "index.html");
      if (!filePath.startsWith(staticDir + path.sep)) return new Response("Not found", { status: 404 });
      const file = Bun.file(filePath);
      if (!(await file.exists())) return new Response("Web UI assets missing. Run bun run build:web.", { status: 404 });
      return new Response(req.method === "HEAD" ? null : file, { headers: { "content-type": file.type, "cache-control": relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache", "x-content-type-options": "nosniff" } });
    } catch (e) {
      // Zod includes input in some issues; return messages only, never secrets.
      const err = e as { issues?: { path: unknown[]; message: string }[]; message?: string };
      return json({ error: err.issues ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : err.message ?? "Request failed" }, 400);
    }
  };
}
