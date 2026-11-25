import { cp, mkdir, rm, readFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const cli = process.env.IINA_PLUGIN_CLI || "/Applications/IINA.app/Contents/MacOS/iina-plugin";
if (!existsSync(cli)) throw new Error("未找到 iina-plugin，请通过 IINA_PLUGIN_CLI 指定官方 CLI 的路径。");
const info = JSON.parse(await readFile("Info.json", "utf8"));
await mkdir("release", { recursive: true });
const folder = path.resolve(`release/iina-watch-progress-${info.version}.iinaplugin`);
await rm(folder, { recursive: true, force: true });
await cp("dist", folder, { recursive: true });
await rm(path.join(folder, "preview.js"), { force: true });
await cp("LICENSE", path.join(folder, "LICENSE"));
// IINA 1.5.1's CLI resolves its argument relative to cwd, even for absolute input.
const result = spawnSync(cli, ["pack", `./${path.basename(folder)}`], { cwd: path.resolve("release"), stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
const archive = path.resolve(`release/iina-watch-progress-${info.version}.iinaplgz`);
await rename(path.resolve(`release/${path.basename(folder)}-${info.version}.iinaplgz`), archive);
process.stdout.write(`Installable plugin: ${archive}\n`);
