import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseResume } from "../lib/latex";
import { ensureApplications } from "../lib/applications";
import { GET, PATCH, POST } from "../app/api/[...path]/route";
import { loadState, saveState } from "../lib/store";
import type { AppState } from "../lib/types";
const source = String.raw`\documentclass{article}\begin{document}\section{Experience}\resumeItem{Built internal tools.}\end{document}`;
const context = (route: string) => ({ params: Promise.resolve({ path: route.split("/") }) });
const request = (route: string, input: unknown, origin = "http://localhost:3000") => new Request(`http://localhost:3000/api/${route}`, { method: "PATCH", headers: { "content-type": "application/json", origin }, body: JSON.stringify(input) });
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "resume-tracker-test-")); vi.stubEnv("RESUME_DATA_DIR", dir);
  const state: AppState = { base: parseResume(source, "example.tex"), draft: { id: "test-draft", baseHash: "test", revision: 1, company: "Example", role: "Engineer", jobText: "Sample description", changes: [], status: "draft", warnings: [] } };
  ensureApplications(state); await saveState(state);
});
afterAll(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
describe("tracker API persistence", () => {
  it("persists confirmation and rejects replay/stale updates", async () => {
    const input = { id: "test-draft", revision: 1, status: "applied" };
    expect((await PATCH(request("applications", input), context("applications"))).status).toBe(200);
    expect((await PATCH(request("applications", input), context("applications"))).status).toBe(409);
    const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    expect(state.applications).toHaveLength(1); expect(state.applications[0].status).toBe("applied");
  });
  it("keeps application records when importing a replacement resume", async () => {
    const before = (await loadState()).applications;
    const form = new FormData(); form.append("file", new File([source], "replacement.tex"));
    const response = await POST(new Request("http://localhost:3000/api/resume", { method: "POST", body: form }), context("resume"));
    expect(response.status).toBe(200); const next = await loadState();
    expect(next.draft).toBeNull(); expect(next.applications).toEqual(before);
    const csv = await GET(new Request("http://localhost:3000/api/applications/export"), context("applications/export"));
    expect(csv.headers.get("content-type")).toContain("text/csv"); expect(await csv.text()).toContain("Example");
  });
  it("rejects cross-site writes and invalid data without altering saved work", async () => {
    const before = await readFile(path.join(dir, "state.json"), "utf8");
    expect((await PATCH(request("applications", { id: "test-draft", revision: 2, notes: "attack" }, "https://evil.example"), context("applications"))).status).toBe(403);
    expect((await PATCH(request("applications", { id: "test-draft", revision: 2, jobUrl: "javascript:alert(1)" }), context("applications"))).status).toBe(400);
    expect(await readFile(path.join(dir, "state.json"), "utf8")).toBe(before);
  });
});
