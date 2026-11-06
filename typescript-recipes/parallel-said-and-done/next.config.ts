import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A second dev server (e.g. one replaying a scratch copy of data/) needs its own build directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The pages read data/ and config/ from disk at request time.
  outputFileTracingIncludes: { "/**": ["./data/**/*", "./config/**/*"] },
};

export default nextConfig;
