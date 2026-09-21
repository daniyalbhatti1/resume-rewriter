import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import JSZip from "jszip";
import { addedNumbers, applyChanges, escapeLatex, latexToText, maskComments, normalizeTemplate, parseResume } from "../lib/latex";
import { importResume } from "../lib/import";
import type { Change } from "../lib/types";

export const source = String.raw`\documentclass{article}
\newcommand{\resumeItem}[1]{\item #1}
\begin{document}
PRIVATE CONTACT header@example.test
\section{Experience}
\resumeSubheading{Developer}{2025}{Acme}{Remote}
% \resumeItem{Commented out confidential text}
\resumeItem{Built \textbf{cloud {tools}} in C\# \& reduced time by 16\%.}
\section{Projects}
\resumeProjectHeading{Widget}{2026}
\resumeItem{Wrote 148 tests for a TypeScript app.}
\section{Technical Skills}
\textbf{Languages}: TypeScript, C\#
\end{document}`;
export const makeBase = () => parseResume(source, "main.tex");
const change = (id = "bullet-1"): Change => ({ blockId: id, spans: [{ text: "Built C# & cloud tools; reduced time by 16%.", bold: false }], reason: "Rephrased", status: "rewritten" });

describe("LaTeX preservation", () => {
  it("repairs only invalid section underline placement, idempotently", () => {
    const invalid = String.raw`\titleformat{\section}{\vspace{-4pt}\large\bfseries\underline}{}{0em}{}[]`;
    const result = normalizeTemplate(invalid);
    expect(result.source).toBe(String.raw`\titleformat{\section}{\vspace{-4pt}\large\bfseries}{}{0em}{\underline}[]`);
    expect(result.notes).toHaveLength(1); expect(normalizeTemplate(result.source).source).toBe(result.source);
    expect(normalizeTemplate(source).source).toBe(source);
  });
  it("ignores macro definitions/comments and extracts role context", () => {
    const base = makeBase(); expect(base.blocks).toHaveLength(2);
    expect(base.blocks[0].context).toBe("Developer — Acme (2025)");
    expect(base.blocks[0].originalText).toBe("Built cloud tools in C# & reduced time by 16%.");
    expect(base.skills).toContain("TypeScript");
  });
  it("round-trips untouched source byte for byte", () => { const b = makeBase(); expect(applyChanges(b, b.hash, [])).toBe(source); });
  it("changes only argument content and reverts byte for byte", () => {
    const b = makeBase(), block = b.blocks[0], result = applyChanges(b, b.hash, [change()]);
    expect(result.startsWith(source.slice(0, block.start))).toBe(true);
    expect(result.endsWith(source.slice(block.end))).toBe(true);
    expect(result).toContain("C\\# \\& cloud");
    expect(applyChanges(b, b.hash, [{ ...change(), status: "reverted" }])).toBe(source);
    expect(applyChanges(b, b.hash, [{ ...change(), status: "flagged" }])).toBe(source);
  });
  it("handles escaped percents and real comments without shifting offsets", () => {
    const input = String.raw`a\% value % ignore
b\\%comment
c`;
    const masked = maskComments(input); expect(masked.length).toBe(input.length);
    expect(masked).toContain(String.raw`a\% value`); expect(masked).not.toContain("ignore"); expect(masked).not.toContain("comment");
  });
  it("preserves literal special characters and Unicode", () => {
    const text = "C# & 16% {x} $ _ ~ ^ \\ WSSC’s work";
    expect(latexToText(escapeLatex(text))).toBe(text);
  });
  it("rejects stale source hashes, unknown/duplicate blocks, empty replacements", () => {
    const b = makeBase(); expect(() => applyChanges(b, "stale", [change()])).toThrow(/different base/);
    expect(() => applyChanges(b, b.hash, [change("bad")])).toThrow(/Invalid/);
    expect(() => applyChanges(b, b.hash, [change(), change()])).toThrow(/duplicate/);
    expect(() => applyChanges(b, b.hash, [{ ...change(), spans: [] }])).toThrow(/empty/);
  });
  it("supports an existing summary and leaves surrounding layout unchanged", () => {
    const s = source.replace("\\section{Experience}", "\\section*{Summary}\n\\vspace{-4pt}\nBuilds \\textbf{useful software}.\n\\vspace{-8pt}\n\\section{Experience}");
    const b = parseResume(s, "resume.tex"), summary = b.blocks.find(b => b.kind === "summary")!;
    expect(summary.originalText).toBe("Builds useful software.");
    const result = applyChanges(b, b.hash, [{ ...change(summary.id), spans: [{ text: "Builds dependable software.", bold: false }] }]);
    expect(result).toContain("\\vspace{-4pt}\nBuilds dependable software.\n\\vspace{-8pt}");
  });
  it("does not introduce a summary", () => { expect(makeBase().blocks.some(b => b.kind === "summary")).toBe(false); });
  it("detects changed percentages, magnitudes and plus qualifiers", () => {
    expect(addedNumbers("16% for 30+ users and 148 tests", "16% for 30+ users")).toEqual([]);
    expect(addedNumbers("16% for 30 users", "60% for 300 users")).toEqual(["60%", "300"]);
  });
  it.skipIf(!process.env.PRIVATE_RESUME_FIXTURE || !existsSync(process.env.PRIVATE_RESUME_FIXTURE))("extracts exactly 10 experience and 4 project bullets from the supplied resume", async () => {
    const base = await importResume(readFileSync(process.env.PRIVATE_RESUME_FIXTURE!), "resume.zip");
    expect(base.blocks.filter(b => b.section === "Experience")).toHaveLength(10);
    expect(base.blocks.filter(b => b.section === "Projects")).toHaveLength(4);
    expect(base.blocks.map(b => b.originalText).join(" ")).not.toContain("Relevant Coursework");
  });
});
describe("imports", () => {
  it("supports .tex and single-file ZIP", async () => {
    expect((await importResume(Buffer.from(source), "resume.tex")).blocks).toHaveLength(2);
    const data = await new JSZip().file("folder/main.tex", source).generateAsync({ type: "nodebuffer" });
    expect((await importResume(data, "resume.zip")).blocks).toHaveLength(2);
  });
  it("rejects invalid archives and multi-file projects", async () => {
    await expect(importResume(Buffer.from("bad"), "bad.zip")).rejects.toThrow(/ZIP/);
    const zip = new JSZip().file("main.tex", source).file("extra.tex", source);
    await expect(importResume(await zip.generateAsync({ type: "nodebuffer" }), "multi.zip")).rejects.toThrow(/exactly one/);
  });
  it("rejects zip traversal and oversized decompressed source", async () => {
    const zip = new JSZip().file("../main.tex", source);
    await expect(importResume(await zip.generateAsync({ type: "nodebuffer" }), "bad.zip")).rejects.toThrow(/unsafe/);
    const large = new JSZip().file("main.tex", "a".repeat(256001));
    await expect(importResume(await large.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), "large.zip")).rejects.toThrow(/256 KB/);
  });
});
