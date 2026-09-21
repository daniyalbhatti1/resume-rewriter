import { AppError } from "./errors";
import { aiConfigured, modelName } from "./ai";
import { compilerSetup } from "./compiler";
import { isBusy } from "./store";
import type { AppState, PublicState } from "./types";

export function guardLocal(request: Request) {
  const url = new URL(request.url);
  // Next's Node adapter can normalize request.url to localhost while the browser
  // uses 127.0.0.1. Validate the actual Host header before comparing Origin.
  const actual = new URL(`${url.protocol}//${request.headers.get("host") || url.host}`);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(actual.hostname)) throw new AppError("This app is available only on localhost.", 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== actual.origin) throw new AppError("Cross-origin requests are not allowed.", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new AppError("Cross-site requests are not allowed.", 403);
}
export async function publicState(state: AppState): Promise<PublicState> {
  const { source: _source, skills: _skills, ...base } = state.base ?? { source: "", skills: "" };
  return { base: state.base ? base as PublicState["base"] : null, draft: state.draft, applications: state.applications ?? [],
    setup: { ai: aiConfigured(), model: modelName(), ...await compilerSetup(state.base?.source) }, busy: isBusy() };
}
