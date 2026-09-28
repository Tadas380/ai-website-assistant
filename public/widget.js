/*
  Chat widget. Put this ONE line on any website (before </body>):
    <script src="https://YOUR-APP.onrender.com/widget.js" data-color="#7a4b2a" defer></script>
  Everything else (name, colours, fonts, welcome text, quick questions, UI texts)
  comes from business.json via GET /api/info.
  Optional attributes:
    data-color   main colour (hex); overrides the theme in business.json
    data-open    "true" to open the chat automatically
*/
(function () {
  if (window.__bizAssistantLoaded) return;
  window.__bizAssistantLoaded = true;

  const script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  const API = new URL(script.src).origin;
  const COLOR = script.getAttribute("data-color") || "#1d2733";
  const AUTO_OPEN = script.getAttribute("data-open") === "true";
  const STORE_KEY = "biz-assistant-chat";

  const t = {
    hello: "Hi! 👋 How can I help?", chips: [],
    placeholder: "Type a message…", err: "Couldn't connect. Please try again.", online: "Online · replies instantly",
    open: "Open chat", reset: "New chat", close: "Close", send: "Send", powered: "Answers are AI-generated. Confirm important details with the team.",
  };

  let messages = [];
  try { messages = JSON.parse(sessionStorage.getItem(STORE_KEY) || "[]"); } catch { messages = []; }
  const save = () => { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-30))); } catch {} };

  // ---------- UI (inside Shadow DOM so the site's CSS can't break it) ----------
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;z-index:2147483000;bottom:0;right:0;";
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
  <style>
    :host { all: initial;
      --primary: ${COLOR}; --primary-ink: #fff; --accent: ${COLOR}; --accent-ink: #fff; --highlight: ${COLOR};
      --radius: 16px; --display-style: normal; --display-stretch: 100%; --font: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; --display: var(--font);
      --bg: #f5f6f8; --line: #e3e6ea; --ink: #1d2733; }
    * { box-sizing: border-box; font-family: var(--font); }
    .btn { position: fixed; right: 20px; bottom: 20px; height: 58px; min-width: 58px; padding: 0 20px 0 18px; border: none;
           border-radius: var(--radius); background: var(--primary); color: var(--primary-ink); cursor: pointer;
           box-shadow: 0 10px 28px rgba(10,20,40,.35); display: flex; align-items: center; gap: 10px;
           font: 800 13px var(--font); letter-spacing: .06em; text-transform: uppercase; transition: transform .2s, box-shadow .2s; }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(10,20,40,.4); }
    .btn:focus-visible, .send:focus-visible, .chip:focus-visible, .icon:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
    .btn svg { width: 24px; height: 24px; color: var(--accent); flex: none; }
    .btn .pulse { position: absolute; top: -4px; right: -4px; width: 14px; height: 14px; border-radius: 50%; background: var(--highlight); border: 2px solid #fff; }
    .panel { position: fixed; right: 20px; bottom: 92px; width: 380px; max-width: calc(100vw - 24px);
             height: 580px; max-height: calc(100vh - 120px); background: #fff; border-radius: var(--radius);
             box-shadow: 0 20px 60px rgba(10,20,40,.35); display: none; flex-direction: column; overflow: hidden; }
    .panel.open { display: flex; animation: pop .2s ease-out; }
    .panel.open ~ .btn .pulse, .btn.seen .pulse { display: none; }
    @keyframes pop { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
    .head { position: relative; background: var(--primary); color: var(--primary-ink); padding: 16px 16px 20px; display: flex; align-items: center; gap: 12px; }
    .head::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: var(--accent); }
    .avatar { width: 40px; height: 40px; border-radius: var(--radius); background: var(--accent); color: var(--accent-ink);
              display: grid; place-items: center; font: var(--display-style) 900 17px var(--display); letter-spacing: -.02em; }
    .title { font: var(--display-style) 900 15px var(--display); font-stretch: var(--display-stretch); text-transform: uppercase; letter-spacing: .02em; line-height: 1.2; }
    .sub { font-size: 12px; opacity: .8; display: flex; align-items: center; gap: 6px; margin-top: 2px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #3ee08f; box-shadow: 0 0 0 3px rgba(62,224,143,.2); }
    .icon { margin-left: auto; background: none; border: none; color: var(--primary-ink); cursor: pointer; opacity: .75; font-size: 14px; width: 30px; height: 30px; border-radius: var(--radius); }
    .icon:hover { opacity: 1; background: rgba(255,255,255,.12); }
    .body { flex: 1; overflow-y: auto; padding: 18px 16px; background: var(--bg); display: flex; flex-direction: column; gap: 10px; }
    .msg { max-width: 86%; padding: 11px 14px; border-radius: var(--radius); font-size: 14px; line-height: 1.5; color: var(--ink); word-wrap: break-word; }
    .bot { background: #fff; border: 1px solid var(--line); align-self: flex-start; border-top-left-radius: 2px; }
    .user { background: var(--primary); color: var(--primary-ink); align-self: flex-end; border-top-right-radius: 2px; }
    .msg ul { margin: 6px 0 2px; padding-left: 18px; }
    .msg b { font-weight: 700; }
    .chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .chip { border: 1.5px solid var(--primary); color: var(--primary); background: #fff; border-radius: var(--radius); padding: 7px 12px; font: 700 12.5px var(--font); cursor: pointer; transition: background .15s, color .15s; }
    .chip:hover { background: var(--primary); color: var(--primary-ink); }
    .typing { display: inline-flex; gap: 4px; padding: 3px 0; }
    .typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: b 1s infinite; }
    .typing span:nth-child(2) { animation-delay: .15s; } .typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes b { 0%,60%,100% { transform: none; opacity: .4; } 30% { transform: translateY(-4px); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .typing span, .panel.open { animation: none; } }
    .foot { border-top: 1px solid var(--line); padding: 12px; display: flex; gap: 8px; background: #fff; }
    .foot input { flex: 1; min-width: 0; border: 1.5px solid var(--line); border-radius: var(--radius); padding: 11px 14px; font: 500 14px var(--font); color: var(--ink); outline: none; background: #fff; }
    .foot input:focus { border-color: var(--primary); }
    .send { width: 44px; height: 44px; border-radius: var(--radius); border: none; background: var(--accent); color: var(--accent-ink); cursor: pointer; display: grid; place-items: center; flex: none; }
    .send:disabled { opacity: .5; cursor: default; }
    .note { font-size: 10.5px; color: #8a94a0; text-align: center; padding: 0 12px 10px; background: #fff; }
    @media (max-width: 480px) {
      .panel { right: 0; bottom: 0; width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; }
      .btn .label { display: none; } .btn { padding: 0; justify-content: center; }
    }
  </style>
  <button class="btn" aria-label="${t.open}"><span class="pulse"></span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    <span class="label">Ask us</span>
  </button>
  <div class="panel" role="dialog">
    <div class="head">
      <div class="avatar">AI</div>
      <div><div class="title">Assistant</div><div class="sub"><span class="dot"></span>Online</div></div>
      <button class="icon reset" title="${t.reset}">↺</button>
      <button class="icon close" title="${t.close}" style="margin-left:0">✕</button>
    </div>
    <div class="body"></div>
    <form class="foot">
      <input type="text" placeholder="${t.placeholder}" maxlength="1000" autocomplete="off">
      <button class="send" type="submit" aria-label="${t.send}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
      </button>
    </form>
    <div class="note">${t.powered}</div>
  </div>`;

  const $ = s => root.querySelector(s);
  const panel = $(".panel"), body = $(".body"), form = $(".foot"), input = $("input"), sendBtn = $(".send");

  fetch(API + "/api/info").then(r => r.json()).then(i => {
    $(".title").textContent = i.assistantName || i.name || "Assistant";
    const ui = i.ui || {};
    if (ui.placeholder) input.placeholder = ui.placeholder;
    if (ui.note) $(".note").textContent = ui.note;
    $(".sub").lastChild.textContent = ui.online || t.online;
    if (i.icon) $(".avatar").textContent = i.icon;
    if (i.buttonLabel) $(".btn .label").textContent = i.buttonLabel;
    const th = i.theme || {};
    const map = { primary: "--primary", primaryInk: "--primary-ink", accent: "--accent", accentInk: "--accent-ink",
                  highlight: "--highlight", radius: "--radius", bg: "--bg", ink: "--ink",
                  displayStyle: "--display-style", displayStretch: "--display-stretch" };
    if (!script.getAttribute("data-color")) for (const k in map) if (th[k]) host.style.setProperty(map[k], th[k]);
    if (th.font) host.style.setProperty("--font", `"${th.font}", -apple-system, "Segoe UI", Roboto, Arial, sans-serif`);
    if (th.displayFont) host.style.setProperty("--display", `"${th.displayFont}", var(--font)`);
    if (th.fontUrl && !document.querySelector(`link[href="${th.fontUrl}"]`)) {
      const l = document.createElement("link"); l.rel = "stylesheet"; l.href = th.fontUrl; document.head.appendChild(l);
    }
    if (i.welcome) t.hello = i.welcome;
    if (Array.isArray(i.chips)) t.chips = i.chips;
    render();
  }).catch(() => {});

  const escape = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function format(text) {
    // tiny, safe markdown: **bold**, bullet lists, line breaks
    const lines = escape(text).split("\n");
    let html = "", inList = false;
    for (const line of lines) {
      const li = line.match(/^\s*[-*•]\s+(.*)/);
      if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${li[1]}</li>`; continue; }
      if (inList) { html += "</ul>"; inList = false; }
      html += line + "<br>";
    }
    if (inList) html += "</ul>";
    return html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(<br>)+$/, "");
  }

  function bubble(role, text) {
    const d = document.createElement("div");
    d.className = "msg " + (role === "user" ? "user" : "bot");
    d.innerHTML = format(text);
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
    return d;
  }

  function render() {
    body.innerHTML = "";
    bubble("assistant", t.hello);
    if (!messages.length) {
      const chips = document.createElement("div");
      chips.className = "chips";
      t.chips.forEach(c => {
        const b = document.createElement("button");
        b.className = "chip"; b.type = "button"; b.textContent = c;
        b.onclick = () => send(c);
        chips.appendChild(b);
      });
      body.appendChild(chips);
    }
    messages.forEach(m => bubble(m.role, m.text));
  }

  let busy = false;
  async function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true; sendBtn.disabled = true;
    const chips = body.querySelector(".chips"); if (chips) chips.remove();
    messages.push({ role: "user", text }); save();
    bubble("user", text);
    const typing = document.createElement("div");
    typing.className = "msg bot";
    typing.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    body.appendChild(typing); body.scrollTop = body.scrollHeight;
    try {
      const r = await fetch(API + "/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const data = await r.json();
      typing.remove();
      if (!r.ok) throw new Error(data.error || t.err);
      messages.push({ role: "assistant", text: data.reply }); save();
      bubble("assistant", data.reply);
    } catch (e) {
      typing.remove();
      messages.pop(); save(); // let them retry the same message
      bubble("assistant", "⚠️ " + (e.message || t.err));
    } finally {
      busy = false; sendBtn.disabled = false; input.focus();
    }
  }

  form.addEventListener("submit", e => { e.preventDefault(); const v = input.value; input.value = ""; send(v); });
  const openPanel = () => { panel.classList.add("open"); $(".btn").classList.add("seen"); input.focus(); };
  $(".btn").onclick = () => { if (panel.classList.contains("open")) panel.classList.remove("open"); else openPanel(); };
  $(".close").onclick = () => panel.classList.remove("open");
  $(".reset").onclick = () => { messages = []; save(); render(); };

  render();
  if (AUTO_OPEN) openPanel();

  // Small public API so the host page can open the chat or ask a question:
  //   window.bizAssistant.open()   window.bizAssistant.ask("Which membership is cheapest?")
  window.bizAssistant = { open: openPanel, ask: q => { openPanel(); send(q); } };
})();
