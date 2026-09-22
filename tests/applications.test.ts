import { describe, expect, it, vi } from "vitest";
import { applicationUpdateSchema, applicationsCsv, ensureApplications, updateApplication } from "../lib/applications";
import { generateDraft } from "../lib/pipeline";
import { parseResume, hash } from "../lib/latex";
import type { AppState } from "../lib/types";
import type { RewriteAI } from "../lib/ai";
const now = "2026-09-20T12:00:00.000Z";
const base = () => parseResume(String.raw`\documentclass{article}\begin{document}\section{Experience}\resumeItem{Built tools with TypeScript.}\end{document}`, "resume.tex");
const ai: RewriteAI = {
  rewrite: vi.fn(async () => ({ company: "Example", role: "Engineer", changes: [] })),
  review: vi.fn(async () => ({ reviews: [] })),
};
const deps = { ai, save: vi.fn(async () => {}), compile: vi.fn(async (source: string, revision: number) => ({ sourceHash: hash(source), revision, pages: 1, artifact: "example.pdf", warnings: [] })) };
const job = { text: "A job description", company: "Example", role: "Engineer", url: "https://example.org/jobs/1" };
const state = (): AppState => ({ base: base(), draft: { id: "draft-1", baseHash: "original", revision: 1, company: "Acme", role: "Developer", jobText: "Saved job description", status: "ready", changes: [], warnings: [] } });

describe("application tracking", () => {
  it("migrates old workspaces once without treating generation as applying", () => {
    const s = state(); expect(ensureApplications(s, now)).toBe(true); expect(ensureApplications(s, now)).toBe(false);
    expect(s.applications).toHaveLength(1); expect(s.applications![0]).toMatchObject({ status: "pending", appliedAt: null, jobText: "Saved job description" });
  });
  it("keeps each generated job after a new rewrite and does not duplicate on compilation", async () => {
    const s: AppState = { base: base(), draft: null };
    await generateDraft(s, job, deps); const first = s.applications![0];
    updateApplication(s, { id: first.id, revision: 1, status: "applied" }, now);
    await generateDraft(s, { ...job, company: "Second" }, deps);
    expect(s.applications).toHaveLength(2); expect(s.applications![0].jobUrl).toBe(job.url);
    expect(s.applications![1]).toMatchObject({ company: "Example", status: "applied", appliedAt: "2026-09-20" });
    ensureApplications(s); expect(s.applications).toHaveLength(2);
    // The resume import route preserves the rest of the workspace.
    const imported = { ...s, base: base(), draft: null }; ensureApplications(imported);
    expect(imported.applications).toEqual(s.applications);
  });
  it("does not add a job when AI fails before producing a draft", async () => {
    const s = state(); ensureApplications(s, now); const original = JSON.stringify(s.applications);
    await expect(generateDraft(s, job, { ...deps, ai: { ...ai, rewrite: async () => { throw new Error("API failed"); } } })).rejects.toThrow();
    expect(JSON.stringify(s.applications)).toBe(original);
  });
  it("allows not yet then applied, status/notes updates, and correction back to not applied", () => {
    const s = state(); ensureApplications(s, now); const id = s.applications![0].id;
    expect(updateApplication(s, { id, revision: 1, status: "not_applied" }, now).appliedAt).toBeNull();
    expect(updateApplication(s, { id, revision: 2, status: "applied" }, now).appliedAt).toBe("2026-09-20");
    expect(updateApplication(s, { id, revision: 3, status: "interview", notes: "Friday interview" }, "2026-09-22T12:00:00Z")).toMatchObject({ appliedAt: "2026-09-20", notes: "Friday interview" });
    expect(updateApplication(s, { id, revision: 4, status: "not_applied" }, now).appliedAt).toBeNull();
    expect(s.applications).toHaveLength(1);
  });
  it("rejects stale updates, unknown jobs and future dates without changing the record", () => {
    const s = state(); ensureApplications(s, now); const original = JSON.stringify(s);
    expect(() => updateApplication(s, { id: "bad", revision: 1 }, now)).toThrow(/found/);
    expect(() => updateApplication(s, { id: "draft-1", revision: 9 }, now)).toThrow(/another window/);
    expect(() => updateApplication(s, { id: "draft-1", revision: 1, status: "applied", appliedAt: "2027-01-01" }, now)).toThrow(/future/);
    expect(JSON.stringify(s)).toBe(original);
  });
  it("updates prepared snapshots and freezes the submitted version across edits and rewrites", async () => {
    const s: AppState = { base: base(), draft: null };
    await generateDraft(s, job, deps); ensureApplications(s, now);
    const entry = s.applications![0];
    expect(entry.resume?.compilation?.sourceHash).toBe(hash(entry.resume!.source));
    s.draft!.changes = [{ blockId: s.base!.blocks[0].id, spans: [{ text: "Built TypeScript tools.", bold: false }], reason: "Edit", status: "edited" }];
    s.draft!.revision++; s.draft!.compilation = undefined;
    updateApplication(s, { id: entry.id, revision: 1, status: "applied" }, now);
    expect(entry.resume!.source).toContain("Built TypeScript tools.");
    expect(entry.resume!.compilation).toBeUndefined();
    const saved = structuredClone(entry.resume);
    s.draft!.changes = []; s.draft!.revision++;
    ensureApplications(s); expect(entry.resume).toEqual(saved);
    await generateDraft(s, { ...job, company: "Second" }, deps);
    expect(s.applications![1].resume).toEqual(saved);
    s.base = null; s.draft = null; ensureApplications(s);
    expect(s.applications![1].resume).toEqual(saved);
  });
  it("backfills only the matching active resume for existing tracker entries", () => {
    const s = state(); s.draft!.baseHash = s.base!.hash;
    ensureApplications(s, now);
    delete s.applications![0].resume;
    s.applications![0].appliedAt = "2026-09-20";
    expect(ensureApplications(s, now)).toBe(true);
    expect(s.applications![0].resume!.source).toBe(s.base!.source);
    delete s.applications![0].resume; s.draft = null;
    expect(ensureApplications(s, now)).toBe(false);
    expect(s.applications![0].resume).toBeUndefined();
  });
  it("validates dates, bounded notes and safe job links", () => {
    for (const patch of [{ appliedAt: "2026-02-31" }, { jobUrl: "javascript:alert(1)" }, { jobUrl: "https://user:password@example.org" }, { notes: "a".repeat(10001) }]) {
      expect(applicationUpdateSchema.safeParse({ id: "draft-1", revision: 1, ...patch }).success).toBe(false);
    }
  });
  it("exports only submitted applications and escapes CSV formulas and quoting", () => {
    const s = state(); ensureApplications(s, now);
    expect(applicationsCsv(s)).not.toContain("Acme");
    updateApplication(s, { id: "draft-1", revision: 1, status: "applied", company: '=HYPERLINK("bad")', notes: 'Line 1\n"quote"' }, now);
    const csv = applicationsCsv(s); expect(csv).toContain('"\'=HYPERLINK(""bad"")"'); expect(csv).toContain('Line 1\n""quote""');
  });
});
