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

function Part({ part }: { part: any }) {
  if (part?.type === 'text') return <>{part.text}</>;
  if (typeof part?.type === 'string' && part.type.startsWith('tool-')) {
    const name = part.type.slice(5);
    const done = part.state === 'output-available';
    const err = part.state === 'output-error';
    return (
      <div className="opal-tool">
        <span className="opal-tool-name">⚙ {name}{done ? '' : err ? ' · error' : ' · running…'}</span>
        {done && part.output != null && (
          <pre className="opal-tool-out">{JSON.stringify(part.output, null, 2)}</pre>
        )}
      </div>
    );
  }
  return null;
}

const SUGGESTIONS = [
  "High-intent Tabby browsers who haven't added to cart — how many, and their average order value?",
  'Which persona has the highest predicted lifetime value?',
  'How much 90-day revenue came from BNPL orders (Tabby, Affirm, Afterpay)?',
  'Top 5 best-selling products by units sold, with revenue.',
];

function OpalChat() {
  const agent = useAgent({ agent: 'opal-agent' });
  const { messages, sendMessage, status, isStreaming, clearHistory } = useAgentChat({ agent }) as any;
  const [input, setInput] = useState('');
  const endRef = useRef<any>(null);
  const dispatched = useRef<Set<string>>(new Set());
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isStreaming]);
  // Restarting the demo clears the merchandiser's chat (fresh conversation per run).
  useEffect(() => {
    const reset = () => { try { clearHistory(); } catch (e) {} };
    window.addEventListener('opal:reset', reset);
    return () => window.removeEventListener('opal:reset', reset);
  }, [clearHistory]);
  // When Opal creates a banner rule, tell the storefront to preview it as that audience.
  useEffect(() => {
    for (const m of (messages as any[])) {
      for (const p of (m.parts || [])) {
        if (p?.type === 'tool-targetMessageToAudience' && p.state === 'output-available' && p.output && p.toolCallId && !dispatched.current.has(p.toolCallId)) {
          dispatched.current.add(p.toolCallId);
          const o = p.output;
          if (o && o.status === 'live') {
            window.dispatchEvent(new CustomEvent('opal:experience', { detail: { message: o.message, previewAttributes: o.previewAttributes, audienceName: o.audienceName } }));
          }
        }
      }
    }
  }, [messages]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || isStreaming) return;
    sendMessage({ text: t });
    setInput('');
  };

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
            <div>Ask anything about your customers — I'll query the live data — or create a real audience. Try:</div>
            {SUGGESTIONS.map((s, i) => (
              <button key={i} className="opal-suggest" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        {messages.map((m: any) => (
          <div key={m.id} className={`opal-msg ${m.role}`}>
            {(m.parts || []).map((p: any, i: number) => <Part key={i} part={p} />)}
          </div>
        ))}
        {status === 'submitted' && <div className="opal-msg assistant opal-dots">Opal is thinking…</div>}
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
