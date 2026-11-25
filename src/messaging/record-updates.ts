import type { RecordsMessage } from "./message-bus";

/** A pending snapshot must not be replaced by a single-record update. Likewise,
 * two windows updating different files in one tick must retain both changes.
 */
export function mergeRecordMessages(previousWire: string, nextWire: string): string {
  const previous = JSON.parse(previousWire) as RecordsMessage;
  const next = JSON.parse(nextWire) as RecordsMessage;
  if (previous.scope !== next.scope || next.kind !== "patch") return nextWire;
  const records = new Map(previous.videos.map(record => [record.id, record]));
  for (const record of next.videos) {
    if (previous.kind === "patch" || records.has(record.id)) records.set(record.id, record);
  }
  return JSON.stringify({ ...next, kind: previous.kind === "patch" ? "patch" : "snapshot", videos: [...records.values()] });
}
