// val.town storage client with explicit, user-readable errors.
const LS_URL = "kicad.apiUrl", LS_KEY = "kicad.apiKey";

const ls = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export const settings = {
  get url() { return ls.get(LS_URL).replace(/\/+$/, ""); },
  set url(v) { ls.set(LS_URL, v.trim()); },
  get key() { return ls.get(LS_KEY); },
  set key(v) { ls.set(LS_KEY, v.trim()); },
  get configured() { return !!(this.url && this.key); },
};

export class ApiError extends Error {
  constructor(kind, message, status) { super(message); this.kind = kind; this.status = status; }
}

const enc = (name) => name.split("/").map(encodeURIComponent).join("/");

async function call(method, path, body, { timeout = 20000 } = {}) {
  if (!settings.configured) throw new ApiError("config", "Storage not configured: open Settings and enter the val.town URL and API key.");
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new ApiError("offline", "You appear to be offline.");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(settings.url + path, {
      method, body, signal: ctl.signal,
      headers: { Authorization: `Bearer ${settings.key}`, ...(body != null ? { "Content-Type": "text/plain" } : {}) },
    });
  } catch (e) {
    if (e.name === "AbortError") throw new ApiError("timeout", `Request timed out after ${timeout / 1000}s (${method} ${path}).`);
    // fetch() rejects with TypeError for DNS failure, refused connection AND CORS rejections; browsers hide which.
    throw new ApiError("network", `Cannot reach ${settings.url}: network down, wrong URL, or CORS blocked (the val must send Access-Control-Allow-Origin). [${e.message}]`);
  } finally {
    clearTimeout(timer);
  }
  if (res.ok) return res;
  let msg = "";
  try { const j = await res.json(); msg = j.error || JSON.stringify(j); } catch { msg = res.statusText; }
  if (res.status === 401 || res.status === 403) throw new ApiError("auth", `Bad API key (${res.status}): ${msg}. Check Settings.`, res.status);
  if (res.status === 404) throw new ApiError("notfound", msg || "Not found", 404);
  throw new ApiError("server", `Server error ${res.status}: ${msg}`, res.status);
}

export const api = {
  async list(prefix = "") {
    const r = await call("GET", "/" + (prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""));
    const j = await r.json();
    if (!Array.isArray(j)) throw new ApiError("server", "Unexpected list response (is the URL pointing at the KiCad val?)");
    return j;
  },
  async get(name) { return (await call("GET", "/" + enc(name))).text(); },
  async put(name, text) { return (await call("PUT", "/" + enc(name), text)).json(); },
  async del(name) { return (await call("DELETE", "/" + enc(name))).json(); },
};
