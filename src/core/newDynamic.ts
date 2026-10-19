//! 纯逻辑：新建动态的时间戳、文件名与模板。
//! 格式逐行对齐上游 Firefly/scripts/new-dynamic.js，不要改动顺序或换行。

/** 一条动态的时间事实：字面时间戳与约定的文件名。 */
export interface DynamicStamp {
  /** YYYY-MM-DD HH:mm:ss */
  timestamp: string;
  /** YYYY-MM-DD-HHmmss.md */
  fileName: string;
}

const TIMEZONE_RE = /timezone:\s*"([^"]+)"/;

/** 从 siteConfig.ts 源码里读 timezone；读不到返回 undefined（调用方回退本地时区）。 */
export function readTimezone(source: string): string | undefined {
  const match = TIMEZONE_RE.exec(source);
  const value = match?.[1]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * 按指定时区把毫秒格式化成上游同款时间戳与文件名。
 * timeZone 缺失或非法时回退到本地时区（不抛错，命令层不必处理异常）。
 */
export function formatStamp(ms: number, timeZone?: string): DynamicStamp {
  const zone = timeZone !== undefined && isTimeZone(timeZone) ? timeZone : undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    ...(zone === undefined ? {} : { timeZone: zone }),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const hours = pick("hour");
  const minutes = pick("minute");
  const seconds = pick("second");
  return {
    timestamp: year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds,
    fileName: year + "-" + month + "-" + day + "-" + hours + minutes + seconds + ".md",
  };
}

/** 与上游 `---\npublished: <ts>\n---\n\n<content>\n` 一致；有 location 时插在 published 之后。 */
export function buildDynamicContent(
  timestamp: string,
  content: string,
  location?: string,
): string {
  const lines = ["---", "published: " + timestamp];
  if (location !== undefined && location !== "") lines.push("location: " + location);
  lines.push("---", "", content, "");
  return lines.join("\n");
}

/** 正文起点的 offset（闭围栏与空行之后），用于把光标落在正文。 */
export function dynamicBodyStart(text: string): number {
  const fence = text.lastIndexOf("\n---");
  if (fence === -1) return text.length;
  let index = fence + 4;
  if (text[index] === "\r") index += 1;
  if (text[index] === "\n") index += 1;
  if (text[index] === "\r") index += 1;
  if (text[index] === "\n") index += 1;
  return Math.min(index, text.length);
}
