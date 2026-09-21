import nextEnv from "@next/env";
import { compilerSetup, texBin } from "../lib/compiler";
import { loadState } from "../lib/store";
import { aiConfigured, modelName } from "../lib/ai";

nextEnv.loadEnvConfig(process.cwd());
const state = await loadState();
const setup = await compilerSetup(state.base?.source);
console.log(JSON.stringify({ node: process.version, apiKeyConfigured: aiConfigured(), model: modelName(), compilerDirectory: await texBin(),
  ...setup, resume: state.base?.filename ?? null, editableBlocks: state.base?.blocks.length ?? 0, baselinePages: state.base?.compilation?.pages ?? null }, null, 2));
if (!setup.latex || setup.missingPackages.length) process.exitCode = 1;
