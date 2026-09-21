import { z } from "zod";
import { AppError } from "./errors";
import type { AppState, Application } from "./types";

export const jobUrlSchema = z.string().trim().max(4000).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, "Use an HTTP or HTTPS job link without embedded credentials.");
export const applicationUpdateSchema = z.object({
  id: z.string().min(1), revision: z.number().int().min(1),
  status: z.enum(["pending", "not_applied", "applied", "interview", "offer", "rejected", "withdrawn"]).optional(),
  company: z.string().trim().min(1).max(150).optional(),
  role: z.string().trim().min(1).max(150).optional(),
  jobUrl: jobUrlSchema.optional(), notes: z.string().max(10000).optional(),
  appliedAt: z.string().date().nullable().optional(),
}).strict();
export type ApplicationUpdate = z.infer<typeof applicationUpdateSchema>;

// Existing workspaces gain a follow-up for their active draft, without assuming
// that generation or downloading means an application was actually submitted.
export function ensureApplications(state: AppState, now = new Date().toISOString()): boolean {
  let changed = false;
  if (!state.applications) { state.applications = []; changed = true; }
  const draft = state.draft;
  if (draft && !state.applications.some(a => a.draftId === draft.id)) {
    state.applications.unshift({ id: draft.id, draftId: draft.id, baseHash: draft.baseHash, revision: 1,
      company: draft.company, role: draft.role, jobUrl: draft.jobUrl || "", jobText: draft.jobText,
      status: "pending", createdAt: now, updatedAt: now, appliedAt: null, notes: "" });
    changed = true;
  }
  return changed;
}
export function updateApplication(state: AppState, input: ApplicationUpdate, now = new Date().toISOString()): Application {
  const entry = state.applications?.find(a => a.id === input.id);
  if (!entry) throw new AppError("This application could not be found. Refresh the tracker.", 404);
  if (entry.revision !== input.revision) throw new AppError("This application changed in another window. Refresh before saving.", 409);
  const { id: _id, revision: _revision, ...fields } = input;
  const next = { ...entry, ...fields, revision: entry.revision + 1, updatedAt: now };
  const submitted = !["pending", "not_applied"].includes(next.status);
  if (!submitted) next.appliedAt = null;
  else {
    next.appliedAt = input.appliedAt ?? entry.appliedAt ?? now.slice(0, 10);
    // Allow the local calendar date in time zones ahead of UTC.
    const latestLocalDate = new Date(Date.parse(now) + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (next.appliedAt > latestLocalDate) throw new AppError("The application date cannot be in the future.");
  }
  Object.assign(entry, next);
  return entry;
}
export function applicationsCsv(state: AppState): string {
  // Neutralize spreadsheet formulas, including values preceded by whitespace.
  const cell = (value: string) => '"' + (/^[\s]*[=+@-]/.test(value) ? "'" : "") + value.replaceAll('"', '""') + '"';
  const rows = [["Company", "Role", "Status", "Applied", "Job URL", "Notes"],
    ...(state.applications ?? []).filter(a => a.appliedAt).map(a => [a.company, a.role, a.status, a.appliedAt!, a.jobUrl, a.notes])];
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
