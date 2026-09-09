import { handleApi } from "./api";
import { cors } from "./respond";
import { handleRest } from "./rest";
import { handleSettings } from "./settings";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/rest" || path.startsWith("/rest/")) {
        return await handleRest(request, env);
      }
      if (path === "/api/settings" || path.startsWith("/api/settings/")) {
        return await handleSettings(request, env);
      }
      if (path === "/api" || path.startsWith("/api/")) {
        return await handleApi(request, env);
      }
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response("Relief", { headers: { "content-type": "text/plain; charset=utf-8", ...cors() } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return new Response(JSON.stringify({ ok: false, error: message }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8", ...cors() },
      });
    }
  },
};
