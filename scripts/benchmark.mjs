import { build } from "esbuild";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";

const compiled = await build({ stdin: { contents: `
export { createRecord } from './src/core/progress-engine';
export { checksum, decodeSnapshot } from './src/storage/migration';
export { JsonStorage } from './src/storage/json-storage';
export { VideoListModel } from './src/ui/video-list-model';`, resolveDir: process.cwd() },
  bundle: true, write: false, platform: "node", format: "esm" });
const { createRecord, checksum, decodeSnapshot, JsonStorage, VideoListModel } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
function medianMs(run) {
  run(); run();
  const values = Array.from({ length: 7 }, () => { const start = performance.now(); run(); return performance.now() - start; }).sort((a, b) => a - b);
  return Math.round(values[3] * 1000) / 1000;
}
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const results = [];
for (const count of [1000, 10000]) {
  const records = Array.from({ length: count }, (_, index) => ({ ...createRecord(`/Videos/课程/第${index + 1}节.mp4`, 1), duration: 3600 }));
  const payload = { videos: Object.fromEntries(records.map(record => [record.id, record])), settings: { completionThreshold: 0.95 } };
  const files = new Map();
  const storage = new JsonStorage({ exists: path => files.has(path), read: path => files.get(path), write: (path, text) => files.set(path, text) });
  storage.load();
  let revision = 0;
  const legacySaveMs = medianMs(() => {
    const body = { schemaVersion: 1, revision: ++revision, savedAt: revision, payload };
    const text = JSON.stringify({ ...body, checksum: checksum(JSON.stringify(body)) });
    files.set("legacy", text);
    const verified = decodeSnapshot(files.get("legacy"));
    if (verified.checksum !== decodeSnapshot(text).checksum) throw new Error("Readback failed");
  });
  const optimizedSaveMs = medianMs(() => { storage.state.dirty = true; if (!storage.save(payload, ++revision)) throw new Error("Save failed"); });
  const metadata = { settings: payload.settings, storage: { dirty: true, readOnly: false, recovered: false, lastSavedAt: 0 } };
  const fullMessageBytes = Buffer.byteLength(JSON.stringify({ ...metadata, videos: records }));
  const patchMessageBytes = Buffer.byteLength(JSON.stringify({ ...metadata, kind: "patch", scope: 1, videos: [records[0]] }));
  const legacyListMs = medianMs(() => {
    for (let tick = 0; tick < 100; tick++) {
      const all = records.map((record, index) => index === 0 ? { ...record, position: tick, progress: tick / 3600, lastPlayedAt: tick + 1 } : record);
      all.filter(record => record.status === "completed");
      all.filter(record => record.status === "watching");
      [...all].sort((a, b) => collator.compare(a.fileName, b.fileName));
      all.filter(record => record.status !== "completed").sort((a, b) => b.lastPlayedAt - a.lastPlayedAt || collator.compare(a.fileName, b.fileName));
    }
  });
  const model = new VideoListModel(); model.replace(records);
  const optimizedListMs = medianMs(() => {
    for (let tick = 0; tick < 100; tick++) model.apply([{ ...records[0], position: tick, progress: tick / 3600, lastPlayedAt: tick + 1 }]);
  });
  results.push({ records: count, fullMessageBytes, patchMessageBytes,
    checkpointMedianMs: { before: legacySaveMs, after: optimizedSaveMs },
    list100UpdatesMedianMs: { before: legacyListMs, after: optimizedListMs }, fullSortsAfterUpdates: model.fullSorts });
}
const report = { date: "2026-11-25", runtime: process.version, platform: `${process.platform}/${process.arch}`,
  method: "Median of 7 warmed runs, synthetic records, memory I/O, Node.js. List timings exclude DOM; not an IINA CPU/FPS or disk benchmark.", results };
const json = JSON.stringify(report, null, 2);
const output = process.argv.indexOf("--output");
if (output >= 0) await writeFile(process.argv[output + 1], `${json}\n`);
process.stdout.write(`${json}\n`);
