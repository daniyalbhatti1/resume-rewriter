import JSZip from "jszip";
import { AppError } from "./errors";
import { normalizeTemplate, parseResume } from "./latex";

export async function importResume(data: Buffer, filename: string) {
  if (data.length > 2_000_000) throw new AppError("Choose a .tex or ZIP file smaller than 2 MB.");
  let source: Buffer;
  if (/\.tex$/i.test(filename)) source = data;
  else if (/\.zip$/i.test(filename)) {
    let zip: JSZip;
    try { zip = await JSZip.loadAsync(data, { checkCRC32: false }); }
    catch { throw new AppError("That ZIP could not be opened. Export your resume project again."); }
    const files = Object.values(zip.files);
    if (files.length > 100) throw new AppError("This ZIP contains too many files. Import your single-file resume.");
    for (const f of files) {
      const unsafe = (f as unknown as { unsafeOriginalName?: string }).unsafeOriginalName ?? f.name;
      if (unsafe.split(/[\\/]/).includes("..") || /^(?:[\\/]|[A-Za-z]:)/.test(unsafe) || /\\/.test(unsafe)) throw new AppError("The ZIP contains an unsafe file path.");
    }
    const tex = files.filter(f => !f.dir && /\.tex$/i.test(f.name) && !f.name.startsWith("__MACOSX/"));
    if (tex.length !== 1) throw new AppError("Import a ZIP containing exactly one self-contained .tex file. Multi-file projects are not supported yet.");
    const selected = tex[0];
    const size = (selected as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (size === undefined || size > 256_000) throw new AppError("The uncompressed LaTeX file must be smaller than 256 KB.");
    source = await selected.async("nodebuffer");
  } else throw new AppError("Choose a .tex file or a LaTeX project ZIP.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(source); }
  catch { throw new AppError("Save the LaTeX file as UTF-8 before importing it."); }
  const normalized = normalizeTemplate(text);
  const base = parseResume(normalized.source, filename.replace(/[\\/]/g, "_").slice(0, 150));
  base.importNotes = normalized.notes;
  return base;
}
