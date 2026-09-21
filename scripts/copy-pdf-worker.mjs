import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import path from "node:path";
const root = path.resolve("node_modules/pdfjs-dist");
mkdirSync("public", { recursive: true });
copyFileSync(path.join(root, "build/pdf.worker.min.mjs"), "public/pdf.worker.min.mjs");
cpSync(path.join(root, "standard_fonts"), "public/pdfjs-fonts", { recursive: true });
