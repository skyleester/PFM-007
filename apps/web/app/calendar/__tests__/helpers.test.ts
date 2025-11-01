import { describe, expect, it } from "vitest";
import type { CalendarTransaction } from "@/lib/calendar/types";
import { isRecurringTransaction } from "@/app/calendar/page";

const baseTransaction: CalendarTransaction = {
  id: 1,
  user_id: 1,
  occurred_at: "2025-10-01T00:00:00",
  occurred_time: null,
  type: "EXPENSE",
  group_id: null,
  account_id: 1,
  counter_account_id: null,
  category_id: null,
  amount: -12000,
  currency: "KRW",
  memo: null,
  payee_id: null,
  external_id: null,
  is_balance_neutral: false,
  is_auto_transfer_match: false,
  exclude_from_reports: false,
};

describe("isRecurringTransaction", () => {
  it("returns true when external_id matches recurring rule pattern", () => {
    const txn: CalendarTransaction = { ...baseTransaction, external_id: "rule-12-2025-10-01" };
    expect(isRecurringTransaction(txn)).toBe(true);
  });

  it("returns false for non recurring transactions", () => {
    const txn: CalendarTransaction = { ...baseTransaction, external_id: "manual-2025-10-01" };
    expect(isRecurringTransaction(txn)).toBe(false);
  });

  it("returns false when external_id is missing", () => {
    const txn: CalendarTransaction = { ...baseTransaction, external_id: null };
    expect(isRecurringTransaction(txn)).toBe(false);
  });
});
