# Resume Rewriter

A local Next.js app that tailors the bullets in a LaTeX resume to a pasted job description or public job URL, then produces a PDF and matching LaTeX source. Each rewrite begins with the saved base, and every change can be edited or reverted. After tailoring, confirm whether you applied and follow the job through interviews, offers, or other outcomes in a local application tracker.

## Run locally

Requires Node.js 22.13+ and npm, your own OpenAI API key, and a pdfLaTeX installation. The automated compiler installer supports macOS and Linux; use WSL on Windows.

Clone this repository and open its folder first:

```sh
git clone https://github.com/daniyalbhatti1/resume-rewriter.git
cd resume-rewriter
npm ci
# On a fresh clone:
cp .env.example .env.local
# Set OPENAI_API_KEY in .env.local. Keep the key out of source control.
npm run setup:latex
npm run doctor
npm run dev
```

Open [the local workspace](http://127.0.0.1:3000). `npm run setup:latex` installs a small TeX Live distribution (TinyTeX) under `.tools/` and the packages used by common resume templates. It does not need administrator privileges or change shell profiles. If you already have TeX Live or MacTeX, set `TEX_BIN` to the directory containing `latexmk`, `pdflatex`, and `kpsewhich` instead.

`npm run doctor` reports whether the key is present, the compiler path, missing direct template packages, and the current base resume. A missing API key does not prevent importing or previewing the base PDF. OpenAI usage is billed through your API account. The default model is `gpt-5-mini`; change `OPENAI_MODEL` to a Responses/Structured Outputs-compatible model if needed. Restart the production server after environment changes.

For a production local server:

```sh
npm run build
npm start
```

Both development and production bind to `127.0.0.1`. This is a single-user local application, not a hosted multi-user service.

## Using the app

1. Import your own `.tex` file or single-file ZIP. To try the workflow first, import [the fictional sample](examples/sample-resume.tex). Replacing the base clears the current draft and preserves your application tracker. Optional `INITIAL_RESUME_PATH` imports a local resume only when the data directory is first created.
2. Paste a complete job description, or extract a public job page and review the extracted text. Blocked or JavaScript-only pages may require pasting instead.
3. Optionally fill company and role for download filenames, then generate the rewrite. The app rewrites and fact-checks the proposed bullets before applying them.
4. Compare the original and revised text. Edit a bullet using `**bold**` for emphasis or restore its exact original LaTeX. Manual edits are your own wording and are not sent through AI.
5. Update the PDF after edits. A draft becomes ready only when it compiles and does not exceed the base page count. Download the PDF and `.tex` from the same revision.
6. Answer **Did you apply to this role?** Choose **Yes, I applied** to add it to your tracker, or **Not yet** to keep it available for later. This app never submits an application for you.
7. Open **Applications** to edit company/role, applied date, posting URL, status, and notes. Search or filter your applications, or export them as CSV.

Automatic generation can make up to two shorter, fact-checked revisions to meet the page limit. Manual recompilation does not invoke AI or rewrite your edits. Overflow and compilation errors retain the editable draft. Old revision URLs are rejected, rather than serving a stale PDF as current.

## Application tracker

Each generated draft creates one prepared job record. Downloading a resume does not mark it applied. Unanswered and “Not yet” jobs remain in the prepared list even after a different rewrite or a base import. Clicking “Yes” records the application date; you can correct it in the details editor. Submitted statuses are Applied, Interviewing, Offer, Rejected, and Withdrawn. Choosing Not applied yet removes an accidental confirmation from the application count without deleting the job.

The tracker retains the job description and link for reference. It tracks jobs, not historical resume revisions: download your tailored PDF/LaTeX before generating another draft. The interface uses your local calendar date when you confirm an application; the date is editable. API clients that omit the date use the server’s UTC date. Tracker changes use revision checks so an old browser tab cannot silently overwrite a newer edit.

## Supported templates

- One UTF-8 `.tex` file, directly or inside a ZIP, using `\resumeItem{...}` inside Experience/Projects sections. ZIPs containing multiple `.tex` files are rejected. Supporting project files are not imported.
- Standard TeX Live packages and common section/role/project macros, as shown in the example.
- An existing plain paragraph in Summary, Professional Summary, or Profile can also be tailored. No summary is added automatically. Complex summary environments are rejected with an explanation.
- A narrowly scoped import repair moves a trailing `\underline` from `\titleformat`'s section font argument into its empty before-code argument. This fixes that template family's pdfLaTeX error while retaining the intended underlined headings. The interface discloses this adjustment; the original uploaded file/ZIP remains unchanged. No font sizes, margins, or spacing values are changed.
- All source outside editable blocks is preserved from the resulting base. Comments and the preamble are excluded from rewriting. Existing small LaTeX layout warnings are surfaced separately from page-count failures.

## Data and AI boundaries

The base, active draft, application records (including notes and job descriptions), and compiled artifacts are stored in `.data/`, excluded from Git. Back up that directory to keep your work. `.tools/`, ZIPs, `.tex`/PDF files, and `.env` files are also ignored. Replacing the base or regenerating replaces the active draft while preserving application records; previous PDF artifacts can remain on disk. There is no cloud sync or account system. Everyone who clones the repository runs their own local workspace with their own credentials and resume. The fictional example is the only resume included in Git.

Only editable resume text, its role/project context, skills context, and the job text are sent to OpenAI. Contact-header and commented-out content are omitted. Requests use `store: false`; this is not a claim of zero API-side retention. Model responses are schema-validated, escaped into LaTeX, checked for novel numbers, and reviewed for unsupported claims. These checks reduce factual drift but are not a proof of correctness: review the wording before applying.

The URL fetcher validates public IPs, pins the address used for the connection, revalidates redirects, and caps time and response size. Local routes validate Host and Origin. The compiler runs without shell escape, with a limited environment that excludes API credentials, restrictive TeX file settings, and a timeout. Compilation is designed for the user's own resume templates; it is not a general-purpose sandbox for hostile TeX programs.

## Local API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/state` | Public workspace state and setup diagnostics; excludes raw base source and secrets |
| POST | `/api/resume` | Multipart `file`: import `.tex` or ZIP |
| POST | `/api/job/extract` | JSON `{url}`: fetch and extract editable description |
| POST | `/api/rewrite` | JSON `{text, company?, role?, url?}`: newline-delimited progress, result, or error events |
| PATCH | `/api/applications` | `{id, revision, status?, company?, role?, appliedAt?, jobUrl?, notes?}`: update a prepared job or application |
| GET | `/api/applications/export` | Download submitted applications as CSV |
| PATCH | `/api/draft` | `{baseHash, draftId, revision, edits:[{blockId, spans, revert?}]}`: optimistic revision checks |
| POST | `/api/compile` | `{target:"base"}` or `{target:"draft",draftId,revision}` |
| GET | `/api/artifacts/base.pdf` or `.tex` | Original base artifacts |
| GET | `/api/artifacts/draft.pdf` or `.tex` | Current artifacts; requires `id` and `revision` query parameters |

`spans` is an array of `{text, bold}`. Add `download=1` to an artifact URL to request attachment disposition. Mutations are serialized within the single server process; concurrent work returns a conflict. Run only one server against a data directory. `RESUME_DATA_DIR` can select an isolated directory for testing.

The page also exposes optional WebMCP tools for reading workspace status, staging a job, and generating a rewrite. Browsers without WebMCP use the same visible controls normally.

## Validation

```sh
npm run typecheck
npm test
npm run test:smoke
npm run build
```

Unit tests cover source preservation, nested/escaped LaTeX, comments, summary parsing, import limits, grounding, API input privacy, errors, page overflow, and network boundaries. Tracker tests cover migration, confirmation, preserved history, stale revisions, input validation, and CSV escaping. An optional private-template assertion runs only when `PRIVATE_RESUME_FIXTURE` points to the original 14-bullet test ZIP.

The smoke test requires a LaTeX installation. It uses the fictional example and real compiler with explicitly controlled AI responses, tests generate/edit/revert/compile behavior, and writes only to `.data/qa-workspace`. It does not call OpenAI or modify the active workspace. GitHub Actions runs type checks, unit tests, and the production build without API credentials or personal resumes. A live OpenAI integration check requires your configured API key.

## Contributing

Use fictional resume and job data in tests, screenshots, and issues. Keep real resumes, job-search records, API keys, and local compiler files out of commits. Run `npm run typecheck`, `npm test`, and `npm run build` before submitting a pull request; run `npm run test:smoke` when changing PDF generation.

## License

[MIT](LICENSE).
