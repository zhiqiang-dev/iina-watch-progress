import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function compile(source) {
  const result = await build({ stdin: { contents: source, loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const baseline = await compile(execFileSync("git", ["show", "v0.1.3:src/ui/video-list-model.ts"], { encoding: "utf8" }));
const current = await compile(`export { VideoListModel } from './src/ui/video-list-model';
export { JsonStorage } from './src/storage/json-storage'; export { createRecord } from './src/core/progress-engine';`);
function median(run) {
  run(); run();
  const times = Array.from({ length: 7 }, () => { const start = performance.now(); run(); return performance.now() - start; }).sort((a, b) => a - b);
  return Number(times[3].toFixed(3));
}
const queries = Array.from({ length: 100 }, (_, i) => ["", "课", "课程", "课程 1", "0"][i % 5]);
const temporary = mkdtempSync(path.join(tmpdir(), "iina-watch-progress-benchmark-"));
const results = [];
try {
  for (const count of [1000, 10000]) {
    const records = Array.from({ length: count }, (_, i) => ({ ...current.createRecord(`/Benchmark/${String(i + 1).padStart(5, "0")} 课程.mp4`, 1), duration: 3600 }));
    const before = new baseline.VideoListModel(), after = new current.VideoListModel(); before.replace(records); after.replace(records);
    for (const query of queries) {
      before.setQuery("all", query, "name"); after.setQuery("all", query, "name");
      if (JSON.stringify(before.ids) !== JSON.stringify(after.ids)) throw new Error("Query result mismatch");
    }
    const sortCounts = { before: before.fullSorts, after: after.fullSorts };
    const searchMedianMs = {
      before: median(() => queries.forEach(query => before.setQuery("all", query, "name"))),
      after: median(() => queries.forEach(query => after.setQuery("all", query, "name"))),
    };
    const payload = { videos: Object.fromEntries(records.map(record => [record.id, record])), settings: { completionThreshold: 0.95, saveIntervalSeconds: 5 } };
    const storage = new current.JsonStorage({
      exists: file => existsSync(path.join(temporary, path.basename(file))),
      read: file => readFileSync(path.join(temporary, path.basename(file)), "utf8"),
      write: (file, data) => writeFileSync(path.join(temporary, path.basename(file)), data),
    });
    let revision = 0;
    const temporarySnapshotMedianMs = median(() => { storage.state.dirty = true; if (!storage.save(payload, ++revision)) throw new Error(storage.state.error); });
    const snapshotBytes = Buffer.byteLength(readFileSync(path.join(temporary, "records.json")));
    results.push({ records: count, queries: queries.length, searchMedianMs, fullSortsIncludingInitialLoad: sortCounts, temporarySnapshotMedianMs, snapshotBytes });
    for (const name of ["records.json", "records.backup.json"]) rmSync(path.join(temporary, name), { force: true });
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
const report = { version: JSON.parse(readFileSync("Info.json", "utf8")).version, date: "2026-11-26", baseline: "v0.1.3",
  runtime: process.version, platform: `${process.platform}/${process.arch}`,
  method: "Median of 7 warmed runs, 100 sequential queries, synthetic records. Exact v0.1.3 model vs working tree. Temporary-file writes include serialization and read-back, use OS caches and do not fsync. Not an IINA CPU/FPS or SSD physical-write benchmark.", results };
const json = `${JSON.stringify(report, null, 2)}\n`, output = process.argv.indexOf("--output");
if (output >= 0) writeFileSync(process.argv[output + 1], json);
process.stdout.write(json);
