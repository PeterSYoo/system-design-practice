// Bundles the server into dist/index.js. The shared package is inlined; npm dependencies stay external.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  alias: { "@sdp/shared": "../shared/src/index.ts" },
  define: { "process.env.SDP_MODE": '"production"' },
  sourcemap: true,
  logLevel: "info",
});
