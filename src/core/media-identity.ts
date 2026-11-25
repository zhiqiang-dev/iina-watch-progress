const VIDEO_EXTENSION = /\.(mp4|m4v|mkv|mov|avi|webm|flv|wmv|mpg|mpeg|ts|mts|m2ts|vob|ogv|3gp)$/i;

/** Pure lexical identity: preserve case, Unicode and literal percent signs. */
export function normalizePath(input: string, workingDirectory?: string): string | undefined {
  if (!input || input.includes("\0")) return;
  let path = input;
  if (/^file:\/\//i.test(path)) {
    const match = /^file:\/\/(?:localhost)?(\/[^?#]*)(?:[?#].*)?$/i.exec(path);
    if (!match?.[1]) return;
    try { path = decodeURIComponent(match[1]); } catch { return; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path)) return;
  if (!path.startsWith("/")) {
    if (!workingDirectory?.startsWith("/")) return;
    path = `${workingDirectory}/${path}`;
  }
  if (path.includes("\0")) return;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.length ? `/${parts.join("/")}` : undefined;
}

export function mediaId(path: string): string { return `path:${path}`; }
export function fileName(path: string): string { return path.slice(path.lastIndexOf("/") + 1); }
export function folderPath(path: string): string { return path.slice(0, path.lastIndexOf("/")) || "/"; }
export function isVideo(path: string): boolean { return VIDEO_EXTENSION.test(path); }
