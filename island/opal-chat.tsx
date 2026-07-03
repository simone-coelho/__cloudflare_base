/**
 * Opal chat island — a small React app bundled by esbuild (scripts/build-island.mjs)
 * into public/opal-chat.js and mounted into #opal-chat-root in the storefront's Opal
 * tab. It talks to the OpalAgent (AIChatAgent DO) via the Cloudflare Agents SDK, so
 * it's a real type-anything chat: Gemini streams, tools query D1 + (gated) create FX.
 */
import { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';

// Pertinent fields to surface as a tidy card (in this order); everything else lives behind "Show JSON".
const PRETTY: [string, string][] = [
  ['audienceName', 'Audience'], ['message', 'Message'], ['flagKey', 'Flag'], ['ruleKey', 'Rule'],
  ['variationKey', 'Variation'], ['audienceId', 'Audience id'], ['flagId', 'Flag id'],
  ['audience_size', 'Audience size'], ['avg_order_value_usd', 'Avg order value'],
  ['environment', 'Environment'], ['revision', 'Revision'],
];

function ToolCard({ name, output, state }: { name: string; output: any; state: string }) {
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);
  const done = state === 'output-available';
  const err = state === 'output-error';
  const o = output && typeof output === 'object' && !Array.isArray(output) ? output : null;
  const copy = () => { try { navigator.clipboard.writeText(JSON.stringify(output, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {} };
  const rows = o ? PRETTY.filter(([k]) => o[k] != null && o[k] !== '').map(([k, label]) => [label, String(o[k]), k]) as [string, string, string][] : [];
  const status = o ? (o.status || (o.live ? 'live' : null)) : null;
  return (
    <div className="opal-card2">
      <div className="oc2-head">
        <span className="oc2-name">⚙ {name}</span>
        {!done && !err && <span className="oc2-run">running…</span>}
        {err && <span className="oc2-run">error</span>}
        {done && status && <span className="oc2-badge">{String(status)}</span>}
      </div>
      {done && (
        (showJson || rows.length === 0)
          ? <pre className="opal-tool-out">{JSON.stringify(output, null, 2)}</pre>
          : <div className="oc2-rows">{rows.map(([label, val, key], i) => (
              <div className="oc2-row" key={i}><span className="oc2-k">{label}</span><span className={'oc2-v' + (key === 'message' ? ' msg' : '')}>{val}</span></div>
            ))}</div>
      )}
      {done && (
        <div className="oc2-actions">
          {rows.length > 0 && <button className="oc2-btn" onClick={() => setShowJson((s) => !s)}>{showJson ? 'Hide JSON' : 'Show JSON'}</button>}
          <button className="oc2-btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy JSON'}</button>
        </div>
      )}
    </div>
  );
}

function Part({ part }: { part: any }) {
  if (part?.type === 'text') return <>{part.text}</>;
  if (typeof part?.type === 'string' && part.type.startsWith('tool-')) {
    return <ToolCard name={part.type.slice(5)} output={part.output} state={part.state} />;
  }
  return null;
}

// An assistant bubble is "visible" once it carries renderable content (streamed text or a tool card).
// Until then we render an animated typing indicator instead of leaving an empty bubble (no blank "ghost").
function hasVisibleContent(m: any): boolean {
  return (m?.parts || []).some((p: any) =>
    (p?.type === 'text' && typeof p.text === 'string' && p.text.trim() !== '') ||
    (typeof p?.type === 'string' && p.type.startsWith('tool-'))
  );
}

const SUGGESTIONS = [
  "High-intent Tabby browsers who haven't added to cart — how many, and their average order value?",
  'Which persona has the highest predicted lifetime value?',
  'How much 90-day revenue came from BNPL orders (Tabby, Affirm, Afterpay)?',
  'Top 5 best-selling products by units sold, with revenue.',
];

// Each browser/presenter gets its OWN OpalAgent DO instance via a stable per-browser id, so concurrent
// presenters never share or cross-contaminate Opal chat. Without a `name`, the Agents SDK routes EVERY
// client to the single "default" DO — fine for one user, but a crossover risk when the team demos at once.
function opalSessionName(): string {
  try {
    let n = localStorage.getItem('opal-session-id');
    if (!n) { n = 'opal-' + Math.random().toString(36).slice(2, 11) + '-' + Date.now().toString(36); localStorage.setItem('opal-session-id', n); }
    return n;
  } catch (e) { return 'opal-' + Math.random().toString(36).slice(2, 11); }
}

function OpalChat() {
  const [sessionName] = useState(opalSessionName);
  const agent = useAgent({ agent: 'opal-agent', name: sessionName });
  const { messages, sendMessage, status, isStreaming, clearHistory } = useAgentChat({ agent }) as any;
  const [input, setInput] = useState('');
  const endRef = useRef<any>(null);
  const dispatched = useRef<Set<string>>(new Set());
  const liveSince = useRef(false);   // true only after a message is sent THIS session; gates tool-call side-effects so REPLAYED persisted history (on every load) never re-fires/flashes
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isStreaming]);
  // Restarting the demo clears the merchandiser's chat (fresh conversation per run).
  useEffect(() => {
    const reset = () => { try { clearHistory(); } catch (e) {} };
    window.addEventListener('opal:reset', reset);
    return () => window.removeEventListener('opal:reset', reset);
  }, [clearHistory]);
  // The guided demo (beat 10) drives THIS real chat from outside via an event — no separate scripted UI.
  useEffect(() => {
    // fresh:true (the Signal-Led Moment) wipes the persisted thread FIRST, so the moment is generated +
    // launched LIVE each run — no stale "already live" replay from a prior run.
    const onAsk = async (e: any) => {
      const t = (e?.detail?.text || '').trim(); if (!t) return;
      liveSince.current = true;
      if (e?.detail?.fresh) { try { await clearHistory(); } catch (_e) {} }
      sendMessage({ text: t });
    };
    window.addEventListener('opal:ask', onAsk);
    return () => window.removeEventListener('opal:ask', onAsk);
  }, [sendMessage, clearHistory]);
  // When Opal creates a banner rule, tell the storefront to preview it as that audience.
  useEffect(() => {
    const msgs = messages as any[];
    // On a page (re)load, useAgentChat hydrates the persisted thread from the Durable Object — and it can
    // arrive over SEVERAL updates. Those tool outputs are HISTORY, not live actions; replaying their
    // side-effects (re-rendering the Signal-Led Moment takeover, re-applying a banner) would hijack /
    // FLASH the storefront on every load. Gate strictly: until a message is actually sent THIS session
    // (liveSince), record every tool call as already-handled WITHOUT dispatching. Only tool calls that
    // arrive AFTER a live send fire — robust even when history streams in over multiple updates.
    const replaying = !liveSince.current;
    for (const m of msgs) {
      for (const p of (m.parts || [])) {
        if (p?.type === 'tool-targetMessageToAudience' && p.state === 'output-available' && p.output && p.toolCallId && !dispatched.current.has(p.toolCallId)) {
          dispatched.current.add(p.toolCallId);
          const o = p.output;
          if (!replaying && o && o.status === 'live') {
            window.dispatchEvent(new CustomEvent('opal:experience', { detail: { message: o.message, previewAttributes: o.previewAttributes, audienceName: o.audienceName } }));
          }
        }
        // When Opal launches an experiment, render its first variation live on the storefront banner.
        if (p?.type === 'tool-launchExperiment' && p.state === 'output-available' && p.output && p.toolCallId && !dispatched.current.has(p.toolCallId)) {
          dispatched.current.add(p.toolCallId);
          const o = p.output;
          if (!replaying && o && o.experimentKey) {
            window.dispatchEvent(new CustomEvent('opal:experiment', { detail: { experimentKey: o.experimentKey, variationKey: o.firstVariationKey, variations: o.variations, metricEventKey: o.metricEventKey } }));
          }
        }
      }
    }
  }, [messages]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || isStreaming) return;
    liveSince.current = true;
    sendMessage({ text: t });
    setInput('');
  };

  // Always show a typing indicator while a reply is pending — covers the gap BEFORE the assistant
  // bubble exists (last message is still the user's), so the user never stares at a blank/empty bubble.
  const last = messages[messages.length - 1];
  const awaitingReply = (status === 'submitted' || status === 'streaming' || isStreaming) && (!last || last.role === 'user');

  return (
    <div className="opal-chat">
      <div className="opal-chat-head">
        <span className="opal-chat-title">Opal · ask anything</span>
        {messages.length > 0 && (
          <button className="opal-chat-clear" onClick={() => clearHistory()}>clear</button>
        )}
      </div>

      <div className="opal-chat-thread">
        {messages.length === 0 && (
          <div className="opal-chat-empty">
            <div>I'm <b>Opal</b>, your Optimizely AI. Ask anything about your customers (I query the live data), or tell me to build a real <b>audience</b>, <b>banner message</b>, or <b>flag</b>. Try:</div>
            {SUGGESTIONS.map((s, i) => (
              <button key={i} className="opal-suggest" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        {messages.map((m: any) => (
          <div key={m.id} className={`opal-msg ${m.role}`}>
            {(m.parts || []).map((p: any, i: number) => <Part key={i} part={p} />)}
            {m.role === 'assistant' && !hasVisibleContent(m) && (
              <span className="opal-dots"><span></span><span></span><span></span></span>
            )}
          </div>
        ))}
        {awaitingReply && <div className="opal-msg assistant opal-dots"><span></span><span></span><span></span></div>}
        <div ref={endRef} />
      </div>

      <form className="opal-chat-form" onSubmit={(e: any) => { e.preventDefault(); send(input); }}>
        <input
          className="opal-chat-input"
          value={input}
          onChange={(e: any) => setInput(e.target.value)}
          placeholder="Ask Opal about your customers…"
        />
        <button className="opal-chat-send" type="submit" disabled={isStreaming || !input.trim()}>Send</button>
      </form>
    </div>
  );
}

const el = document.getElementById('opal-chat-root');
if (el) createRoot(el).render(<OpalChat />);
