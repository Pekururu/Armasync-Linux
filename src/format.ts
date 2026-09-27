export function bytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** power).toFixed(power < 2 ? 0 : 1)} ${units[power]}`;
}

export function rate(bytesPerSecond: number | null) {
  return bytesPerSecond === null ? "—" : `${bytes(bytesPerSecond)}/s`;
}

export function eta(remaining: number, bytesPerSecond: number | null) {
  if (!bytesPerSecond || bytesPerSecond <= 0 || remaining <= 0) return null;
  const seconds = Math.round(remaining / bytesPerSecond);
  if (seconds < 60) return `${seconds}s left`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s left`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m left`;
}

/** Unix seconds, as the backend reports file times. */
export function fileDate(value: number | null) {
  return value ? new Date(value * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Unknown date";
}

export function clock(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** Shortens the home directory to ~ so paths fit on one row. */
export function tidyPath(path: string) {
  return path.replace(/^\/home\/[^/]+/, "~");
}
