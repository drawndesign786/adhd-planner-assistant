import { useState, useRef, useEffect } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an ADHD daily planning assistant built into a digital planner. Help users with ADHD plan their day in a calm, structured, non-judgmental way.

Personality:
- Warm, encouraging, patient. Never rushed or overwhelming.
- Never judge. Meet the user where they are.
- Short sentences only. No walls of text.
- Celebrate small wins enthusiastically.
- Never give more than 3 things to focus on at once.
- Use "we" often — you are a partner, not a taskmaster.

What you help with:
1. Identify TOP 3 tasks for today.
2. Break down scary tasks into 5-minute chunks.
3. Hour-by-hour day planning.
4. Brain dumps — listen and organise.
5. Procrastination — ask what makes it hard, work through it.
6. Quick daily check-in — mood, energy, one priority.
7. End-of-day shutdown routine.
8. Reference past sessions naturally when relevant.

Rules:
- Never list more than 3 items unless asked.
- End every response with ONE question OR ONE clear next action — never both.
- Under 100 words unless user asks for detail.
- Never say "just" or "simply".
- If user hasn't started — that's fine. Start fresh from now.`;

const QUICK_PROMPTS = [
  { label: "Plan my day",       icon: "ti-calendar",   text: "Help me plan my day. I don't know where to start." },
  { label: "Brain dump",        icon: "ti-brain",      text: "I need to do a brain dump. My head is full." },
  { label: "Break task down",   icon: "ti-list-check", text: "I have a task I keep avoiding. Help me break it down." },
  { label: "I'm overwhelmed",   icon: "ti-mood-sad",   text: "I'm overwhelmed and can't figure out where to start." },
  { label: "Quick check-in",    icon: "ti-heart",      text: "Let's do a quick daily check-in." },
  { label: "End of day",        icon: "ti-moon",       text: "Help me with my end-of-day shutdown routine." },
];

const STORAGE_KEY = "adhd_chat_v1";
const MAX_MESSAGES = 120;

// ─── Storage helpers ──────────────────────────────────────────────────────────

function loadMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-MAX_MESSAGES)));
  } catch { /* storage full */ }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dayLabel(ts) {
  if (!ts) return "";
  const d   = new Date(ts);
  const now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString())  return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeStr(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [messages,        setMessages]        = useState(loadMessages);
  const [input,           setInput]           = useState("");
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState("");
  const [sidebarOpen,     setSidebarOpen]     = useState(false);
  const [confirmClear,    setConfirmClear]    = useState(false);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // persist to localStorage
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  // ── send ──────────────────────────────────────────────────────────────────

  async function send(text) {
    text = text.trim();
    if (!text || loading) return;
    setError("");
    setSidebarOpen(false);

    const userMsg = { role: "user", content: text, ts: Date.now() };
    const next    = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    // Build API payload — trim old context if conversation is long
    let apiMsgs = next.map(m => ({ role: m.role, content: m.content }));
    if (apiMsgs.length > 40) {
      const summary = apiMsgs
        .slice(0, apiMsgs.length - 30)
        .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n")
        .slice(0, 1000);
      apiMsgs = [
        { role: "user",      content: `[Earlier conversation summary]\n${summary}` },
        { role: "assistant", content: "Understood, I have context from earlier." },
        ...apiMsgs.slice(-30),
      ];
    }

    try {
      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model:      "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system:     SYSTEM_PROMPT,
          messages:   apiMsgs,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Show a helpful error based on status
        const msg =
          res.status === 401 ? "API key is invalid or missing. Check your Vercel environment variable." :
          res.status === 404 ? "API route not found. Make sure api/chat.js is in your GitHub repo." :
          res.status === 429 ? "Rate limit hit. Wait a moment and try again." :
          data?.error?.message || `Server error ${res.status}`;
        setError(msg);
        setLoading(false);
        return;
      }

      const reply = data?.content?.[0]?.text ?? "I'm here — what's on your mind?";
      setMessages(prev => [...prev, { role: "assistant", content: reply, ts: Date.now() }]);

    } catch (err) {
      setError(`Network error: ${err.message}`);
    }

    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  function clearHistory() {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    setConfirmClear(false);
    setSidebarOpen(false);
  }

  // ── derived ───────────────────────────────────────────────────────────────

  const hasMessages = messages.length > 0;

  // group messages by day for rendering
  const rendered = [];
  let lastDay = null;
  messages.forEach((m, i) => {
    const dl = dayLabel(m.ts);
    if (dl && dl !== lastDay) {
      rendered.push({ type: "divider", label: dl, key: `d-${i}` });
      lastDay = dl;
    }
    rendered.push({ type: "msg", ...m, key: `m-${i}` });
  });

  // sidebar: unique days with first user message preview
  const sidebarDays = (() => {
    const map = {};
    messages.forEach(m => {
      const dl = dayLabel(m.ts);
      if (!dl) return;
      if (!map[dl]) map[dl] = { label: dl, count: 0, preview: "" };
      map[dl].count++;
      if (!map[dl].preview && m.role === "user") map[dl].preview = m.content;
    });
    return Object.values(map).reverse();
  })();

  // ── styles (inline, no extra deps) ────────────────────────────────────────

  const s = {
    wrap:    { maxWidth: 700, margin: "0 auto", height: "100vh", display: "flex", flexDirection: "column", padding: "0 16px" },
    header:  { display: "flex", alignItems: "center", gap: 12, padding: "16px 0 12px", borderBottom: "1px solid #e5e2f0", flexShrink: 0 },
    avatar:  { width: 42, height: 42, borderRadius: "50%", background: "#E8E4F5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
    hTitle:  { margin: 0, fontSize: 15, fontWeight: 600 },
    hSub:    { margin: 0, fontSize: 12, color: "#888" },
    histBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", border: "1px solid #ddd", borderRadius: 20, background: hasMessages ? "#E8E4F5" : "transparent", color: hasMessages ? "#4A3F8F" : "#888", cursor: "pointer", fontSize: 12, fontWeight: 500 },
    dot:     { width: 8, height: 8, borderRadius: "50%", background: "#97C459" },

    // quick prompts
    grid:    { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, padding: "20px 0 0" },
    qBtn:    { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "1px solid #e0ddf0", borderRadius: 10, background: "#fff", cursor: "pointer", fontSize: 14, textAlign: "left", transition: "background .15s" },

    // messages
    msgArea: { flex: 1, overflowY: "auto", padding: "12px 0", display: "flex", flexDirection: "column", gap: 2 },
    divider: { display: "flex", alignItems: "center", gap: 8, margin: "10px 0 6px" },
    divLine: { flex: 1, height: 1, background: "#eee" },
    divTag:  { fontSize: 11, color: "#aaa", padding: "2px 10px", background: "#f5f3ff", borderRadius: 10 },

    // chips
    chips:   { display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 0 4px", borderTop: "1px solid #f0eef8", flexShrink: 0 },
    chip:    { display: "flex", alignItems: "center", gap: 4, padding: "4px 11px", border: "1px solid #e0ddf0", borderRadius: 20, background: "transparent", cursor: "pointer", fontSize: 12, color: "#666" },

    // input row
    inputRow:  { display: "flex", gap: 8, padding: "8px 0 12px", alignItems: "flex-end", flexShrink: 0 },
    textarea:  { flex: 1, padding: "11px 14px", border: "1px solid #ddd", borderRadius: 12, background: "#fff", fontSize: 14, lineHeight: 1.5, resize: "none", fontFamily: "inherit", outline: "none" },
    sendBtn: (active) => ({ padding: "11px 18px", border: "none", borderRadius: 12, background: active ? "#4A3F8F" : "#E8E4F5", color: active ? "#fff" : "#aaa", cursor: active ? "pointer" : "default", height: 46, flexShrink: 0, fontSize: 15, transition: "all .15s" }),

    hint: { fontSize: 11, color: "#bbb", textAlign: "center", padding: "0 0 8px", flexShrink: 0 },
    errBox: { background: "#fff0f0", border: "1px solid #f5c6c6", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#c0392b", margin: "6px 0", flexShrink: 0 },

    // sidebar overlay
    overlay: { position: "fixed", inset: 0, zIndex: 100, display: "flex" },
    scrim:   { position: "absolute", inset: 0, background: "rgba(0,0,0,.35)" },
    drawer:  { position: "relative", width: 290, background: "#fff", height: "100%", display: "flex", flexDirection: "column", boxShadow: "4px 0 24px rgba(0,0,0,.12)", zIndex: 1 },
    dHead:   { padding: "18px 16px 14px", borderBottom: "1px solid #eee" },
    dTitle:  { margin: "0 0 12px", fontWeight: 600, fontSize: 15, display: "flex", justifyContent: "space-between", alignItems: "center" },
    stats:   { display: "flex", gap: 8 },
    statBox: { flex: 1, background: "#E8E4F5", borderRadius: 8, padding: "8px 10px", textAlign: "center" },
    sVal:    { margin: 0, fontSize: 20, fontWeight: 600, color: "#4A3F8F" },
    sLbl:    { margin: 0, fontSize: 11, color: "#7066B0" },
    dList:   { flex: 1, overflowY: "auto", padding: "8px 0" },
    dItem:   { padding: "10px 16px", borderBottom: "1px solid #f5f5f5", cursor: "default" },
    dDay:    { margin: "0 0 2px", fontSize: 12, fontWeight: 600, color: "#4A3F8F" },
    dPrev:   { margin: 0, fontSize: 12, color: "#666", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
    dCount:  { margin: "2px 0 0", fontSize: 11, color: "#aaa" },
    dFoot:   { padding: "12px 16px", borderTop: "1px solid #eee" },
    clearBtn:{ width: "100%", padding: 10, border: "1px solid #f5c6c6", borderRadius: 8, background: "transparent", color: "#c0392b", cursor: "pointer", fontSize: 13, fontWeight: 500 },
    confRow: { display: "flex", gap: 8, marginTop: 8 },
    confCancel:{ flex: 1, padding: 8, border: "1px solid #ddd", borderRadius: 8, background: "transparent", color: "#666", cursor: "pointer", fontSize: 13 },
    confOk:  { flex: 1, padding: 8, border: "none", borderRadius: 8, background: "#E8A5A5", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500 },
  };

  function bubble(m) {
    const isUser = m.role === "user";
    return (
      <div key={m.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", flexDirection: isUser ? "row-reverse" : "row", marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: isUser ? "#f0eef8" : "#E8E4F5", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e8e4f5" }}>
          <i className={isUser ? "ti ti-user" : "ti ti-brain"} style={{ fontSize: 15, color: isUser ? "#888" : "#4A3F8F" }} />
        </div>
        <div style={{ maxWidth: "80%", padding: "11px 15px", borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: isUser ? "#E8E4F5" : "#fff", border: "1px solid #e8e4f5", fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
          {m.content}
          {m.ts && <p style={{ margin: "5px 0 0", fontSize: 10, color: "#bbb", textAlign: isUser ? "right" : "left" }}>{timeStr(m.ts)}</p>}
        </div>
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Sidebar ── */}
      {sidebarOpen && (
        <div style={s.overlay}>
          <div style={s.scrim} onClick={() => setSidebarOpen(false)} />
          <div style={s.drawer}>
            <div style={s.dHead}>
              <p style={s.dTitle}>
                Chat history
                <button onClick={() => setSidebarOpen(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#888", lineHeight: 1 }}>×</button>
              </p>
              <div style={s.stats}>
                <div style={s.statBox}><p style={s.sVal}>{messages.length}</p><p style={s.sLbl}>messages</p></div>
                <div style={s.statBox}><p style={s.sVal}>{sidebarDays.length}</p><p style={s.sLbl}>days active</p></div>
              </div>
            </div>

            <div style={s.dList}>
              {sidebarDays.length === 0
                ? <p style={{ padding: "20px 16px", fontSize: 13, color: "#aaa", textAlign: "center" }}>No history yet</p>
                : sidebarDays.map(d => (
                  <div key={d.label} style={s.dItem}>
                    <p style={s.dDay}>{d.label}</p>
                    <p style={s.dPrev}>{d.preview || "Session started"}</p>
                    <p style={s.dCount}>{d.count} messages</p>
                  </div>
                ))
              }
            </div>

            <div style={s.dFoot}>
              {!confirmClear
                ? <button style={s.clearBtn} onClick={() => setConfirmClear(true)}>Clear all history</button>
                : <>
                    <p style={{ fontSize: 12, color: "#666", textAlign: "center", marginBottom: 8 }}>Are you sure? This cannot be undone.</p>
                    <div style={s.confRow}>
                      <button style={s.confCancel} onClick={() => setConfirmClear(false)}>Cancel</button>
                      <button style={s.confOk}    onClick={clearHistory}>Yes, clear</button>
                    </div>
                  </>
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Main layout ── */}
      <div style={s.wrap}>

        {/* Header */}
        <div style={s.header}>
          <div style={s.avatar}><i className="ti ti-brain" style={{ fontSize: 22, color: "#4A3F8F" }} /></div>
          <div style={{ flex: 1 }}>
            <p style={s.hTitle}>ADHD daily assistant</p>
            <p style={s.hSub}>{hasMessages ? `${messages.length} messages · ${sidebarDays.length} day${sidebarDays.length !== 1 ? "s" : ""}` : "Your calm planning partner"}</p>
          </div>
          <button style={s.histBtn} onClick={() => setSidebarOpen(true)}>
            <i className="ti ti-history" style={{ fontSize: 14 }} /> History
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 6 }}>
            <div style={s.dot} /><span style={{ fontSize: 12, color: "#888" }}>Ready</span>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div style={s.errBox}>
            <strong>Error:</strong> {error}
            <button onClick={() => setError("")} style={{ marginLeft: 10, border: "none", background: "none", cursor: "pointer", color: "#c0392b", fontWeight: 700 }}>×</button>
          </div>
        )}

        {/* Landing quick prompts */}
        {!hasMessages && (
          <>
            <p style={{ fontSize: 14, color: "#555", marginTop: 20 }}>What do you need help with today?</p>
            <div style={s.grid}>
              {QUICK_PROMPTS.map(p => (
                <button key={p.label} style={s.qBtn} onClick={() => send(p.text)}
                  onMouseEnter={e => e.currentTarget.style.background = "#F3F0FC"}
                  onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                  <i className={`ti ${p.icon}`} style={{ fontSize: 18, color: "#4A3F8F", flexShrink: 0 }} />
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 6px" }}>
              <div style={{ flex: 1, height: 1, background: "#eee" }} />
              <span style={{ fontSize: 12, color: "#aaa" }}>or type anything below</span>
              <div style={{ flex: 1, height: 1, background: "#eee" }} />
            </div>
          </>
        )}

        {/* Messages */}
        {hasMessages && (
          <div style={s.msgArea}>
            {rendered.map(item =>
              item.type === "divider"
                ? <div key={item.key} style={s.divider}><div style={s.divLine} /><span style={s.divTag}>{item.label}</span><div style={s.divLine} /></div>
                : bubble(item)
            )}

            {/* Loading dots */}
            {loading && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ ...s.avatar, width: 32, height: 32 }}><i className="ti ti-brain" style={{ fontSize: 15, color: "#4A3F8F" }} /></div>
                <div style={{ padding: "14px 18px", borderRadius: "14px 14px 14px 4px", background: "#fff", border: "1px solid #e8e4f5", display: "flex", gap: 5, alignItems: "center" }}>
                  {[0, 1, 2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#4A3F8F", display: "inline-block", animation: `dot 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Compact chips during chat */}
        {hasMessages && !loading && (
          <div style={s.chips}>
            {QUICK_PROMPTS.slice(0, 4).map(p => (
              <button key={p.label} style={s.chip} onClick={() => send(p.text)}
                onMouseEnter={e => { e.currentTarget.style.background = "#E8E4F5"; e.currentTarget.style.color = "#4A3F8F"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#666"; }}>
                <i className={`ti ${p.icon}`} style={{ fontSize: 13 }} />{p.label}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={s.inputRow}>
          <textarea
            ref={inputRef}
            value={input}
            rows={2}
            placeholder="Tell me what's on your mind..."
            disabled={loading}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            style={s.textarea}
          />
          <button style={s.sendBtn(!!input.trim() && !loading)} onClick={() => send(input)} disabled={!input.trim() || loading}>
            <i className="ti ti-send" />
          </button>
        </div>

        <p style={s.hint}>Enter to send · Shift+Enter for new line · History saves automatically</p>
      </div>

      <style>{`
        @keyframes dot { 0%,100%{opacity:.2;transform:scale(.8)} 50%{opacity:1;transform:scale(1.15)} }
        textarea:focus { border-color: #4A3F8F !important; box-shadow: 0 0 0 3px rgba(74,63,143,.12); }
        textarea::placeholder { color: #bbb; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }
      `}</style>
    </>
  );
}
