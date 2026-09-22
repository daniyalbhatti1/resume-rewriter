import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppState } from "./types";
import { importResume } from "./import";
import { ensureApplications } from "./applications";
import { AppError } from "./errors";

export const dataDir = () => path.resolve(/* turbopackIgnore: true */ process.env.RESUME_DATA_DIR || path.join(process.cwd(), ".data"));
const shared = globalThis as typeof globalThis & { resumeBusy?: boolean; resumeInit?: Promise<void> };
export const isBusy = () => !!shared.resumeBusy;
export async function mutate<T>(fn: () => Promise<T>): Promise<T> {
  if (shared.resumeBusy) throw new AppError("Another operation is still running. Please wait for it to finish.", 409);
  shared.resumeBusy = true;
  try { return await fn(); } finally { shared.resumeBusy = false; }
}
export async function saveState(state: AppState) {
  ensureApplications(state);
  await mkdir(dataDir(), { recursive: true, mode: 0o700 });
  const temp = path.join(dataDir(), `${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
  await rename(temp, path.join(dataDir(), "state.json"));
}
async function initialize() {
  try {
    const state: AppState = JSON.parse(await readFile(path.join(dataDir(), "state.json"), "utf8"));
    if (ensureApplications(state)) await saveState(state);
    return;
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let base = null;
  const filename = process.env.INITIAL_RESUME_PATH;
  try { if (filename) base = await importResume(await readFile(path.resolve(filename)), path.basename(filename)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await saveState({ base, draft: null });
}
export async function loadState(): Promise<AppState> {
  shared.resumeInit ??= initialize().catch(error => { shared.resumeInit = undefined; throw error; });
  await shared.resumeInit;
  const state: AppState = JSON.parse(await readFile(path.join(dataDir(), "state.json"), "utf8"));
  return state;
}
