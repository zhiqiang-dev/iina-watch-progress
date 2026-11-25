import type { VideoRecord } from "../models/video-record";

export function formatTime(seconds: number, unknownWhenZero = false): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return unknownWhenZero ? "—" : "0:00";
  const total = Math.floor(seconds), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}
export function positionRatio(position: number, duration: number): number {
  return Number.isFinite(position) && Number.isFinite(duration) && duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
}
export function remainingTime(position: number, duration: number): string {
  return duration > 0 ? `剩余 ${formatTime(Math.max(0, duration - position))}` : "时长未知";
}
export function recentTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return "未观看";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const date = new Date(timestamp), today = new Date(now);
  if (date.toDateString() === today.toDateString()) return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
export function progressDescription(record: VideoRecord): string {
  return `最后位置 ${formatTime(record.position)}，${record.status === "completed" ? "已完成" : `历史最远 ${Math.floor(record.progress * 100)}%`}；浅色为最远到达位置，实色和圆点为最后位置，不代表实际观看覆盖率。`;
}
