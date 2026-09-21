"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, CircleAlert, FileText, Link2, LoaderCircle, LockKeyhole, Pencil, RefreshCw, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import type { PublicState, ResumeBlock, Span } from "@/lib/types";
import ApplicationTracker, { ApplicationPrompt } from "@/components/application-tracker";
import type { ApplicationUpdate } from "@/lib/applications";
import PdfPreview from "@/components/pdf-preview";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options); const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request failed. Please try again.");
  return result as T;
}
const json = (value: unknown, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
const toEditor = (spans: Span[]) => spans.map(s => s.bold ? `**${s.text}**` : s.text).join("");
const fromEditor = (text: string): Span[] => text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(s => ({ text: s.startsWith("**") && s.endsWith("**") ? s.slice(2, -2) : s, bold: s.startsWith("**") && s.endsWith("**") }));

export default function Home() {
  const [view, setView] = useState<"resume" | "tracker">("resume");
  const [state, setState] = useState<PublicState | null>(null);
  const [error, setError] = useState(""); const [progress, setProgress] = useState(""); const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"paste" | "url">("paste"); const [url, setUrl] = useState("");
  const [job, setJob] = useState(""); const [company, setCompany] = useState(""); const [role, setRole] = useState("");
  const [preview, setPreview] = useState<"base" | "draft">("base");
  const [editing, setEditing] = useState<string | null>(null); const [editText, setEditText] = useState("");
  const [showAll, setShowAll] = useState(false); const [setupOpen, setSetupOpen] = useState(false); const [jobOpen, setJobOpen] = useState(true);
  const upload = useRef<HTMLInputElement>(null); const autoCompile = useRef(""); const initialLoad = useRef(false); const busyRef = useRef(false);
  const base = state?.base, draft = state?.draft; const busy = !!progress || !!state?.busy;
  const refresh = useCallback(async () => { const next = await request<PublicState>("/api/state"); setState(next); return next; }, []);
  useEffect(() => {
    if (initialLoad.current) return; initialLoad.current = true;
    void refresh().then(s => { if (s.draft) { setJob(s.draft.jobText); setCompany(s.draft.company); setRole(s.draft.role); setUrl(s.draft.jobUrl || ""); if (s.draft.jobUrl) setMode("url"); setPreview("draft"); setJobOpen(false); } }).catch(e => setError(e.message));
  }, [refresh]);
  async function perform(label: string, action: () => Promise<void>) {
    if (busyRef.current) throw new Error("An operation is already running.");
    busyRef.current = true; setProgress(label); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); throw e; }
    finally { busyRef.current = false; setProgress(""); }
  }
  function launch(label: string, action: () => Promise<void>) { void perform(label, action).catch(() => {}); }
  async function updateApplication(input: ApplicationUpdate) {
    await perform("Saving application…", async () => {
      try { setState(await request<PublicState>("/api/applications", json(input, "PATCH"))); }
      catch (error) { await refresh().catch(() => {}); throw error; }
    });
  }
  async function compile(target: "base" | "draft") {
    const next = await request<PublicState>("/api/compile", json({ target, draftId: draft?.id, revision: draft?.revision })); setState(next); setPreview(target);
  }
  useEffect(() => {
    if (!state || state.busy || progress || !state.base || state.base.compilation || !state.setup.latex || state.setup.missingPackages.length || autoCompile.current === state.base.hash) return;
    autoCompile.current = state.base.hash; launch("Compiling your original resume…", () => compile("base"));
    // One automatic attempt for each source. Failures can be retried explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, progress]);
  useEffect(() => { if (!state?.busy) return; const timer = setInterval(() => { void refresh().catch(() => {}); }, 2500); return () => clearInterval(timer); }, [state?.busy, refresh]);
  async function importFile(file: File) {
    const form = new FormData(); form.append("file", file);
    const next = await request<PublicState>("/api/resume", { method: "POST", body: form });
    setState(next); setPreview("base"); setEditing(null); setJobOpen(true); setNotice("Base resume updated. New rewrites will start from this source.");
  }
  async function extract() {
    const result = await request<{ text: string; company: string; role: string; truncated: boolean }>("/api/job/extract", json({ url }));
    setJob(result.text); setCompany(result.company); setRole(result.role);
    setNotice(result.truncated ? "Only the first 40,000 characters are shown. Check the description before generating." : "Description extracted. Check the text below before generating.");
  }
  async function generate() {
    const response = await fetch("/api/rewrite", json({ text: job, company, role, url: mode === "url" ? url : "" }));
    if (!response.ok) { const value = await response.json(); throw new Error(value.error || "Could not start the rewrite."); }
    if (!response.body) throw new Error("The rewrite connection was interrupted.");
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "", completed = false;
    try {
      while (true) {
        const { done, value } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue; const event = JSON.parse(line);
          if (event.type === "progress") setProgress(event.message);
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "result") { setState(event.state); setPreview("draft"); setEditing(null); setJobOpen(false); setShowAll(false); completed = true; }
        }
        if (done) break;
      }
      if (!completed) throw new Error("The connection ended early. Refresh to check saved work.");
    } catch (e) { await refresh().catch(() => {}); throw e; } finally { reader.releaseLock(); }
  }
  async function saveEdit(block: ResumeBlock, revert = false) {
    if (!draft || !base) return;
    const next = await request<PublicState>("/api/draft", json({ baseHash: base.hash, draftId: draft.id, revision: draft.revision,
      edits: [{ blockId: block.id, revert, spans: revert ? [{ text: block.originalText, bold: false }] : fromEditor(editText) }] }, "PATCH"));
    setState(next); setEditing(null); setPreview("draft"); setNotice("Change saved. Update the PDF to include it.");
  }

  const handlers = useRef({ get: () => ({} as unknown), stage: (_input: unknown) => ({} as unknown), generate: async () => ({} as unknown) });
  handlers.current = {
    get: () => ({ source: base?.filename ?? null, editableBlocks: base?.blocks.length ?? 0, draftStatus: draft?.status ?? null, busy }),
    stage: (input: unknown) => {
      if (busyRef.current || busy) throw new Error("Wait for the current operation to finish.");
      const v = input as { text?: unknown; company?: unknown; role?: unknown };
      if (typeof v?.text !== "string" || v.text.length < 100 || v.text.length > 40000 || (v.company !== undefined && (typeof v.company !== "string" || v.company.length > 150)) || (v.role !== undefined && (typeof v.role !== "string" || v.role.length > 150))) throw new Error("Provide 100–40,000 characters of job text and optional company and role strings.");
      setJob(v.text); setCompany((v.company as string) || ""); setRole((v.role as string) || ""); setMode("paste"); setJobOpen(true); return { staged: true, characters: v.text.length };
    },
    generate: async () => { await perform("Starting your rewrite…", generate); const current = await refresh(); return { draftId: current.draft?.id, status: current.draft?.status }; },
  };
  useEffect(() => {
    type Tool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => Promise<void> | void } }).modelContext;
    if (!context?.registerTool) return; const lifetime = new AbortController();
    const tools: Tool[] = [
      { name: "get_resume_workspace", description: "Read the active resume and draft status.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: () => handlers.current.get() },
      { name: "stage_job_description", description: "Fill the visible job and company/role fields. Does not run AI or generate a resume.", inputSchema: { type: "object", properties: { text: { type: "string", minLength: 100, maxLength: 40000 }, company: { type: "string", maxLength: 150 }, role: { type: "string", maxLength: 150 } }, required: ["text"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: input => handlers.current.stage(input) },
      { name: "generate_tailored_resume", description: "Send staged job and resume experience to OpenAI, replace the current draft with a checked rewrite, and compile its PDF. Uses API credits.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: () => handlers.current.generate() },
    ];
    for (const tool of tools) { try { void Promise.resolve(context.registerTool(tool, { signal: lifetime.signal })).catch(() => {}); } catch { /* optional API */ } }
    return () => lifetime.abort();
  }, []);
  const compilation = preview === "draft" ? draft?.compilation : base?.compilation;
  const hasPdf = !!compilation && (preview !== "draft" || compilation.revision === draft?.revision);
  const artifact = (format: "pdf" | "tex", download = false) => `/api/artifacts/${preview}.${format}?${new URLSearchParams({ ...(preview === "draft" && draft ? { id: draft.id, revision: String(draft.revision) } : {}), ...(download ? { download: "1" } : {}) })}`;
  const changedCount = draft?.changes.filter(c => c.status === "rewritten" || c.status === "edited").length ?? 0;
  const visible = base?.blocks.filter(b => showAll || draft?.changes.some(c => c.blockId === b.id)) ?? [];
  const setupProblem = state && (!state.setup.ai || !state.setup.latex || state.setup.missingPackages.length > 0);
  const eligible = !!base && !!state?.setup.ai && state.setup.latex && !state.setup.missingPackages.length && job.trim().length >= 100 && !busy && !editing;
  return <main>
    <header className="topbar"><a className="brand" href="/"><img src="/favicon.svg" alt="" width="32" height="32"/>Resume Rewriter</a><div className="header-right"><nav className="workspace-nav" aria-label="Workspace"><button aria-current={view === "resume" ? "page" : undefined} onClick={() => setView("resume")}>Resume</button><button aria-current={view === "tracker" ? "page" : undefined} onClick={() => { setView("tracker"); void refresh().catch(e => setError(e.message)); }}>Applications <span>{state?.applications?.filter(a => a.appliedAt).length || 0}</span></button></nav><span className="local-label"><LockKeyhole size={14}/>Local workspace</span><button className="icon-button" onClick={() => { setSetupOpen(!setupOpen); void refresh().catch(e => setError(e.message)); }} aria-label="Open setup details"><CircleAlert size={18}/></button></div></header>
    {setupOpen && <section className="setup-panel"><div><strong>Workspace setup</strong><button className="icon-button" onClick={() => setSetupOpen(false)} aria-label="Close setup details"><X size={18}/></button></div><p>OpenAI key: {state?.setup.ai ? "configured" : "not configured"} · Model: {state?.setup.model || "gpt-5-mini"}</p><p>LaTeX: {state?.setup.latex ? "installed" : "not found"}{state?.setup.missingPackages.length ? ` · Missing: ${state.setup.missingPackages.join(", ")}` : ""}</p><p>Set <code>OPENAI_API_KEY</code> in <code>.env.local</code>. For PDF setup, run <code>npm run setup:latex</code>. Run <code>npm run doctor</code> to check configuration.</p><button className="text-button" onClick={() => void refresh().catch(e => setError(e.message))}><RefreshCw size={14}/>Check again</button></section>}
    {view === "tracker" && <ApplicationTracker entries={state?.applications ?? []} busy={busy} update={updateApplication} returnToResume={() => setView("resume")}/>}
    <div className="workspace" hidden={view !== "resume"}><section className="editor"><div className="eyebrow">YOUR NEXT APPLICATION</div><h1>A better fit.<br/><span>The same experience.</span></h1><p className="intro">Give your resume the right emphasis for the role.</p>
      <div className="source-card"><div className="source-icon"><FileText size={23}/></div><div className="source-info"><strong>{base ? "Your base resume" : "Add your base resume"}</strong><p title={base?.filename}>{base?.filename || "Import a .tex file or project ZIP"}</p><div className="source-meta">{base && <><span>{base.blocks.length} editable {base.blocks.some(b => b.kind === "summary") ? "blocks" : "bullets"}</span><span>·</span><span>{base.compilation ? `${base.compilation.pages} ${base.compilation.pages === 1 ? "page" : "pages"}` : "LaTeX source"}</span></>}</div></div><input ref={upload} type="file" accept=".tex,.zip" className="visually-hidden" aria-label="Import base resume" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) launch("Importing your resume…", () => importFile(file)); e.target.value = ""; }}/><button className="icon-button" title="Replacing the base clears the current draft" aria-label={base ? "Replace base resume" : "Import resume"} onClick={() => upload.current?.click()} disabled={busy || !!editing}><Upload size={18}/></button></div>
      {base?.importNotes?.map((note, i) => <details className="import-note" key={i}><summary>Template compatibility adjustment</summary><p>{note}</p></details>)}
      {draft && <p className="base-note">Each rewrite starts from your base. Replacing it clears the current draft.</p>}
      {setupProblem && <div className="setup-notice"><CircleAlert size={17}/><span>{!state.setup.ai ? "Add your OpenAI key to enable rewriting." : !state.setup.latex ? "Set up LaTeX to generate PDFs." : "Your template needs additional LaTeX packages."} <button onClick={() => setSetupOpen(true)}>Setup details</button></span></div>}
      <section className="job-section"><button className="section-toggle" onClick={() => setJobOpen(!jobOpen)} aria-expanded={jobOpen}><span><span className="step-number">01</span>{draft && !jobOpen ? [draft.role || "Target role", draft.company].filter(Boolean).join(" · ") : "The opportunity"}</span><ChevronDown size={17} className={jobOpen ? "rotated" : ""}/></button>
      {jobOpen && <div className="job-content"><div className="input-tabs" role="tablist" aria-label="Job input method"><button role="tab" aria-selected={mode === "paste"} onClick={() => setMode("paste")}><FileText size={15}/>Paste description</button><button role="tab" aria-selected={mode === "url"} onClick={() => setMode("url")}><Link2 size={15}/>Use a link</button></div>
        {mode === "url" && <div className="url-field"><label className="field-label" htmlFor="url">Job posting URL</label><div className="url-row"><input id="url" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://company.com/careers/role" disabled={busy}/><button className="secondary" onClick={() => launch("Reading the job posting…", extract)} disabled={!url.trim() || busy}>Extract</button></div><p className="help">If the website blocks access, paste the description instead.</p></div>}
        <label className="field-label" htmlFor="job">{mode === "url" ? "Review the extracted description" : "Job description"}</label><textarea id="job" rows={8} maxLength={40000} value={job} disabled={busy} onChange={e => setJob(e.target.value)} placeholder={"Paste the full job description here.\n\nInclude the responsibilities, requirements, and what the team is looking for."}/><div className="textarea-footer"><span>Responsibilities and requirements work best</span><span>{job.length.toLocaleString()} / 40,000</span></div>
        <div className="metadata-fields"><div><label className="field-label" htmlFor="company">Company <span>optional</span></label><input id="company" type="text" maxLength={150} value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Stripe" disabled={busy}/></div><div><label className="field-label" htmlFor="role">Role <span>optional</span></label><input id="role" type="text" maxLength={150} value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Software Engineer" disabled={busy}/></div></div>
        <button className="primary" onClick={() => launch("Starting your rewrite…", generate)} disabled={!eligible}><Sparkles size={18}/>{draft ? "Generate a new rewrite" : "Tailor my resume"}<ArrowUpRight size={18}/></button><p className="generation-note"><LockKeyhole size={12}/>Files stay local. Resume experience and job text are sent to OpenAI.</p>
      </div>}</section>
      {(progress || state?.busy) && <div className="progress-box" role="status" aria-live="polite"><LoaderCircle size={18} className="spin"/><span>{progress || "An operation is running in another window…"}</span></div>}
      {error && <div className="alert error" role="alert"><CircleAlert size={18}/><div>{error}</div><button className="icon-button" onClick={() => setError("")} aria-label="Dismiss error"><X size={15}/></button></div>}
      {notice && !error && <div className="notice" role="status"><Check size={16}/>{notice}</div>}
      {state?.applications?.find(a => a.draftId === draft?.id) && <ApplicationPrompt entry={state.applications.find(a => a.draftId === draft?.id)!} busy={busy} update={updateApplication} openTracker={() => setView("tracker")}/>}
      {draft && <section className="review-section"><div className="review-heading"><div><span className="step-number">02</span><h2>Review the changes</h2></div><span className="tag">{changedCount} tailored</span></div><p className="review-intro">Review the new emphasis. Edit anything that doesn’t sound like you.</p>
        {draft.error && <div className="alert error"><CircleAlert size={18}/><div>{draft.error}</div></div>}
        {draft.warnings.map((w, i) => <div className="notice" key={i}><CircleAlert size={16}/>{w}</div>)}
        {visible.map(block => { const c = draft.changes.find(c => c.blockId === block.id); const changed = c?.status === "rewritten" || c?.status === "edited"; return <article className="change-card" key={block.id}>
          <div className="change-header"><span>{block.section}</span><div><button className="icon-button" title="Edit wording" aria-label={`Edit ${block.id}`} disabled={busy || (!!editing && editing !== block.id)} onClick={() => { setEditing(block.id); setEditText(changed ? toEditor(c.spans) : block.originalText); }}><Pencil size={14}/></button>{c && c.status !== "reverted" && <button className="icon-button" title="Restore original" aria-label={`Revert ${block.id}`} disabled={busy || !!editing} onClick={() => launch("Restoring original wording…", () => saveEdit(block, true))}><RotateCcw size={15}/></button>}</div></div>
          <h3>{block.context || block.section}</h3><div className="original-text"><span className="text-label">ORIGINAL</span><p>{block.originalText}</p></div>
          {editing === block.id ? <div className="edit-region"><label className="field-label" htmlFor={`edit-${block.id}`}>Your wording</label><textarea id={`edit-${block.id}`} value={editText} maxLength={6000} onChange={e => setEditText(e.target.value)} rows={6}/><p className="help">Use **bold** for emphasis. Your edits are kept as written.</p><div className="edit-actions"><button className="text-button" onClick={() => setEditing(null)} disabled={busy}>Cancel</button><button className="secondary" disabled={busy || !editText.trim()} onClick={() => launch("Saving your edit…", () => saveEdit(block))}>Save change</button></div></div> : <>
            {changed && <div className="rewritten-text"><span className="text-label">{c.status === "edited" ? "YOUR EDIT" : "TAILORED"}</span><p>{c.spans.map((s, i) => s.bold ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>)}</p></div>}
            <div className={`change-reason ${c?.status === "flagged" ? "flagged" : ""}`}>{c?.status === "flagged" ? <CircleAlert size={14}/> : <Check size={14}/>}<span>{c?.warning || c?.reason || "Original wording kept."}</span></div></>}
        </article>; })}<button className="show-all" onClick={() => setShowAll(!showAll)}>{showAll ? "Show changed bullets only" : `View all ${base?.blocks.length} resume blocks`}<ChevronDown size={15}/></button>
      </section>}
      {!draft && <div className="principles">{["Original facts preserved", "Your LaTeX layout retained", "Every change is reviewable"].map(text => <div key={text}><Check size={15}/><span>{text}</span></div>)}</div>}
      <footer className="editor-footer"><span>Built around your experience.</span><span>LaTeX → PDF</span></footer>
    </section><section className="preview" aria-label="Resume preview"><div className="preview-sticky"><div className="preview-toolbar"><div className="preview-title"><FileText size={17}/><strong>Resume preview</strong></div><div className="preview-tabs" role="tablist" aria-label="Preview version"><button role="tab" aria-selected={preview === "base"} onClick={() => setPreview("base")}>Original</button><button role="tab" aria-selected={preview === "draft"} disabled={!draft} onClick={() => setPreview("draft")}>Tailored</button></div></div>
      <div className="preview-info"><span>{preview === "base" ? "Your original template" : draft?.role || "Tailored resume"}</span><span>{compilation ? `${compilation.pages} ${compilation.pages === 1 ? "page" : "pages"}` : "Not compiled"}{preview === "draft" && draft && <span className={`status-pill ${draft.status}`}>{draft.status === "ready" ? "Ready to download" : draft.status === "overflow" ? "Needs shortening" : draft.status === "error" ? "Needs attention" : "PDF needs update"}</span>}</span></div>
      <div className="pdf-stage">{hasPdf ? <PdfPreview key={`${preview}-${compilation.sourceHash}`} url={artifact("pdf")}/> : <div className="preview-empty"><div className="empty-document"><FileText size={52} strokeWidth={1}/></div><h2>{preview === "draft" ? "Your edits are saved." : "Your layout stays yours."}</h2><p>{preview === "draft" ? "Update the PDF to see your latest wording in the original template." : !state ? "Loading your resume…" : "Compile your base resume to see its original layout here."}</p>{base && <button className="secondary" disabled={busy || !state?.setup.latex || !!state.setup.missingPackages.length} onClick={() => launch("Compiling your resume…", () => compile(preview))}><RefreshCw size={15}/>{preview === "draft" ? "Update PDF" : "Compile original"}</button>}</div>}</div>
      <div className="export-bar"><div className="export-status"><Check size={15}/><span>{hasPdf ? preview === "base" ? "Original source preserved" : draft?.status === "ready" ? "PDF matches this revision" : "Review required before export" : "Your source is saved"}</span></div><div className="export-actions">{hasPdf && <a className="icon-button" href={artifact("pdf")} target="_blank" rel="noreferrer" title="Open PDF" aria-label="Open PDF"><ArrowUpRight size={18}/></a>}{base && <a className="download-tex" href={artifact("tex", true)}>LaTeX<ArrowDownToLine size={14}/></a>}{preview === "draft" && draft && draft.status !== "ready" ? <button className="export-pdf" disabled={busy || !!editing} onClick={() => launch("Compiling your latest changes…", () => compile("draft"))}><RefreshCw size={15}/>Update PDF</button> : hasPdf ? <a className="export-pdf" href={artifact("pdf", true)}><ArrowDownToLine size={15}/>Download PDF</a> : <button className="export-pdf" disabled><ArrowDownToLine size={15}/>Download PDF</button>}</div></div>
      {compilation?.warnings.length ? <details className="compile-warnings"><summary>LaTeX layout notices ({compilation.warnings.length})</summary>{compilation.warnings.map((w, i) => <p key={i}>{w}</p>)}</details> : null}
    </div></section></div>
  </main>;
}
