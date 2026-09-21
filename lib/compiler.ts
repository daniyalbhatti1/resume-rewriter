import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PDFDocument } from "pdf-lib";
import { AppError } from "./errors";
import { dataDir } from "./store";
import { hash, maskComments } from "./latex";
import type { Compilation } from "./types";

export async function texBin(): Promise<string | null> {
  const bundled = path.join(process.cwd(), ".tools/TinyTeX/bin");
  let platforms: string[] = [];
  try { platforms = (await readdir(bundled)).map(p => path.join(bundled, p)); } catch { /* optional */ }
  const candidates = [process.env.TEX_BIN, ...platforms, "/Library/TeX/texbin", path.join(os.homedir(), "Library/TinyTeX/bin/universal-darwin"), ...(process.env.PATH ?? "").split(path.delimiter)].filter(Boolean) as string[];
  for (const bin of candidates) {
    try { await Promise.all(["pdflatex", "latexmk", "kpsewhich"].map(file => access(path.join(/* turbopackIgnore: true */ bin, file)))); return bin; } catch { /* try next */ }
  }
  return null;
}

export function runCommand(file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "", timedOut = false;
    const child = spawn(file, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    const kill = () => { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* already exited */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeout ?? 60_000);
    const consume = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-40_000); };
    child.stdout.on("data", consume); child.stderr.on("data", consume);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (timedOut) reject(new AppError("PDF compilation timed out. Check the LaTeX source for looping commands."));
      else if (code !== 0) reject(new AppError(`LaTeX could not compile this resume. ${compilerDetail(output)}`));
      else resolve(output);
    });
  });
}
function compilerDetail(output: string) {
  const lines = output.split("\n");
  const index = lines.findIndex(l => /(^!|LaTeX Error|Emergency stop|Undefined control sequence|:[0-9]+:)/.test(l));
  return (index >= 0 ? lines.slice(index, index + 8) : lines.slice(-12)).join("\n").slice(0, 1800);
}

export function requiredFiles(source: string): string[] {
  const clean = maskComments(source);
  const files = new Set<string>();
  for (const match of clean.matchAll(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    for (const pkg of match[1].split(",")) files.add(`${pkg.trim()}.sty`);
  }
  for (const match of clean.matchAll(/\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/g)) files.add(`${match[1]}.cls`);
  for (const match of clean.matchAll(/\\usepackage\[([^\]]+)\]\{babel\}/g)) {
    for (const option of match[1].split(",")) if (/^[a-z]+$/i.test(option.trim())) files.add(`${option.trim()}.ldf`);
  }
  // glyphtounicode is distributed with TeX Live, not a missing project attachment.
  for (const match of clean.matchAll(/\\input\{([^}]+)\}/g)) files.add(match[1].endsWith(".tex") ? match[1] : `${match[1]}.tex`);
  return [...files];
}

export async function compilerSetup(source?: string) {
  const bin = await texBin();
  if (!bin) return { latex: false, missingPackages: [] as string[] };
  const missingPackages: string[] = [];
  if (source) for (const file of requiredFiles(source)) {
    try { await runCommand(path.join(bin, "kpsewhich"), [file], { timeout: 5000 }); }
    catch { missingPackages.push(file); }
  }
  return { latex: true, missingPackages };
}

export async function compileLatex(source: string, revision: number): Promise<Compilation> {
  const bin = await texBin();
  if (!bin) throw new AppError("A LaTeX compiler is required. Run npm run setup:latex, or install TeX Live and set TEX_BIN in .env.local.", 503);
  const root = path.join(dataDir(), "builds");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(path.join(root, "resume-"));
  try {
    await writeFile(path.join(dir, "main.tex"), source, { mode: 0o600 });
    // Deliberately exclude OPENAI_API_KEY and the caller's other environment secrets.
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", PATH: `${bin}${path.delimiter}/usr/bin:/bin:/usr/sbin:/sbin`, HOME: dir, TMPDIR: dir,
      LANG: "en_US.UTF-8", openin_any: "p", openout_any: "p", shell_escape: "f", TEXMFOUTPUT: dir, TEXMFVAR: path.join(dir, "texmf-var"), TEXMFCONFIG: path.join(dir, "texmf-config") };
    const log = await runCommand(path.join(bin, "latexmk"), ["-norc", "-pdf", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", "main.tex"], { cwd: dir, env, timeout: 60_000 });
    const pdf = await readFile(path.join(dir, "main.pdf"));
    const pages = (await PDFDocument.load(pdf)).getPageCount();
    const sourceHash = hash(source), artifact = `${sourceHash}.pdf`;
    const target = path.join(dataDir(), "artifacts");
    await mkdir(target, { recursive: true, mode: 0o700 });
    await writeFile(path.join(target, artifact), pdf, { mode: 0o600 });
    const warnings = [...new Set(log.split("\n").filter(l => /Overfull \\[hv]box/.test(l)))].slice(0, 8);
    return { sourceHash, revision, pages, artifact, warnings };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
