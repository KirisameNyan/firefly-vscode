import { describe, expect, it } from "vitest";
import { formatDate, isValidDate, today } from "../src/core/date";

describe("isValidDate", () => {
  it("接受合法日期", () => {
    expect(isValidDate("2026-10-17")).toBe(true);
    expect(isValidDate("2024-02-29")).toBe(true);
    expect(isValidDate("2026-01-01")).toBe(true);
  });

  it("拒绝 2026-02-30 这类溢出日期与格式错误", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2025-02-29")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-00-10")).toBe(false);
    expect(isValidDate("2026-1-1")).toBe(false);
    expect(isValidDate("2026/10/17")).toBe(false);
    expect(isValidDate("")).toBe(false);
  });
});

describe("formatDate / today", () => {
  it("补零输出 YYYY-MM-DD", () => {
    expect(formatDate(new Date(2026, 9, 7))).toBe("2026-10-07");
    expect(formatDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("today 用给定时间", () => {
    expect(today(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
