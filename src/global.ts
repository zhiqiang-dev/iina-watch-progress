import { filePort, validSample } from "./adapter/iina-api";
import { JsonStorage } from "./storage/json-storage";
import { Repository } from "./storage/repository";
import { Coordinator } from "./core/coordinator";
import { MSG } from "./messaging/message-bus";
import { object } from "./storage/migration";
import { DeferredGlobalMessages, onNativeMessage } from "./messaging/native-messages";
import { mergeRecordMessages } from "./messaging/record-updates";

const globalAPI = iina.global;
const outbound = new DeferredGlobalMessages(
  (player, name, wire) => globalAPI.postMessage(player, name, wire),
  callback => { setTimeout(callback, 1); },
  error => iina.console.error(`Watch Progress message: ${String(error)}`),
);
const repository = new Repository(new JsonStorage(filePort(iina.file)));
const coordinator = new Coordinator(repository,
  (player, state) => outbound.post(player, MSG.records, state, mergeRecordMessages),
  player => outbound.post(player, MSG.reset, null));

function on(name: string, handler: (data: Record<string, unknown>, player: string) => void): void {
  onNativeMessage(globalAPI, name, (data: unknown, player?: string) => {
    if (!player || !object(data)) return;
    try { handler(data, player); }
    catch (error) { iina.console.error(`Watch Progress: ${String(error)}`); }
  });
}

on(MSG.sync, (data, player) => {
  if (Array.isArray(data.paths) && data.paths.every(path => typeof path === "string"))
    coordinator.sync(player, data.paths, Date.now(), Number.isSafeInteger(data.scope) && (data.scope as number) >= 0 ? data.scope as number : 0);
});
on(MSG.begin, (data, player) => {
  if (typeof data.session === "string" && typeof data.path === "string")
    coordinator.begin(player, data.session, data.path, Date.now());
});
on(MSG.sample, (data, player) => {
  if (typeof data.session === "string" && validSample(data.sample))
    coordinator.sample(player, data.session, data.sample, data.flush === true);
});
on(MSG.end, (data, player) => {
  if (typeof data.session === "string") coordinator.end(player, data.session, Date.now());
});
on(MSG.mark, (data, player) => {
  if (typeof data.id === "string" && typeof data.completed === "boolean")
    coordinator.mark(player, data.id, data.completed, Date.now());
});
on(MSG.settings, data => {
  if (repository.setThreshold(data.threshold)) {
    repository.flush(Date.now());
    coordinator.publishAll();
  }
});
on(MSG.disconnect, (_data, player) => coordinator.disconnect(player, Date.now()));

setInterval(() => {
  if (repository.storage.state.dirty) {
    repository.flush(Date.now());
    coordinator.publishAll();
  }
}, 5000);
iina.console.log("Watch Progress: global storage ready");
