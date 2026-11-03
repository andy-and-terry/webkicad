// KiCad Online storage API — val.town HTTP val.
// Storage: std/blob, every key prefixed "kicad/". Auth: "Authorization: Bearer <KICAD_KEY>".
//
//   GET    /                 -> JSON [{name, size, lastModified}]   (?prefix=proj/foo/ to filter)
//   GET    /<name>           -> file body (text/plain)
//   PUT    /<name>           -> store request body, returns {ok, name, size}
//   DELETE /<name>           -> {ok, name}
// <name> may contain "/" (e.g. proj/board/board.kicad_sch). Max body 10 MB.
import { blob } from "https://esm.town/v/std/blob";

const PREFIX = "kicad/";
const MAX = 10 * 1024 * 1024;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function validName(name: string): boolean {
  return name.length > 0 && name.length < 512 && !name.split("/").some((p) => p === "" || p === "." || p === "..") &&
    !/[\x00-\x1f\\]/.test(name);
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const key = Deno.env.get("KICAD_KEY");
  if (!key) return json({ error: "server misconfigured: KICAD_KEY env var not set" }, 500);
  const auth = req.headers.get("Authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${key}`)) return json({ error: "unauthorized: bad or missing API key" }, 401);

  const url = new URL(req.url);
  let name: string;
  try {
    name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    return json({ error: "bad path encoding" }, 400);
  }

  try {
    if (name === "") {
      if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
      const prefix = url.searchParams.get("prefix") ?? "";
      const items = await blob.list(PREFIX + prefix);
      return json(items.map((b: { key: string; size?: number; lastModified?: string }) => ({
        name: b.key.slice(PREFIX.length),
        size: b.size ?? null,
        lastModified: b.lastModified ?? null,
      })));
    }
    if (!validName(name)) return json({ error: `invalid name: ${name}` }, 400);
    const k = PREFIX + name;
    switch (req.method) {
      case "GET": {
        const res = await blob.get(k);
        if (!res || !res.ok) return json({ error: `not found: ${name}` }, 404);
        return new Response(await res.text(), { headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
      }
      case "PUT": {
        const body = await req.text();
        if (body.length > MAX) return json({ error: "file too large (max 10 MB)" }, 413);
        await blob.set(k, body);
        return json({ ok: true, name, size: body.length });
      }
      case "DELETE":
        await blob.delete(k);
        return json({ ok: true, name });
      default:
        return json({ error: "method not allowed" }, 405);
    }
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/not\s*found/i.test(msg)) return json({ error: `not found: ${name}` }, 404);
    return json({ error: `storage error: ${msg}` }, 500);
  }
}
