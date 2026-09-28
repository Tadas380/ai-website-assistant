// Run with:  npm test   (Node 18+, no dependencies)
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// A fake Gemini API so tests never call the real one.
let lastGeminiBody = null;
let nextReply = "Hello!";
const fakeGemini = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    lastGeminiBody = JSON.parse(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: nextReply }] } }] }));
  });
});

let base;
let app;

test.before(async () => {
  await new Promise(r => fakeGemini.listen(0, r));
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${fakeGemini.address().port}`;
  process.env.ADMIN_KEY = "secret";
  process.env.DISCORD_WEBHOOK_URL = "";
  app = require("../server.js");
  await new Promise(r => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(() => {
  app.server.close();
  fakeGemini.close();
  fs.rmSync(path.join(__dirname, "..", "data"), { recursive: true, force: true });
});

test("extractLead: plain reply has no lead", () => {
  const { reply, lead } = app.extractLead("We are open 24/7.");
  assert.equal(reply, "We are open 24/7.");
  assert.equal(lead, null);
});

test("extractLead: pulls the JSON out and hides the marker", () => {
  const { reply, lead } = app.extractLead('Thanks, Mantas!\n[[LEAD]]{"name":"Mantas","phone":"+370 600 00000","club":"Centras","goal":"strength"}');
  assert.equal(reply, "Thanks, Mantas!");
  assert.deepEqual(lead, { name: "Mantas", phone: "+370 600 00000", club: "Centras", goal: "strength" });
});

test("extractLead: broken JSON never leaks the marker to the visitor", () => {
  const { reply, lead } = app.extractLead("Thanks!\n[[LEAD]]{not json");
  assert.equal(reply, "Thanks!");
  assert.equal(lead, null);
});

test("buildSystemPrompt: grounds the model in business.json", () => {
  const biz = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "business.json"), "utf8"));
  const prompt = app.buildSystemPrompt(biz);
  assert.match(prompt, /Pulse AI/);
  assert.match(prompt, /Reply in English by default/);
  assert.match(prompt, /€17\.90/);                    // prices come from the info block
  assert.match(prompt, /\[\[LEAD\]\]\{"name":"\.\.\."/); // lead format is spelled out
});

test("buildSystemPrompt: no lead section when leads are disabled", () => {
  const prompt = app.buildSystemPrompt({ name: "X", type: "shop", phone: "1", info: {}, lead: { enabled: false } });
  assert.doesNotMatch(prompt, /\[\[LEAD\]\]/);
});

test("rateLimited: allows 20 messages a minute per IP, then blocks", () => {
  const ip = "10.9.8.7";
  for (let i = 0; i < 20; i++) assert.equal(app.rateLimited(ip), false);
  assert.equal(app.rateLimited(ip), true);
});

test("GET /api/info returns public widget settings only", async () => {
  const info = await (await fetch(`${base}/api/info`)).json();
  assert.equal(info.assistantName, "Pulse AI");
  assert.ok(Array.isArray(info.chips));
  assert.equal(info.info, undefined, "business facts are not exposed");
  assert.equal(info.rules, undefined, "prompt rules are not exposed");
});

test("POST /api/chat sends history to Gemini and returns the reply", async () => {
  nextReply = "Basic is cheapest.";
  const r = await fetch(`${base}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", text: "Cheapest?" }] }),
  });
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.reply, "Basic is cheapest.");
  assert.equal(data.leadSaved, false);
  assert.equal(lastGeminiBody.contents.at(-1).parts[0].text, "Cheapest?");
  assert.match(lastGeminiBody.system_instruction.parts[0].text, /BUSINESS INFO/);
});

test("POST /api/chat saves a confirmed lead and shows it on /admin", async () => {
  nextReply = 'Thanks!\n[[LEAD]]{"name":"Greta","phone":"+370 600 00001","club":"Dainava","goal":"yoga"}';
  const data = await (await fetch(`${base}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", text: "Yes, confirm" }] }),
  })).json();
  assert.equal(data.reply, "Thanks!");
  assert.equal(data.leadSaved, true);

  assert.equal((await fetch(`${base}/admin`)).status, 401);
  const html = await (await fetch(`${base}/admin?key=secret`)).text();
  assert.match(html, /Greta/);
});

test("POST /api/chat rejects empty or malformed requests", async () => {
  const bad = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" });
  assert.equal(bad.status, 400);
  const empty = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [] }) });
  assert.equal(empty.status, 400);
});

test("static files can't escape the public folder", async () => {
  const r = await fetch(`${base}/..%2fserver.js`);
  assert.notEqual(r.status, 200);
});
