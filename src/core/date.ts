//! 纯函数：日期校验与格式化（YYYY-MM-DD）。取值按本地时区，与上游 new-post.js 一致。

const DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/** 是否为合法日期，拒绝 2026-02-30、2025-02-29 这类溢出值。 */
export function isValidDate(value: string): boolean {
  const m = DATE_PATTERN.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(0);
  probe.setUTCHours(0, 0, 0, 0);
  probe.setUTCFullYear(year, month - 1, day);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** 格式化为 YYYY-MM-DD（本地时区）。 */
export function formatDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

/** 今天的 YYYY-MM-DD。 */
export function today(now: Date = new Date()): string {
  return formatDate(now);
}

export const DATE_HINT = "日期格式为 YYYY-MM-DD，例如 2026-10-17";
