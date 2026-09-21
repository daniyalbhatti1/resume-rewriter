import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Install TeX Live locally; no sudo, shell profiles, or system paths are changed.
const tools = path.resolve(".tools");
mkdirSync(tools, { recursive: true });
const platform = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? `linux-${process.arch === "arm64" ? "arm64" : "x86_64"}` : null;
if (!platform) throw new Error("Install TeX Live manually and set TEX_BIN in .env.local on this platform.");
const root = path.join(tools, "TinyTeX");
if (!existsSync(path.join(root, "bin"))) {
  const archive = path.join(tools, "tinytex.tar.xz");
  execFileSync("curl", ["-fL", "--retry", "2", "--connect-timeout", "20", "--max-time", "300", `https://github.com/rstudio/tinytex-releases/releases/download/daily/TinyTeX-1-${platform}.tar.xz`, "-o", archive], { stdio: "inherit" });
  execFileSync("tar", ["-xf", archive, "-C", tools], { stdio: "inherit" });
}
const bin = path.join(root, "bin", readdirSync(path.join(root, "bin"))[0]);
execFileSync(path.join(bin, "tlmgr"), ["install", "preprint", "titlesec", "marvosym", "enumitem", "fancyhdr", "fontawesome5", "cm-super", "latexmk", "babel-english"], { stdio: "inherit" });
console.log(`LaTeX ready: ${bin}. Run npm run doctor to check your resume's packages.`);
