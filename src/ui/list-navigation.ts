import type { VideoRecord } from "../models/video-record";

/** Follow the currently displayed order and filters. Stop at the boundary rather than wrapping. */
export function adjacentUnfinished(ids: string[], records: ReadonlyMap<string, VideoRecord>, from: number, direction: -1 | 1): string | undefined {
  let index = from < 0 ? direction === 1 ? 0 : ids.length - 1 : from + direction;
  for (; index >= 0 && index < ids.length; index += direction) {
    const id = ids[index]!, record = records.get(id);
    if (record && record.status !== "completed") return id;
  }
}

/** Filename prefixes, not a transient index in a filtered/sorted list. Ambiguities stay explicit. */
export function numberedVideos(records: Iterable<VideoRecord>, input: string): string[] {
  const normalized = input.normalize("NFKC").trim();
  if (!/^\d+$/.test(normalized)) return [];
  const number = Number(normalized);
  if (!Number.isSafeInteger(number)) return [];
  return [...records].filter(record => {
    const prefix = record.fileName.normalize("NFKC").match(/^\s*(\d+)/);
    return prefix && Number(prefix[1]) === number;
  }).map(record => record.id);
}
