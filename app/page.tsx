"use client";

import { useEffect, useRef, useState } from "react";
import type { Confidence, Extraction } from "@/lib/schema";

const CONCURRENCY = 2;

type Meta = {
  model: string;
  filename: string;
  bytes: number;
  durationMs: number;
  usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null;
};

type Options = { transcribe: boolean; instructions: string; model: string };

type Job = {
  id: string;
  file: File;
  options: Options;
  status: "queued" | "processing" | "done" | "error";
  startedAt?: number;
  data?: Extraction;
  meta?: Meta;
  error?: string;
};

const TABS = ["Overview", "Fields", "Tables", "Entities", "Sections", "Visuals", "Pages", "JSON"] as const;
type Tab = (typeof TABS)[number];

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transcribe, setTranscribe] = useState(true);
  const [instructions, setInstructions] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Single queue shared by all uploads so concurrency stays bounded across drops.
  const queue = useRef<Job[]>([]);
  const active = useRef(0);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((j: { models: string[]; default: string }) => {
        setModels(j.models);
        setModel(j.default);
      })
      .catch(() => {});
  }, []);

  const update = (id: string, patch: Partial<Job>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const runJob = async (job: Job) => {
    update(job.id, { status: "processing", startedAt: Date.now(), error: undefined });
    const body = new FormData();
    body.append("file", job.file);
    body.append("transcribe", String(job.options.transcribe));
    body.append("instructions", job.options.instructions);
    if (job.options.model) body.append("model", job.options.model);
    try {
      const res = await fetch("/api/extract", { method: "POST", body });
      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      update(job.id, { status: "done", data: json.data, meta: json.meta });
    } catch (e) {
      update(job.id, { status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };

  const pump = () => {
    while (active.current < CONCURRENCY && queue.current.length) {
      const job = queue.current.shift()!;
      active.current++;
      runJob(job).finally(() => {
        active.current--;
        pump();
      });
    }
  };

  // Retries use the currently selected options (e.g. to try another model).
  const retry = (job: Job) => {
    const next = { ...job, options: { transcribe, instructions, model } };
    update(job.id, { status: "queued", options: next.options, error: undefined });
    queue.current.push(next);
    pump();
  };

  const addFiles = (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (!pdfs.length) return;
    const options = { transcribe, instructions, model };
    const newJobs: Job[] = pdfs.map((file) => ({ id: crypto.randomUUID(), file, options, status: "queued" }));
    setJobs((prev) => [...newJobs, ...prev]);
    setSelectedId((cur) => cur ?? newJobs[0].id);
    queue.current.push(...newJobs);
    pump();
  };

  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  return (
    <main className="container">
      <header className="header">
        <h1>VLM PDF Extract</h1>
        <p className="muted">
          Upload PDFs and a vision language model (OpenAI) reads every page, including scans, tables,
          handwriting and signatures, and returns structured data.
        </p>
      </header>

      <section
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <strong>Drop PDF files here</strong>
        <span className="muted">or click to browse (max 50 MB each)</span>
      </section>

      <section className="options">
        <div className="row">
          <label className="field">
            Model
            <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!models.length}>
              {models.map((m, i) => (
                <option key={m} value={m}>
                  {m}
                  {i === 0 ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={transcribe} onChange={(e) => setTranscribe(e.target.checked)} />
          Include full page-by-page transcription
        </label>
        <textarea
          placeholder="Optional extra instructions, e.g. “Focus on payment terms and all monetary amounts”"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={2}
        />
      </section>

      {jobs.length > 0 && (
        <div className="layout">
          <aside className="filelist">
            {jobs.map((j) => (
              <button
                key={j.id}
                className={`fileitem ${j.id === selectedId ? "active" : ""}`}
                onClick={() => setSelectedId(j.id)}
              >
                <span className="filename">{j.file.name}</span>
                <span className={`badge ${j.status}`}>{j.status}</span>
              </button>
            ))}
          </aside>
          <div className="result">
            {selected && <JobView key={selected.id} job={selected} onRetry={() => retry(selected)} />}
          </div>
        </div>
      )}
    </main>
  );
}

function JobView({ job, onRetry }: { job: Job; onRetry: () => void }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (job.status !== "processing") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job.status]);

  if (job.status === "queued" || job.status === "processing") {
    const elapsed = job.startedAt ? Math.max(0, Math.round((now - job.startedAt) / 1000)) : 0;
    return (
      <div className="card center">
        <div className="spinner" />
        <p>{job.status === "queued" ? "Waiting in queue…" : `Analyzing ${job.file.name} with ${job.options.model}… ${elapsed}s`}</p>
        <p className="muted small">Scanned or handwritten documents can take 1–3 minutes per few pages.</p>
      </div>
    );
  }
  if (job.status === "error" || !job.data) {
    return (
      <div className="card error">
        <strong>Extraction failed</strong>
        <p>{job.error}</p>
        <button className="btn" onClick={onRetry}>Retry</button>
      </div>
    );
  }

  const d = job.data;
  const counts: Partial<Record<Tab, number>> = {
    Fields: d.key_values.length + d.metadata.length,
    Tables: d.tables.length,
    Entities: d.entities.length,
    Sections: d.sections.length,
    Visuals: d.visual_elements.length,
    Pages: d.pages?.length ?? 0,
  };

  const download = () => {
    const blob = new Blob([JSON.stringify({ ...d, _meta: job.meta }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = job.file.name.replace(/\.pdf$/i, "") + ".extraction.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const copy = async () => {
    await navigator.clipboard?.writeText(JSON.stringify(d, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const uncertain = d.key_values.filter((k) => k.confidence !== "high").length;

  return (
    <div className="card">
      <div className="resulthead">
        <div>
          <h2>{d.title || job.file.name}</h2>
          <p className="muted small">
            {d.document_type} · {d.page_count} page{d.page_count === 1 ? "" : "s"}
            {d.language ? ` · ${d.language}` : ""} · {job.meta?.model} · {((job.meta?.durationMs ?? 0) / 1000).toFixed(1)}s
            {job.meta?.usage?.total_tokens ? ` · ${job.meta.usage.total_tokens.toLocaleString()} tokens` : ""}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={onRetry} title="Re-run with the currently selected options">Re-run</button>
          <button className="btn" onClick={copy}>{copied ? "Copied" : "Copy JSON"}</button>
          <button className="btn primary" onClick={download}>Download JSON</button>
        </div>
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${t === tab ? "active" : ""}`} onClick={() => setTab(t)}>
            {t}
            {counts[t] ? <span className="count">{counts[t]}</span> : null}
          </button>
        ))}
      </nav>

      <div className="tabbody">
        {tab === "Overview" && (
          <>
            <h3>Summary</h3>
            <p className="prewrap">{d.summary}</p>
            {d.metadata.length > 0 && (
              <>
                <h3>Metadata</h3>
                <KVTable rows={d.metadata} />
              </>
            )}
            {d.warnings.length > 0 && (
              <>
                <h3>Warnings</h3>
                <ul className="warnings">{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </>
            )}
          </>
        )}

        {tab === "Fields" &&
          (d.key_values.length ? (
            <>
              {uncertain > 0 && (
                <p className="notice">
                  {uncertain} field{uncertain === 1 ? "" : "s"} with medium/low confidence are highlighted. Verify them against the source.
                </p>
              )}
              <KVTable rows={d.key_values} showPage />
            </>
          ) : <Empty />)}

        {tab === "Tables" &&
          (d.tables.length ? (
            d.tables.map((t, i) => (
              <div key={i} className="tablewrap">
                <h3>
                  {t.title || `Table ${i + 1}`}
                  {t.page ? <span className="muted small"> · page {t.page}</span> : null}
                </h3>
                <div className="scroll">
                  <table>
                    {t.headers.length > 0 && (
                      <thead><tr>{t.headers.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
                    )}
                    <tbody>
                      {t.rows.map((r, j) => (
                        <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          ) : <Empty />)}

        {tab === "Entities" &&
          (d.entities.length ? (
            <div className="scroll">
              <table>
                <thead><tr><th>Type</th><th>Value</th><th>Context</th><th>Page</th></tr></thead>
                <tbody>
                  {d.entities.map((e, i) => (
                    <tr key={i}>
                      <td><span className="tag">{e.type}</span></td>
                      <td>{e.value}</td>
                      <td className="muted">{e.context}</td>
                      <td>{e.page ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty />)}

        {tab === "Sections" &&
          (d.sections.length ? (
            d.sections.map((s, i) => (
              <div key={i} className="section">
                <h3>{s.heading}{s.page ? <span className="muted small"> · page {s.page}</span> : null}</h3>
                <p className="prewrap">{s.content}</p>
              </div>
            ))
          ) : <Empty />)}

        {tab === "Visuals" &&
          (d.visual_elements.length ? (
            <ul className="visuals">
              {d.visual_elements.map((v, i) => (
                <li key={i}>
                  <span className="tag">{v.type}</span>
                  {v.page ? <span className="muted small"> page {v.page} </span> : null}
                  <div>{v.description}</div>
                </li>
              ))}
            </ul>
          ) : <Empty />)}

        {tab === "Pages" &&
          (d.pages?.length ? (
            d.pages.map((p) => (
              <div key={p.page_number} className="page">
                <div className="pagelabel">Page {p.page_number}</div>
                <pre>{p.text}</pre>
              </div>
            ))
          ) : <Empty text="Enable “full page-by-page transcription” and retry to get page text." />)}

        {tab === "JSON" && <pre className="json">{JSON.stringify(d, null, 2)}</pre>}
      </div>
    </div>
  );
}

type KVRow = { key: string; value: string; page?: number | null; confidence?: Confidence; note?: string | null };

function KVTable({ rows, showPage }: { rows: KVRow[]; showPage?: boolean }) {
  return (
    <div className="scroll">
      <table>
        <thead><tr><th>Field</th><th>Value</th>{showPage && <th>Page</th>}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.confidence && r.confidence !== "high" ? `conf-${r.confidence}` : undefined}>
              <td className="key">{r.key}</td>
              <td className="prewrap">
                {r.value || <span className="muted">(blank)</span>}
                {r.confidence && r.confidence !== "high" && <span className={`conf ${r.confidence}`}>{r.confidence}</span>}
                {r.note && <div className="muted small">{r.note}</div>}
              </td>
              {showPage && <td>{r.page ?? ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text = "Nothing found in this document." }: { text?: string }) {
  return <p className="muted">{text}</p>;
}
