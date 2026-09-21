import { afterEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { createAI, groundedChanges, type RewriteAI } from "../lib/ai";
import { generateDraft, compileDraft } from "../lib/pipeline";
import { hash, parseResume } from "../lib/latex";
import type { AppState, Change, Compilation } from "../lib/types";
const base = () => parseResume(String.raw`\documentclass{article}\begin{document}PRIVATE name@example.com\section{Experience}\resumeSubheading{Engineer}{2025}{Example}{Remote}\resumeItem{Built cloud tools that reduced processing time by 16\%.}\end{document}`, "main.tex");
const candidate = { blockId: "bullet-1", spans: [{ text: "Reduced processing time by 16% with cloud tools.", bold: false }], reason: "Emphasizes impact." };
function ai(): RewriteAI { return { rewrite: vi.fn().mockResolvedValue({ company: "Example", role: "Engineer", changes: [candidate] }), review: vi.fn().mockResolvedValue({ reviews: [{ blockId: "bullet-1", supported: true, reason: "Supported" }] }) }; }
const compilation = (source: string, revision: number, pages = 1): Compilation => ({ sourceHash: hash(source), revision, pages, artifact: `${hash(source)}.pdf`, warnings: [] });
const job = { text: "A job seeking cloud engineering experience and reliable tools.", company: "", role: "" };
afterEach(() => vi.unstubAllEnvs());

describe("grounding and privacy", () => {
  it("rejects novel numbers before factual review", async () => { const model = ai(); const changes = await groundedChanges(base(), [{ ...candidate, spans: [{ text: "Reduced time by 90%.", bold: false }] }], model); expect(changes[0].status).toBe("flagged"); expect(model.review).not.toHaveBeenCalled(); });
  it("retains originals when semantic review rejects or omits a claim", async () => {
    const model = ai(); vi.mocked(model.review).mockResolvedValueOnce({ reviews: [{ blockId: "bullet-1", supported: false, reason: "Unstated AWS experience" }] }).mockResolvedValueOnce({ reviews: [] });
    for (let i = 0; i < 2; i++) expect((await groundedChanges(base(), [candidate], model))[0].status).toBe("flagged");
  });
  it("accepts supported rewrites and rejects invalid IDs", async () => {
    expect((await groundedChanges(base(), [candidate], ai()))[0].status).toBe("rewritten");
    await expect(groundedChanges(base(), [{ ...candidate, blockId: "unknown" }], ai())).rejects.toThrow(/invalid block/);
  });
  it("sends only selected experience, without header/contact/source data", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { company: "Example", role: "Engineer", changes: [candidate] } });
    const model = createAI({ responses: { parse } } as unknown as OpenAI);
    await model.rewrite(base(), "Public job text");
    const payload = parse.mock.calls[0][0]; expect(payload.store).toBe(false);
    expect(payload.input).not.toContain("name@example.com"); expect(payload.input).not.toContain("PRIVATE"); expect(payload.input).not.toContain("documentclass");
  });
  it("handles missing credentials clearly", () => { vi.stubEnv("OPENAI_API_KEY", ""); expect(() => createAI()).toThrow(/OPENAI_API_KEY/); });
});
describe("draft pipeline", () => {
  it("builds from the immutable base each time", async () => {
    const state: AppState = { base: base(), draft: null }, model = ai(), save = vi.fn().mockResolvedValue(undefined);
    const compile = vi.fn(async (s: string, r: number) => compilation(s, r));
    await generateDraft(state, job, { ai: model, compile, save });
    const firstId = state.draft!.id; state.draft!.changes[0].spans[0].text = "Manual prior draft";
    await generateDraft(state, job, { ai: model, compile, save });
    expect(state.draft!.id).not.toBe(firstId); expect(state.draft!.status).toBe("ready");
    for (const call of vi.mocked(model.rewrite).mock.calls) expect(call[0].source).toBe(base().source);
  });
  it("preserves the previous draft when AI fails", async () => {
    const state: AppState = { base: base(), draft: null }, model = ai(); const deps = { ai: model, compile: async (s: string, r: number) => compilation(s, r), save: vi.fn().mockResolvedValue(undefined) };
    await generateDraft(state, job, deps); const original = JSON.stringify(state.draft);
    vi.mocked(model.rewrite).mockRejectedValueOnce(new Error("API unavailable"));
    await expect(generateDraft(state, job, deps)).rejects.toThrow("API unavailable"); expect(JSON.stringify(state.draft)).toBe(original);
  });
  it("saves an editable draft when PDF compilation fails", async () => {
    const state: AppState = { base: base(), draft: null }; const compile = vi.fn().mockImplementationOnce(async (s, r) => compilation(s, r)).mockRejectedValue(new Error("Missing font"));
    await generateDraft(state, job, { ai: ai(), compile, save: vi.fn().mockResolvedValue(undefined) });
    expect(state.draft!.changes).toHaveLength(1); expect(state.draft!.status).toBe("error"); expect(state.draft!.error).toContain("Missing font");
  });
  it("limits automatic shortening to two passes and marks unresolved overflow", async () => {
    const state: AppState = { base: base(), draft: null }, model = ai();
    const compile = vi.fn(async (s: string, r: number) => compilation(s, r, r === 0 ? 1 : 2));
    await generateDraft(state, job, { ai: model, compile, save: vi.fn().mockResolvedValue(undefined) });
    expect(model.rewrite).toHaveBeenCalledTimes(3); expect(compile).toHaveBeenCalledTimes(4); expect(state.draft!.status).toBe("overflow"); expect(state.draft!.revision).toBe(3);
  });
  it("does not invoke AI or alter manual edits during recompilation", async () => {
    const state: AppState = { base: base(), draft: null }, model = ai(), deps = { ai: model, compile: async (s: string, r: number) => compilation(s, r), save: vi.fn().mockResolvedValue(undefined) };
    await generateDraft(state, job, deps); state.draft!.changes[0].status = "edited"; const before = JSON.stringify(state.draft!.changes); vi.mocked(model.rewrite).mockClear();
    await compileDraft(state, { ...deps, compile: async (s, r) => compilation(s, r, 2) });
    expect(model.rewrite).not.toHaveBeenCalled(); expect(JSON.stringify(state.draft!.changes)).toBe(before); expect(state.draft!.status).toBe("overflow");
  });
});
