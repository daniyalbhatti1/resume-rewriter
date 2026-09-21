import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import { z } from "zod";
import { AppError, errorMessage } from "@/lib/errors";
import { dataDir, loadState, mutate, saveState } from "@/lib/store";
import { guardLocal, publicState } from "@/lib/api";
import { importResume } from "@/lib/import";
import { extractJob } from "@/lib/jobs";
import { compileBase, compileDraft, generateDraft } from "@/lib/pipeline";
import { applyChanges, hash } from "@/lib/latex";
import { applicationUpdateSchema, updateApplication, jobUrlSchema, applicationsCsv } from "@/lib/applications";
import { spanSchema } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const jobSchema = z.object({ url: jobUrlSchema.default(""), text: z.string().trim().min(100, "Paste at least 100 characters of the job description.").max(40_000), company: z.string().trim().max(150).default(""), role: z.string().trim().max(150).default("") });
const editSchema = z.object({ baseHash: z.string(), draftId: z.string(), revision: z.number().int(), edits: z.array(z.object({ blockId: z.string(), revert: z.boolean().default(false), spans: z.array(spanSchema).min(1).max(40) })).min(1).max(40) });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new AppError("Expected JSON input.");
  const text = await request.text();
  if (text.length > 200_000) throw new AppError("The request is too large.", 413);
  try { return JSON.parse(text); } catch { throw new AppError("Invalid JSON input."); }
}
function failure(error: unknown) {
  if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message || "Invalid input." }, 400);
  return json({ error: error instanceof AppError ? error.message : "The operation failed. Your saved resume has been preserved." }, error instanceof AppError ? error.status : 500);
}
export async function GET(request: Request, context: Context) {
  try {
    guardLocal(request); const route = (await context.params).path.join("/");
    const state = await loadState();
    if (route === "applications/export") return new Response(applicationsCsv(state), { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="applications.csv"', "Cache-Control": "no-store",
    } });
    if (route === "state") return json(await publicState(state));
    if (route.startsWith("artifacts/")) {
      const file = route.slice("artifacts/".length);
      if (!/^(base|draft)\.(pdf|tex)$/.test(file)) throw new AppError("File not found.", 404);
      const [kind, format] = file.split(".");
      if (!state.base) throw new AppError("Import a resume first.", 404);
      const draft = kind === "draft" ? state.draft : null;
      if (kind === "draft" && !draft) throw new AppError("No draft available.", 404);
      const url = new URL(request.url);
      if (draft && (url.searchParams.get("id") !== draft.id || Number(url.searchParams.get("revision")) !== draft.revision)) throw new AppError("The draft has changed. Refresh the preview.", 409);
      const source = draft ? applyChanges(state.base, draft.baseHash, draft.changes) : state.base.source;
      const compilation = draft ? draft.compilation : state.base.compilation;
      let bytes: Uint8Array;
      if (format === "tex") bytes = new TextEncoder().encode(source);
      else {
        if (!compilation || compilation.sourceHash !== hash(source) || (draft && compilation.revision !== draft.revision)) throw new AppError("Update the PDF to match the current draft.", 409);
        bytes = new Uint8Array(await readFile(nodePath.join(dataDir(), "artifacts", compilation.artifact)));
      }
      const name = draft ? [draft.company, draft.role, "resume"].filter(Boolean).join("-") : "base-resume";
      const filename = (name.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").slice(0, 140) || "resume") + "." + format;
      const disposition = url.searchParams.has("download") || format === "tex" ? "attachment" : "inline";
      return new Response(bytes as BodyInit, { headers: { "Content-Type": format === "pdf" ? "application/pdf" : "application/x-tex; charset=utf-8", "Content-Disposition": `${disposition}; filename="${filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    throw new AppError("Not found.", 404);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    guardLocal(request); const route = (await context.params).path.join("/");
    if (route === "job/extract") {
      const { url } = z.object({ url: z.string().max(4000) }).parse(await body(request));
      return json(await extractJob(url));
    }
    if (route === "resume") {
      if (Number(request.headers.get("content-length")) > 2_100_000) throw new AppError("The upload is too large.", 413);
      const form = await request.formData(); const file = form.get("file");
      if (!(file instanceof File)) throw new AppError("Choose a .tex or ZIP file.");
      if (file.size > 2_000_000) throw new AppError("Choose a file smaller than 2 MB.");
      await mutate(async () => {
        const base = await importResume(Buffer.from(await file.arrayBuffer()), file.name);
        const state = await loadState(); await saveState({ ...state, base, draft: null });
      });
      return json(await publicState(await loadState()));
    }
    if (route === "rewrite") {
      const job = jobSchema.parse(await body(request));
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          let connected = true;
          const send = (event: unknown) => { if (connected) try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); } catch { connected = false; } };
          void mutate(async () => {
            const state = await loadState();
            await generateDraft(state, job, { save: saveState, progress: message => send({ type: "progress", message }) });
          }).then(async () => send({ type: "result", state: await publicState(await loadState()) }))
            .catch(error => send({ type: "error", error: errorMessage(error) }))
            .finally(() => { if (connected) try { controller.close(); } catch { /* disconnected; work is saved */ } });
        },
      });
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (route === "compile") {
      const input = z.object({ target: z.enum(["base", "draft"]), draftId: z.string().optional(), revision: z.number().int().optional() }).parse(await body(request));
      await mutate(async () => {
        const state = await loadState();
        if (input.target === "base") await compileBase(state, { save: saveState });
        else {
          if (!state.draft || input.draftId !== state.draft.id || input.revision !== state.draft.revision) throw new AppError("The draft changed. Refresh before compiling.", 409);
          await compileDraft(state, { save: saveState });
        }
      });
      return json(await publicState(await loadState()));
    }
    throw new AppError("Not found.", 404);
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    guardLocal(request);
    const route = (await context.params).path.join("/");
    if (route === "applications") {
      const input = applicationUpdateSchema.parse(await body(request));
      await mutate(async () => {
        const state = await loadState(); updateApplication(state, input); await saveState(state);
      });
      return json(await publicState(await loadState()));
    }
    if (route !== "draft") throw new AppError("Not found.", 404);
    const input = editSchema.parse(await body(request));
    await mutate(async () => {
      const state = await loadState(), draft = state.draft, base = state.base;
      if (!draft || !base || draft.id !== input.draftId || draft.revision !== input.revision || base.hash !== input.baseHash) throw new AppError("The draft changed. Refresh before applying edits.", 409);
      if (new Set(input.edits.map(e => e.blockId)).size !== input.edits.length) throw new AppError("Duplicate block edits.");
      const changes = [...draft.changes];
      for (const edit of input.edits) {
        if (!base.blocks.some(b => b.id === edit.blockId)) throw new AppError("Unknown resume block.");
        const change = { blockId: edit.blockId, spans: edit.spans, reason: edit.revert ? "Restored original wording." : "Edited by you.", status: edit.revert ? "reverted" as const : "edited" as const };
        const index = changes.findIndex(c => c.blockId === edit.blockId);
        if (index < 0) changes.push(change); else changes[index] = change;
      }
      applyChanges(base, input.baseHash, changes); // validate before committing
      draft.changes = changes; draft.revision++; draft.status = "draft"; draft.compilation = undefined; draft.error = undefined;
      await saveState(state);
    });
    return json(await publicState(await loadState()));
  } catch (error) { return failure(error); }
}
