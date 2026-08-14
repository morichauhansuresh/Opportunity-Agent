"use client";

import { useMemo, useState } from "react";

const examples = [
  "Create an opportunity for Contoso worth 75K closing in October for CRM implementation.",
  "Show me open opportunities for Contoso.",
  "Increase the Contoso CRM opportunity to 125K.",
  "Get the latest opportunity for ABC Ltd.",
];

export default function Home() {
  const [prompt, setPrompt] = useState(examples[0]);
  const [result, setResult] = useState<unknown>(null);
  const [meta, setMeta] = useState<{ model?: string; currentDate?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const prettyResult = useMemo(
    () => (result ? JSON.stringify(result, null, 2) : ""),
    [result],
  );

  async function runPrompt() {
    setLoading(true);
    setError(null);
    setResult(null);
    setMeta(null);

    try {
      const response = await fetch("/api/opportunity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Request failed.");

      setResult(payload.command);
      setMeta(payload.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <div className="glow glow-one" />
      <div className="glow glow-two" />

      <section className="container">
        <header className="hero">
          <div className="eyebrow">Dynamics CRM • AI Opportunity Agent</div>
          <h1>Turn a simple prompt into a CRM-ready command.</h1>
          <p>
            A client-demo version of the Opportunity Agent. Enter a natural-language request and the
            server-side LLM converts it into a validated JSON structure that can later drive your
            Playwright automation.
          </p>
        </header>

        <section className="workspace">
          <div className="panel prompt-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">1. USER PROMPT</span>
                <h2>What do you want to do?</h2>
              </div>
              <span className="status-pill neutral">Demo only</span>
            </div>

            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Example: Create an opportunity for Contoso worth 75K closing in October..."
              rows={8}
            />

            <div className="examples">
              {examples.map((example) => (
                <button key={example} className="example-chip" onClick={() => setPrompt(example)}>
                  {example}
                </button>
              ))}
            </div>

            <button className="run-button" onClick={runPrompt} disabled={loading || !prompt.trim()}>
              {loading ? "Understanding…" : "Understand Prompt"}
              <span aria-hidden="true">→</span>
            </button>

            <p className="helper">
              Your OpenAI key stays on the server. The browser only sends the user prompt to this app.
            </p>
          </div>

          <div className="panel result-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">2. AGENT OUTPUT</span>
                <h2>Structured opportunity JSON</h2>
              </div>
              <span className={`status-pill ${loading ? "working" : result ? "success" : "neutral"}`}>
                {loading ? "Processing" : result ? "Validated" : "Waiting"}
              </span>
            </div>

            <div className="code-card">
              {error ? (
                <div className="error-state">
                  <strong>Couldn’t process the prompt.</strong>
                  <span>{error}</span>
                </div>
              ) : result ? (
                <pre>{prettyResult}</pre>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">{`{ }`}</div>
                  <strong>Your JSON will appear here.</strong>
                  <span>Run a prompt to see the exact command your future CRM tool layer can consume.</span>
                </div>
              )}
            </div>

            {meta && (
              <div className="meta-row">
                <span>Model: {meta.model}</span>
                <span>Reference date: {meta.currentDate}</span>
              </div>
            )}
          </div>
        </section>

        <section className="architecture">
          <div className="architecture-copy">
            <span className="panel-kicker">WHAT COMES NEXT</span>
            <h2>Prompt → Agent → JSON → Playwright</h2>
            <p>
              This demo stops immediately after validation. In the next stage, we can connect the
              command to your existing TypeScript Playwright automation and turn
              <code>CREATE_OPPORTUNITY</code> into a real Dynamics CRM operation.
            </p>
          </div>

          <div className="flow">
            {[
              ["01", "User", "Natural language"],
              ["02", "LLM", "Intent + fields"],
              ["03", "Zod", "Validate command"],
              ["04", "Tool", "Playwright / API"],
            ].map(([number, title, subtitle], index) => (
              <div className="flow-step" key={number}>
                <span className="flow-number">{number}</span>
                <div>
                  <strong>{title}</strong>
                  <span>{subtitle}</span>
                </div>
                {index < 3 && <span className="flow-arrow">→</span>}
              </div>
            ))}
          </div>
        </section>

        <footer>Opportunity AI Agent Demo • Ready for Vercel</footer>
      </section>
    </main>
  );
}
