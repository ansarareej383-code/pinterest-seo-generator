"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "pseo-history-v1";

async function copyText(text, setState) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  setState(true);
  setTimeout(() => setState(false), 1600);
}

function ResultCard({ title, text, showCount }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="body">{text}</div>
      <div className="foot">
        {showCount ? (
          <span className="charcount">{text.length} / 500 characters</span>
        ) : (
          <span />
        )}
        <button className="small" onClick={() => copyText(text, setCopied)}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [pkg, setPkg] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
  }, []);

  function saveToHistory(next) {
    setHistory((prev) => {
      const deduped = prev.filter((h) => !(h.url === next.url && h.variation === next.variation));
      const updated = [next, ...deduped].slice(0, 30);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }

  async function generate(targetUrl, variation) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: targetUrl, variation }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed.");
      setPkg(data);
      saveToHistory(data);
    } catch (e) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (url.trim()) generate(url.trim(), 0);
  }

  function onVariation() {
    if (pkg) generate(pkg.url, (pkg.variation || 0) + 1);
  }

  function onCopyAll() {
    if (!pkg) return;
    const r = pkg.results;
    const all = [
      `Board Name:\n${r.boardName}`,
      `Board Description:\n${r.boardDescription}`,
      `Pin Title:\n${r.pinTitle}`,
      `Pin Description:\n${r.pinDescription}`,
      `Primary Keywords: ${pkg.keywords.primary.join(", ")}`,
      `Secondary Keywords: ${pkg.keywords.secondary.join(", ")}`,
      `Long-Tail Keywords: ${pkg.keywords.longTail.join(", ")}`,
      `Trending Keywords: ${pkg.keywords.trending.join(", ")}`,
    ].join("\n\n");
    copyText(all, setCopiedAll);
  }

  function removeHistory(item) {
    setHistory((prev) => {
      const updated = prev.filter((h) => h !== item);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }

  return (
    <div className="wrap">
      <header className="hero">
        <span className="badge">📌 Pinterest SEO</span>
        <h1>Pinterest SEO Content Generator</h1>
        <p>
          Paste any blog article URL and get a complete Pinterest SEO package — board name,
          board description, pin title, pin description and researched keywords — ready to copy.
        </p>
      </header>

      <section className="generator">
        <form onSubmit={onSubmit}>
          <input
            type="url"
            inputMode="url"
            placeholder="Paste a blog article URL… e.g. https://example.com/blog/post"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "Generating…" : "Generate"}
          </button>
        </form>
        {loading && <div className="spinner">Reading the article and researching Pinterest keywords…</div>}
        {error && <div className="error">{error}</div>}
        <p className="note">
          Keywords are <strong>AI-generated estimates</strong> based on the article and
          Pinterest-style search patterns — not verified Pinterest search-volume data.
        </p>
      </section>

      {pkg && (
        <main>
          <div className="meta">
            <div>
              <strong>Article:</strong> {pkg.originalTitle}
            </div>
            <div>
              <strong>Main topic:</strong> {pkg.topic} &nbsp;·&nbsp; <strong>Search intent:</strong>{" "}
              {pkg.searchIntent}
              {pkg.variation > 0 ? (
                <>
                  {" "}
                  &nbsp;·&nbsp; <strong>Variation:</strong> {pkg.variation}
                </>
              ) : null}
            </div>
            {pkg.subtopics?.length > 0 && (
              <div>
                <strong>Subtopics:</strong> {pkg.subtopics.join(" · ")}
              </div>
            )}
          </div>

          <div className="grid">
            <ResultCard title="1 · Board Name" text={pkg.results.boardName} />
            <ResultCard title="2 · Board Description" text={pkg.results.boardDescription} />
            <ResultCard title="3 · Pin Title" text={pkg.results.pinTitle} />
            <ResultCard title="4 · Pin Description" text={pkg.results.pinDescription} showCount />
          </div>

          <div className="actions">
            <button onClick={onCopyAll}>{copiedAll ? "Copied ✓" : "Copy All"}</button>
            <button className="ghost" onClick={onVariation} disabled={loading}>
              {loading ? "Working…" : "↻ New Variation"}
            </button>
          </div>

          <h2 style={{ marginTop: 34 }}>Researched Keywords</h2>
          <p className="note">{pkg.keywordNote}</p>
          <div className="kwgrid">
            {[
              ["Primary Keywords", pkg.keywords.primary],
              ["Secondary Keywords", pkg.keywords.secondary],
              ["Long-Tail Keywords", pkg.keywords.longTail],
              ["Trending Keywords", pkg.keywords.trending],
            ].map(([label, words]) => (
              <div className="card" key={label}>
                <h3>{label}</h3>
                <div className="chips">
                  {(words || []).map((w) => (
                    <span className="chip" key={w}>
                      {w}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {pkg.sources?.length > 0 && (
            <div className="card sources" style={{ marginTop: 14 }}>
              <h3>Pinterest Research Sources</h3>
              {pkg.sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              ))}
            </div>
          )}
        </main>
      )}

      {history.length > 0 && (
        <section className="history">
          <h2>History (saved in your browser)</h2>
          {history.map((h, i) => (
            <div className="history-item" key={`${h.url}-${h.variation}-${i}`}>
              <div>
                <div className="t">{h.results.pinTitle}</div>
                <div className="d">
                  {h.originalTitle} · {new Date(h.generatedAt).toLocaleString()}
                  {h.variation > 0 ? ` · variation ${h.variation}` : ""}
                </div>
              </div>
              <div className="btns">
                <button className="small ghost" onClick={() => { setPkg(h); setUrl(h.url); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                  Open
                </button>
                <button className="small ghost" onClick={() => removeHistory(h)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <footer>
        Pinterest SEO Content Generator · Keywords are AI-generated estimates, not verified
        search-volume data. Some publishers block automated reading; those articles return an
        honest error instead of invented content.
      </footer>
    </div>
  );
}
