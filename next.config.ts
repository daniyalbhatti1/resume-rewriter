import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ["pdf-lib"],
  outputFileTracingExcludes: { "/*": [".data/**/*", ".tools/**/*", "*.zip", ".env*"] },
};
export default config;
