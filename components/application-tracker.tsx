"use client";
import { useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, ClipboardList, Pencil, X } from "lucide-react";
import type { Application, ApplicationStatus } from "@/lib/types";
import type { ApplicationUpdate } from "@/lib/applications";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const labels: Record<ApplicationStatus, string> = {
  pending: "Awaiting your answer", not_applied: "Not applied yet", applied: "Applied",
  interview: "Interviewing", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn",
};
type Update = (input: ApplicationUpdate) => Promise<void>;
export function ApplicationPrompt({ entry, busy, update, openTracker }: { entry: Application; busy: boolean; update: Update; openTracker: () => void }) {
  const submitted = !!entry.appliedAt;
  return <section className={`application-prompt ${submitted ? "submitted" : ""}`} aria-label="Application follow-up">
    <div className="prompt-icon">{submitted ? <Check size={20}/> : <ClipboardList size={20}/>}</div>
    <div><h2>{submitted ? "Saved to your application tracker" : "Did you apply to this role?"}</h2>
      <p>{[entry.company, entry.role].filter(Boolean).join(" · ") || "Your tailored opportunity"}</p>
      <p className="help">{submitted ? `${labels[entry.status]} · ${entry.appliedAt}` : entry.status === "not_applied" ? "No rush. Mark it applied here or in the tracker when you’re ready." : "Generating a resume doesn’t submit an application. Tell us when you’ve sent it."}</p>
      <div className="prompt-actions">{!submitted && <><button className="secondary affirmative" disabled={busy} onClick={() => { void update({ id: entry.id, revision: entry.revision, status: "applied", appliedAt: today() }).catch(() => {}); }}><Check size={15}/>Yes, I applied</button>{entry.status === "pending" && <button className="secondary" disabled={busy} onClick={() => { void update({ id: entry.id, revision: entry.revision, status: "not_applied" }).catch(() => {}); }}>Not yet</button>}</>}
      <button className="text-button" onClick={openTracker}>View tracker <ArrowUpRight size={14}/></button></div>
    </div>
  </section>;
}

function SavedResumeLinks({ entry }: { entry: Application }) {
  if (!entry.resume) return <p className="help">Resume unavailable for this older application.</p>;
  const url = `/api/applications/${encodeURIComponent(entry.id)}/resume`;
  return <div className="application-links" aria-label="Saved resume">
    {entry.resume.compilation ? <>
      <a href={`${url}.pdf`} target="_blank" rel="noreferrer">View resume <ArrowUpRight size={14}/></a>
      <a href={`${url}.pdf?download=1`}><ArrowDownToLine size={14}/>Download PDF</a>
    </> : <span>PDF was not compiled for this version.</span>}
    <a href={`${url}.tex`}><ArrowDownToLine size={14}/>LaTeX source</a>
  </div>;
}

export default function ApplicationTracker({ entries, busy, update, returnToResume }: { entries: Application[]; busy: boolean; update: Update; returnToResume: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<Application | null>(null);
  const [error, setError] = useState("");
  const applied = entries.filter(e => e.appliedAt);
  const waiting = entries.filter(e => !e.appliedAt);
  const visible = applied.filter(e => (filter === "all" || e.status === filter) && `${e.company} ${e.role} ${e.notes}`.toLowerCase().includes(query.toLowerCase()));
  async function save(input: ApplicationUpdate) {
    setError(""); try { await update(input); setEditing(null); } catch (e) { setError(e instanceof Error ? e.message : "Could not save application."); }
  }
  return <section className="tracker-page" aria-label="Application tracker">
    <div className="tracker-heading"><div><div className="eyebrow">YOUR JOB SEARCH</div><h1>Every application.<br/><span>One place to follow through.</span></h1><p className="intro">Keep a record of where you applied and what happens next.</p></div>
      <a className="secondary" href="/api/applications/export"><ArrowDownToLine size={16}/>Export CSV</a></div>
    <div className="tracker-stats">{[["Applications", applied.length], ["Interviewing", applied.filter(a => a.status === "interview").length], ["Offers", applied.filter(a => a.status === "offer").length], ["Not applied yet", waiting.length]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
    {error && <p role="alert" className="alert error">{error}</p>}
    {waiting.length > 0 && <details className="followup-list" open={applied.length === 0}><summary>{waiting.length} prepared {waiting.length === 1 ? "resume" : "resumes"} · Did you apply?</summary><p className="help">These jobs are not counted as applications until you confirm.</p>
      {waiting.map(entry => <div className="followup-row" key={entry.id}><div><strong>{entry.company || "Company not specified"}</strong><p>{entry.role || "Role not specified"}</p><small>{labels[entry.status]}</small><SavedResumeLinks entry={entry}/></div><div className="prompt-actions"><button className="secondary affirmative" disabled={busy} onClick={() => void save({ id: entry.id, revision: entry.revision, status: "applied", appliedAt: today() })}>Yes, I applied</button>{entry.status === "pending" && <button className="secondary" disabled={busy} onClick={() => void save({ id: entry.id, revision: entry.revision, status: "not_applied" })}>Not yet</button>}<button className="icon-button" aria-label={`Edit ${entry.company || "prepared job"}`} disabled={busy} onClick={() => setEditing({ ...entry })}><Pencil size={16}/></button></div></div>)}
    </details>}
    <div className="tracker-filters"><input type="text" aria-label="Search applications" placeholder="Search company, role, or notes…" value={query} onChange={e => setQuery(e.target.value)}/><select aria-label="Filter application status" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All statuses</option>{Object.entries(labels).filter(([key]) => !["pending", "not_applied"].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    {visible.length ? <div className="application-grid">{visible.map(entry => <article className="application-card" key={entry.id}><div className="application-card-top"><span className={`application-status ${entry.status}`}>{labels[entry.status]}</span><button className="icon-button" aria-label={`Edit ${entry.company || "application"}`} disabled={busy} onClick={() => { setError(""); setEditing({ ...entry }); }}><Pencil size={16}/></button></div><h2>{entry.company || "Company not specified"}</h2><p className="application-role">{entry.role || "Role not specified"}</p><p className="help">Applied {entry.appliedAt}</p>{entry.notes && <p className="application-notes">{entry.notes}</p>}<div className="application-links">{entry.jobUrl && <a href={entry.jobUrl} target="_blank" rel="noreferrer">Job posting <ArrowUpRight size={14}/></a>}<span>Updated {entry.updatedAt.slice(0, 10)}</span></div><SavedResumeLinks entry={entry}/><details><summary>Saved job description</summary><p className="saved-description">{entry.jobText}</p></details></article>)}</div> : <div className="tracker-empty"><ClipboardList size={34}/><h2>{applied.length ? "No matching applications" : "Your first application starts here"}</h2><p>{applied.length ? "Try another search or status." : "Tailor a resume, then choose “Yes, I applied” to add the job to this tracker."}</p><button className="secondary" onClick={returnToResume}>Back to resume workspace</button></div>}
    <p className="tracker-local">Saved on this computer. Saved resumes stay with each job when you rewrite or replace your base resume. Marking a job applied preserves that resume version.</p>
    {editing && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="application-edit-title" className="application-modal" onKeyDown={e => {
      if (e.key === "Escape" && !busy) setEditing(null);
      if (e.key === "Tab") {
        const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href]'));
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}><div className="tracker-heading"><h2 id="application-edit-title">Application details</h2><button className="icon-button" disabled={busy} onClick={() => setEditing(null)} aria-label="Close application details"><X size={18}/></button></div>
      <form onSubmit={e => { e.preventDefault(); void save({ id: editing.id, revision: editing.revision, company: editing.company, role: editing.role, status: editing.status, notes: editing.notes, jobUrl: editing.jobUrl, appliedAt: editing.appliedAt || today() }); }}>
        <label className="field-label" htmlFor="application-company">Company</label><input autoFocus id="application-company" type="text" required maxLength={150} value={editing.company} onChange={e => setEditing({ ...editing, company: e.target.value })}/>
        <label className="field-label" htmlFor="application-role">Role</label><input id="application-role" type="text" required maxLength={150} value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value })}/>
        <div className="metadata-fields"><div><label className="field-label" htmlFor="application-status">Status</label><select id="application-status" value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value as ApplicationStatus })}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div><label className="field-label" htmlFor="application-date">Applied on</label><input id="application-date" type="date" disabled={["pending", "not_applied"].includes(editing.status)} value={editing.appliedAt || ""} onChange={e => setEditing({ ...editing, appliedAt: e.target.value || null })}/></div></div>
        <label className="field-label" htmlFor="application-url">Job posting URL</label><input id="application-url" type="url" maxLength={4000} value={editing.jobUrl} onChange={e => setEditing({ ...editing, jobUrl: e.target.value })}/>
        <label className="field-label" htmlFor="application-notes">Notes</label><textarea id="application-notes" rows={3} maxLength={10000} value={editing.notes} placeholder="Recruiter, interview dates, follow-up reminders…" onChange={e => setEditing({ ...editing, notes: e.target.value })}/>
        {error && <p role="alert" className="alert error">{error}</p>}<div className="edit-actions"><button className="secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="secondary affirmative" type="submit" disabled={busy}>{busy ? "Saving…" : "Save application"}</button></div>
      </form>
    </section></div>}
  </section>;
}
