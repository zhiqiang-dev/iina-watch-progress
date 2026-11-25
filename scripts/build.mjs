import { build, context } from "esbuild";
import { mkdir, cp, rm } from "node:fs/promises";

await mkdir("dist/ui/sidebar", { recursive: true });
await cp("Info.json", "dist/Info.json");
await cp("src/ui/sidebar/index.html", "dist/ui/sidebar/index.html");
await cp("src/ui/sidebar/style.css", "dist/ui/sidebar/style.css");
const jobs = [
  { entryPoints: ["src/main.ts", "src/global.ts"], outdir: "dist", platform: "neutral" },
  { entryPoints: ["src/ui/sidebar/index.ts"], outdir: "dist/ui/sidebar", platform: "browser" },
  { entryPoints: ["src/ui/preview.ts"], outfile: "dist/preview.js", platform: "browser" },
];
const watch = process.argv.includes("--watch");
for (const job of jobs) {
  const options = { ...job, bundle: true, target: "safari14", format: "iife", logLevel: "info", sourcemap: false };
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
  } else await build(options);
}
if (!watch) await rm("dist/.DS_Store", { force: true });
// For watch mode, mirror static assets as well as TypeScript.
if (watch) {
  const { watch: watchFiles } = await import("node:fs");
  for (const source of ["Info.json", "src/ui/sidebar/index.html", "src/ui/sidebar/style.css"])
    watchFiles(source, async () => cp(source, source === "Info.json" ? "dist/Info.json" : `dist/ui/sidebar/${source.split("/").at(-1)}`));
}
