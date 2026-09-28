// AI website assistant for small businesses (gym, café, salon…) using the Google Gemini API.
// No npm packages needed. Node.js 18 or newer.
// Start with:  node server.js

const http = require("http");
const fs = require("fs");
const path = require("path");

// ---------- tiny .env loader (so you don't need the dotenv package) ----------
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
const BUSINESS_FILE = process.env.BUSINESS_FILE || path.join(__dirname, "business.json");

const DATA_DIR = path.join(__dirname, "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const PUBLIC_DIR = path.join(__dirname, "public");

function loadBusiness() {
  return JSON.parse(fs.readFileSync(BUSINESS_FILE, "utf8"));
}

// ---------- the instructions the AI follows (built from business.json) ----------
function buildSystemPrompt(biz) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Vilnius",
  });
  const lead = biz.lead && biz.lead.enabled ? biz.lead : null;
  const example = lead ? "{" + lead.fields.map(f => `"${f}":"..."`).join(",") + ',"notes":"..."}' : "";
  return `You are ${biz.assistantName || "the assistant"}, the website chat assistant of ${biz.name}, a ${biz.type}.
Today is ${today} (Europe/Vilnius time).

RULES
- Reply in ${biz.defaultLanguage || "English"} by default. If the customer writes in another language (English, Russian, Polish, Ukrainian, German or any other), always reply in the language of their latest message.
- Keep answers short: 1–4 sentences. Plain text; short dash lists are OK.
- Only use the BUSINESS INFO below. If something isn't there, say you're not sure and suggest calling ${biz.phone}${biz.website ? " or visiting " + biz.website : ""}. Never invent prices, times, services or policies.
- Stay on topic. Politely decline unrelated requests.
${(biz.rules || []).map(r => "- " + r).join("\n")}
${lead ? `
LEADS (${lead.purpose})
- When someone is interested, offer to arrange it. Collect: ${lead.fields.join(", ")}. Ask for missing details naturally, a couple at a time.
- Repeat the details and ask them to confirm.
- ONLY after they confirm: thank them. ${lead.confirmText || ""} Put this on the very last line, exactly:
[[LEAD]]${example}
- Never output that line in any other situation.` : ""}

BUSINESS INFO (JSON)
${JSON.stringify(biz.info || {}, null, 1)}`;
}

// ---------- Gemini call ----------
async function askGemini(systemPrompt, messages) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing. Put it in the .env file.");
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }],
  }));
  const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data.error && data.error.message) || `HTTP ${r.status}`;
    const err = new Error(`Gemini error: ${msg}`);
    err.status = r.status;
    throw err;
  }
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts.filter(p => typeof p.text === "string" && !p.thought).map(p => p.text).join("").trim();
  if (!text) throw new Error("Gemini returned an empty answer.");
  return text;
}

// ---------- leads (trial sign-ups, bookings, callbacks) ----------
function extractLead(text) {
  const MARK = "[[LEAD]]";
  const idx = text.indexOf(MARK);
  if (idx === -1) return { reply: text, lead: null };
  const reply = text.slice(0, idx).trim();
  const jsonPart = text.slice(idx + MARK.length).trim();
  const match = jsonPart.match(/\{[\s\S]*\}/);
  let lead = null;
  if (match) { try { lead = JSON.parse(match[0]); } catch { /* ignore */ } }
  return { reply: reply || "Thank you! The team will contact you soon.", lead };
}

function readLeads() {
  try { return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8")); } catch { return []; }
}

async function saveLead(lead, biz) {
  const entry = { ...lead, receivedAt: new Date().toISOString() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const all = readLeads();
  all.push(entry);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(all, null, 2));
  console.log("New lead:", entry);

  if (DISCORD_WEBHOOK_URL) {
    const clean = v => String(v == null || v === "" ? "-" : v).slice(0, 200);
    const labels = (biz.lead && biz.lead.labels) || {};
    const lines = Object.entries(lead).map(([k, v]) => `**${labels[k] || k[0].toUpperCase() + k.slice(1)}:** ${clean(v)}`);
    try {
      await fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `🔔 **${(biz.lead && biz.lead.alertTitle) || "New lead"} – ${biz.name}**\n` + lines.join("\n") }),
      });
    } catch (e) { console.error("Discord webhook failed:", e.message); }
  }
  return entry;
}

// ---------- simple rate limit: 20 messages / minute / IP ----------
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 20;
}

// ---------- HTTP helpers ----------
function cors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes("*")) res.setHeader("Access-Control-Allow-Origin", "*");
  else if (origin && ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 50_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function serveStatic(req, res, pathname) {
  const file = pathname === "/" ? "/index.html" : pathname;
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(buf);
  });
}

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  // Public info for the widget header
  if (url.pathname === "/api/info" && req.method === "GET") {
    const biz = loadBusiness();
    return sendJson(res, 200, {
      name: biz.name, assistantName: biz.assistantName || "Assistant",
      welcome: biz.welcome || "Hi! How can I help?", chips: biz.chips || [], icon: biz.icon || "AI",
      buttonLabel: biz.buttonLabel || "Ask us", theme: biz.theme || {}, ui: biz.ui || {},
    });
  }

  // Chat
  if (url.pathname === "/api/chat" && req.method === "POST") {
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    if (rateLimited(ip)) return sendJson(res, 429, { error: "Too many messages. Please wait a minute." });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: "Bad request" }); }

    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter(m => m && typeof m.text === "string" && m.text.trim())
      .slice(-20)
      .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", text: m.text.slice(0, 1000) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return sendJson(res, 400, { error: "Send at least one user message." });
    }

    try {
      const biz = loadBusiness();
      const raw = await askGemini(buildSystemPrompt(biz), messages);
      const { reply, lead } = extractLead(raw);
      let saved = null;
      if (lead) saved = await saveLead(lead, biz);
      return sendJson(res, 200, { reply, leadSaved: !!saved });
    } catch (e) {
      console.error(e.message);
      const busy = e.status === 429;
      return sendJson(res, busy ? 503 : 500, {
        error: busy ? "The assistant is busy right now. Please try again in a minute." : "Sorry, something went wrong. Please try again.",
      });
    }
  }

  // Owner page: list of leads (needs ?key=ADMIN_KEY)
  if (url.pathname === "/admin" && req.method === "GET") {
    if (!ADMIN_KEY || url.searchParams.get("key") !== ADMIN_KEY) {
      res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Unauthorized. Set ADMIN_KEY in .env and open /admin?key=YOUR_KEY");
    }
    const biz = loadBusiness();
    const leads = readLeads().slice().reverse();
    const cols = [...new Set(leads.flatMap(l => Object.keys(l)))];
    const labels = { ...((biz.lead && biz.lead.labels) || {}), receivedAt: "Received (UTC)" };
    const head = cols.map(c => `<th>${esc(labels[c] || c)}</th>`).join("");
    const rows = leads.map(l => "<tr>" + cols.map(c => `<td>${esc(c === "receivedAt" ? String(l[c] || "").replace("T", " ").slice(0, 16) : l[c])}</td>`).join("") + "</tr>").join("");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Leads – ${esc(biz.name)}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#222}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:14px}th{background:#f3f3f3;text-transform:capitalize}</style>
<h1>Leads – ${esc(biz.name)}</h1>
${leads.length ? `<table><tr>${head}</tr>${rows}</table>` : "<p>No leads yet.</p>"}`);
  }

  if (req.method === "GET") return serveStatic(req, res, url.pathname);
  res.writeHead(405); res.end();
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`AI assistant running:  http://localhost:${PORT}`);
    console.log(`Model: ${GEMINI_MODEL}   API key: ${GEMINI_API_KEY ? "set" : "MISSING – add it to .env"}`);
    if (DISCORD_WEBHOOK_URL) console.log("Discord alerts: on");
  });
}

module.exports = { server, buildSystemPrompt, extractLead, rateLimited };
