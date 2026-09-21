import { createHash } from "node:crypto";
import { AppError } from "./errors";
import type { BaseResume, Change, ResumeBlock, Span } from "./types";

export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

// Repair this template family's invalid use of \underline as a font switch.
// The underline belongs in titlesec's before-code argument. This preserves the
// intended heading appearance and leaves the user's uploaded file untouched.
export function normalizeTemplate(source: string): { source: string; notes: string[] } {
  const masked = maskComments(source), token = /\\titleformat\s*/g;
  const edits: { start: number; end: number; text: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = token.exec(masked))) {
    if (masked[token.lastIndex] !== "{") continue;
    let cursor = token.lastIndex; const args = [];
    for (let i = 0; i < 5; i++) {
      while (/\s/.test(masked[cursor] ?? "") && cursor < masked.length) cursor++;
      if (masked[cursor] !== "{") break;
      const arg = groupAt(masked, cursor); args.push(arg); cursor = arg.next;
    }
    token.lastIndex = cursor;
    if (args.length !== 5 || masked.slice(args[0].start, args[0].end).trim() !== "\\section") continue;
    const format = masked.slice(args[1].start, args[1].end);
    const underline = /\\underline\s*$/.exec(format);
    if (!underline || masked.slice(args[4].start, args[4].end).trim()) continue;
    edits.push({ start: args[1].start + underline.index, end: args[1].start + underline.index + "\\underline".length, text: "" });
    edits.push({ start: args[4].start, end: args[4].end, text: "\\underline" });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return { source, notes: edits.length ? ["Corrected section underline placement for pdfLaTeX compatibility. Fonts, margins, and underlined headings are preserved; your uploaded file is unchanged."] : [] };
}

// Mask comments without changing offsets. A percent is escaped only after an odd
// number of consecutive backslashes; \\% starts a comment while \% does not.
export function maskComments(source: string): string {
  return source.replace(/%[^\r\n]*/g, (match, offset: number) => {
    let slashes = 0;
    for (let i = offset - 1; source[i] === "\\"; i--) slashes++;
    if (slashes % 2) {
      // The regexp consumed the rest of the line: handle subsequent real comments.
      return "%" + maskComments(match.slice(1));
    }
    return " ".repeat(match.length);
  });
}

export function groupAt(source: string, opening: number): { start: number; end: number; next: number } {
  if (source[opening] !== "{") throw new AppError("Unsupported LaTeX: expected a braced argument.");
  let depth = 1;
  for (let i = opening + 1; i < source.length; i++) {
    if (source[i] === "\\") {
      if (/[^a-zA-Z@]/.test(source[i + 1] ?? "")) i++;
      continue;
    }
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return { start: opening + 1, end: i, next: i + 1 };
  }
  throw new AppError("The LaTeX source has an unclosed brace.");
}

export function latexToText(latex: string): string {
  const s = maskComments(latex);
  let result = "";
  for (let i = 0; i < s.length;) {
    if (s[i] !== "\\") { result += "{}$".includes(s[i]) ? "" : s[i] === "~" ? " " : s[i]; i++; continue; }
    const command = /^\\([a-zA-Z@]+|[^a-zA-Z@])/.exec(s.slice(i));
    if (!command) { i++; continue; }
    const name = command[1]; i += command[0].length;
    if ("%&#_{}$".includes(name)) { result += name; continue; }
    if (name === "\\" || name === " ") { result += " "; continue; }
    if (name === "textbackslash") { result += "\\"; continue; }
    if (name === "textasciitilde") { result += "~"; continue; }
    if (name === "textasciicircum") { result += "^"; continue; }
    while (/\s/.test(s[i] ?? "") && i < s.length) i++;
    if (s[i] === "{") {
      const g = groupAt(s, i); i = g.next;
      if (["vspace", "hspace", "label", "input", "include"].includes(name)) continue;
      if (name === "href") {
        while (/\s/.test(s[i] ?? "") && i < s.length) i++;
        if (s[i] === "{") { const text = groupAt(s, i); result += latexToText(s.slice(text.start, text.end)); i = text.next; }
      } else result += latexToText(s.slice(g.start, g.end));
    }
  }
  return result.replace(/---/g, "—").replace(/--/g, "–").replace(/\s+/g, " ").trim();
}

export function parseResume(source: string, filename: string): BaseResume {
  if (!source.trim() || Buffer.byteLength(source) > 256_000) throw new AppError("Choose a LaTeX file smaller than 256 KB.");
  const masked = maskComments(source);
  const begin = masked.indexOf("\\begin{document}");
  const end = masked.lastIndexOf("\\end{document}");
  if (begin < 0 || end <= begin) throw new AppError("The file must be a complete LaTeX document with begin/end document.");
  const bodyStart = begin + "\\begin{document}".length;
  const tokens = /\\(section\*?|resumeSubheading|resumeProjectHeading|resumeItem)(?![a-zA-Z@])\s*/g;
  tokens.lastIndex = bodyStart;
  let section = "", context = "", ordinal = 0;
  const blocks: ResumeBlock[] = [];
  const sections: { name: string; start: number; end: number }[] = [];
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(masked)) && token.index < end) {
    const name = token[1];
    if (masked[tokens.lastIndex] !== "{") continue;
    const args = [];
    let cursor = tokens.lastIndex;
    const count = name === "resumeSubheading" ? 4 : name === "resumeProjectHeading" ? 2 : 1;
    for (let n = 0; n < count; n++) {
      while (/\s/.test(masked[cursor] ?? "") && cursor < end) cursor++;
      const arg = groupAt(masked, cursor); args.push(arg); cursor = arg.next;
    }
    tokens.lastIndex = cursor;
    const contents = args.map(a => latexToText(source.slice(a.start, a.end)));
    if (name.startsWith("section")) {
      if (sections.length) sections[sections.length - 1].end = token.index;
      section = contents[0]; context = ""; sections.push({ name: section, start: cursor, end });
    } else if (name === "resumeSubheading") context = `${contents[0]} — ${contents[2]} (${contents[1]})`;
    else if (name === "resumeProjectHeading") context = contents[0];
    else if (/^(experience|work experience|professional experience|projects|personal projects)$/i.test(section)) {
      const a = args[0];
      blocks.push({ id: `bullet-${++ordinal}`, kind: "bullet", section, context, start: a.start, end: a.end,
        originalLatex: source.slice(a.start, a.end), originalText: contents[0] });
    }
  }
  for (const s of sections.filter(s => /^(summary|professional summary|profile)$/i.test(s.name))) {
    // Support plain summary paragraphs and simple text formatting. Keep surrounding
    // spacing commands outside the editable range; never consume the next section.
    const region = masked.slice(s.start, s.end);
    const first = /^(?:\s|\\vspace\*?\{[^}]*\})*/.exec(region)![0].length;
    const trailing = /(?:\s|\\vspace\*?\{[^}]*\})*$/.exec(region)![0].length;
    const start = s.start + first, finish = s.end - trailing;
    if (finish <= start) continue;
    const originalLatex = source.slice(start, finish);
    if (/\\(?:begin|end|item|input|newcommand)\b/.test(maskComments(originalLatex))) throw new AppError("The summary uses an unsupported layout. Use a plain paragraph with text formatting.");
    blocks.push({ id: "summary-1", kind: "summary", section: s.name, context: "Professional summary", start, end: finish,
      originalLatex, originalText: latexToText(originalLatex) });
  }
  blocks.sort((a, b) => a.start - b.start);
  if (!blocks.length) throw new AppError("No editable bullets found. This version supports resumeItem bullets in Experience and Projects sections.");
  const skills = sections.filter(s => /skills/i.test(s.name)).map(s => latexToText(source.slice(s.start, s.end))).join("\n");
  return { hash: hash(source), filename, source, blocks, skills };
}

export function escapeLatex(text: string): string {
  const special: Record<string, string> = { "\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", "$": "\\$", "#": "\\#", "_": "\\_", "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" };
  return text.replace(/[\\&%$#_{}~^]/g, c => special[c]).replace(/\r?\n/g, " ");
}
export const spanText = (spans: Span[]) => spans.map(s => s.text).join("");
export function renderSpans(spans: Span[]): string {
  return spans.map(s => s.bold && s.text ? `\\textbf{${escapeLatex(s.text)}}` : escapeLatex(s.text)).join("");
}
export function applyChanges(base: BaseResume, baseHash: string, changes: Change[]): string {
  if (base.hash !== baseHash) throw new AppError("This draft belongs to a different base resume. Generate a new draft.", 409);
  const seen = new Set<string>();
  for (const c of changes) {
    if (seen.has(c.blockId) || !base.blocks.some(b => b.id === c.blockId)) throw new AppError("Invalid or duplicate resume block.");
    seen.add(c.blockId);
  }
  let source = base.source;
  for (const block of [...base.blocks].sort((a, b) => b.start - a.start)) {
    const change = changes.find(c => c.blockId === block.id);
    if (!change || change.status === "reverted" || change.status === "flagged") continue;
    if (!spanText(change.spans).trim()) throw new AppError("Resume bullets cannot be empty.");
    source = source.slice(0, block.start) + renderSpans(change.spans) + source.slice(block.end);
  }
  return source;
}

export function addedNumbers(original: string, revised: string): string[] {
  const numbers = (s: string) => s.match(/\d+(?:[,.]\d+)*(?:\+|%|\b)/g) ?? [];
  const allowed = new Set(numbers(original));
  return numbers(revised).filter(n => !allowed.has(n));
}
