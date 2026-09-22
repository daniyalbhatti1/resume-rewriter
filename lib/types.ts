export type Span = { text: string; bold: boolean };
export type ResumeBlock = {
  id: string; kind: "bullet" | "summary"; section: string; context: string;
  start: number; end: number; originalLatex: string; originalText: string;
};
export type Compilation = {
  sourceHash: string; revision: number; pages: number; artifact: string;
  warnings: string[];
};
export type BaseResume = {
  hash: string; filename: string; source: string; blocks: ResumeBlock[];
  skills: string; compilation?: Compilation; importNotes?: string[];
};
export type Change = {
  blockId: string; spans: Span[]; reason: string;
  status: "rewritten" | "edited" | "reverted" | "flagged";
  warning?: string;
};
export type Draft = {
  id: string; baseHash: string; revision: number; company: string; role: string;
  jobText: string; jobUrl?: string; changes: Change[]; status: "draft" | "ready" | "overflow" | "error";
  compilation?: Compilation; error?: string; warnings: string[];
};
export type ApplicationStatus = "pending" | "not_applied" | "applied" | "interview" | "offer" | "rejected" | "withdrawn";
export type SavedResume = {
  source: string; filename: string; draftRevision: number; savedAt: string;
  compilation?: Compilation;
};
export type Application = {
  id: string; draftId: string; baseHash: string; revision: number;
  company: string; role: string; jobUrl: string; jobText: string;
  status: ApplicationStatus; createdAt: string; updatedAt: string;
  appliedAt: string | null; notes: string;
  resume?: SavedResume;
};
// Optional only for backwards compatibility with pre-tracker workspaces.
export type AppState = { base: BaseResume | null; draft: Draft | null; applications?: Application[] };
export type PublicState = Omit<AppState, "base"> & {
  base: Omit<BaseResume, "source" | "skills"> | null;
  setup: { ai: boolean; model: string; latex: boolean; missingPackages: string[] };
  busy: boolean;
};
