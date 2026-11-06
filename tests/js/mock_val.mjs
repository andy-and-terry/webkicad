// In-memory implementation of val.ts semantics for browser tests.
import http from "node:http";
export function startMockVal(port, key = "testkey") {
  const store = new Map();
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type" };
  const srv = http.createServer(async (req, res) => {
    const send = (s, body, type = "application/json") => { res.writeHead(s, { ...cors, "Content-Type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (req.headers.authorization !== `Bearer ${key}`) return send(401, { error: "unauthorized: bad or missing API key" });
    const u = new URL(req.url, "http://x");
    const name = decodeURIComponent(u.pathname.slice(1));
    if (!name) {
      const p = u.searchParams.get("prefix") || "";
      return send(200, [...store].filter(([k]) => k.startsWith(p)).map(([k, v]) => ({ name: k, size: v.text.length, lastModified: v.t })));
    }
    if (req.method === "GET") return store.has(name) ? send(200, store.get(name).text, "text/plain") : send(404, { error: `not found: ${name}` });
    if (req.method === "PUT") { let b = ""; for await (const c of req) b += c; store.set(name, { text: b, t: new Date().toISOString() }); return send(200, { ok: true, name }); }
    if (req.method === "DELETE") { store.delete(name); return send(200, { ok: true, name }); }
    send(405, { error: "method not allowed" });
  });
  return new Promise((r) => srv.listen(port, () => r({ srv, store })));
}
