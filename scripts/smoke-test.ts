import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { importResume } from "../lib/import";
import { applyChanges, hash } from "../lib/latex";
import { generateDraft, compileDraft } from "../lib/pipeline";
import type { RewriteAI } from "../lib/ai";
import type { AppState } from "../lib/types";

// Deterministic integration test: real template, real PDF compiler, controlled AI.
// This never calls OpenAI and never changes the user's active workspace state.
const qaDir = path.resolve(".data/qa-workspace");
process.env.RESUME_DATA_DIR = qaDir;
await mkdir(qaDir, { recursive: true });
const filename = "examples/sample-resume.tex";
const base = await importResume(await readFile(filename), "sample-resume.tex");
assert.equal(base.blocks.length, 3);
const originalHash = base.hash;
const bullet = base.blocks[0];
assert.ok(bullet);
const model: RewriteAI = {
  async rewrite() { return { company: "QA fixture", role: "Platform engineer", changes: [{ blockId: bullet.id, spans: [{ text: "Developed ", bold: false }, { text: "internal tools", bold: true }, { text: " with TypeScript and PostgreSQL to help colleagues review service requests.", bold: false }], reason: "Controlled test rewrite highlighting infrastructure experience." }] }; },
  async review() { return { reviews: [{ blockId: bullet.id, supported: true, reason: "Paraphrases this bullet's original facts." }] }; },
};
const state: AppState = { base, draft: null };
const save = async (s: AppState) => writeFile(path.join(qaDir, "state.json"), JSON.stringify(s), { mode: 0o600 });
await generateDraft(state, { company: "QA fixture", role: "Platform engineer", text: "Deterministic test job: support enterprise virtualization, maintain VMware vSphere clusters, administer hybrid cloud infrastructure, and deliver dependable cloud services." }, { ai: model, save });
assert.equal(state.draft!.status, "ready"); assert.equal(state.draft!.compilation!.pages, base.compilation!.pages);
const generated = applyChanges(base, state.draft!.baseHash, state.draft!.changes);
assert.notEqual(hash(generated), originalHash); assert.equal(hash(base.source), originalHash);
const first = structuredClone(state.draft!);
// Edit, invalidate, recompile, then restore the original exact source.
state.draft!.changes[0] = { ...state.draft!.changes[0], status: "edited", spans: [{ text: "Built TypeScript and PostgreSQL tools to help colleagues review service requests.", bold: false }] };
state.draft!.revision++; state.draft!.compilation = undefined; state.draft!.status = "draft";
await compileDraft(state, { ai: model, save });
assert.equal(state.draft!.status, "ready"); assert.equal(state.draft!.compilation!.revision, state.draft!.revision);
state.draft!.changes[0].status = "reverted"; state.draft!.revision++; state.draft!.compilation = undefined;
assert.equal(applyChanges(base, state.draft!.baseHash, state.draft!.changes), base.source);
await compileDraft(state, { save }); assert.equal(state.draft!.compilation!.sourceHash, originalHash);
// Keep a clearly named test draft only in the isolated QA workspace for browser QA.
state.draft = first; await save(state);
await writeFile(path.join(qaDir, "tailored-resume.tex"), generated, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, sourcePreserved: hash(base.source) === originalHash, originalPages: base.compilation!.pages, tailoredPages: first.compilation!.pages, draftRevision: first.revision, artifact: path.join(qaDir, "artifacts", first.compilation!.artifact) }, null, 2));
