import { ensureApplications } from "./applications";
import { randomUUID } from "node:crypto";
import { createAI, groundedChanges, type RewriteAI } from "./ai";
import { compileLatex } from "./compiler";
import { applyChanges } from "./latex";
import { AppError, errorMessage } from "./errors";
import type { AppState, Compilation, Draft } from "./types";

type Progress = (message: string) => void;
export type Dependencies = { ai?: RewriteAI; compile?: typeof compileLatex; save: (state: AppState) => Promise<void>; progress?: Progress };

export async function compileBase(state: AppState, deps: Dependencies) {
  if (!state.base) throw new AppError("Import a base resume first.");
  if (state.base.compilation?.sourceHash === state.base.hash) return state.base.compilation;
  deps.progress?.("Compiling your original resume…");
  state.base.compilation = await (deps.compile ?? compileLatex)(state.base.source, 0);
  await deps.save(state);
  return state.base.compilation;
}

export async function compileDraft(state: AppState, deps: Dependencies, autoShorten = false) {
  const base = state.base, draft = state.draft;
  if (!base || !draft) throw new AppError("Generate a draft first.");
  if (draft.baseHash !== base.hash) throw new AppError("This draft belongs to a different base resume.", 409);
  try {
    const baseline = await compileBase(state, deps);
    const compile = deps.compile ?? compileLatex;
    let result: Compilation | undefined;
    for (let pass = 0; pass <= 2; pass++) {
      deps.progress?.("Compiling your tailored PDF…");
      result = await compile(applyChanges(base, draft.baseHash, draft.changes), draft.revision);
      draft.compilation = result;
      if (result.pages <= baseline.pages) {
        draft.status = "ready"; draft.error = undefined;
        await deps.save(state); return draft;
      }
      draft.status = "overflow";
      draft.error = `This draft is ${result.pages} pages; your original is ${baseline.pages}. Shorten a bullet and update the PDF.`;
      await deps.save(state);
      if (!autoShorten || pass === 2) break;
      const current = draft.changes.filter(c => c.status === "rewritten");
      if (!current.length) break;
      deps.progress?.(`Shortening rewritten text to fit ${baseline.pages} ${baseline.pages === 1 ? "page" : "pages"} (pass ${pass + 1} of 2)…`);
      const ai = deps.ai ?? createAI();
      const response = await ai.rewrite(base, draft.jobText, current);
      const allowed = new Set(current.map(c => c.blockId));
      const filtered = response.changes.filter(c => allowed.has(c.blockId));
      const checked = await groundedChanges(base, filtered, ai);
      // Reject unsafe shortening without undoing an already verified rewrite.
      const safe = checked.filter(c => c.status === "rewritten");
      if (!safe.length) break;
      draft.changes = draft.changes.map(c => safe.find(s => s.blockId === c.blockId) ?? c);
      draft.revision++; draft.compilation = undefined; draft.status = "draft";
      await deps.save(state);
    }
    await deps.save(state); return draft;
  } catch (error) {
    draft.status = "error"; draft.error = errorMessage(error);
    await deps.save(state); return draft;
  }
}

export async function generateDraft(state: AppState, job: { text: string; company: string; role: string; url?: string }, deps: Dependencies): Promise<Draft> {
  if (!state.base) throw new AppError("Import a base resume first.");
  const ai = deps.ai ?? createAI();
  // Establish the baseline before paying for rewriting. Existing draft is preserved
  // until a complete, checked set of replacements is ready to save.
  await compileBase(state, deps);
  deps.progress?.("Tailoring your bullets to the role…");
  const response = await ai.rewrite(state.base, job.text);
  deps.progress?.("Checking every change against your original experience…");
  const changes = await groundedChanges(state.base, response.changes, ai);
  const draft: Draft = { id: randomUUID(), baseHash: state.base.hash, revision: 1, company: job.company || response.company.slice(0, 150),
    role: job.role || response.role.slice(0, 150), jobText: job.text, changes, status: "draft", warnings: [] };
  if (!changes.some(c => c.status === "rewritten")) draft.warnings.push("No supported changes were needed or available. This PDF retains your original wording.");
  ensureApplications(state);
  draft.jobUrl = job.url || "";
  state.draft = draft;
  ensureApplications(state);
  await deps.save(state);
  return compileDraft(state, { ...deps, ai }, true);
}
