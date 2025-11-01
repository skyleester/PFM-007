import { describe, expect, it } from "vitest";
import { composeCalendarSnapshot } from "@/lib/calendar/data";
import type {
  CalendarEvent,
  CalendarHoliday,
  CalendarRangeParams,
  CalendarTransaction,
  RecurringOccurrence,
} from "@/lib/calendar/types";

describe("composeCalendarSnapshot", () => {
  it("합산된 정기 일정과 공휴일을 포함한다", () => {
    const params: CalendarRangeParams = { userId: 1, start: "2024-01-01", end: "2024-01-31" };

    const transactions: CalendarTransaction[] = [
      {
        id: 1,
        user_id: 1,
        occurred_at: "2024-01-01T09:00:00",
        occurred_time: "09:00:00",
        type: "INCOME",
        group_id: null,
        account_id: 10,
        counter_account_id: null,
        category_id: 100,
        amount: 100000,
        currency: "KRW",
        memo: "실제 수입",
        payee_id: null,
        external_id: "rule-1-2024-01-01",
        is_balance_neutral: false,
        is_auto_transfer_match: false,
        exclude_from_reports: false,
      },
    ];

    const occurrences: RecurringOccurrence[] = [
      {
        ruleId: 1,
        ruleName: "급여",
        ruleType: "INCOME",
        amount: 50000,
        currency: "KRW",
        accountId: 10,
        counterAccountId: null,
        categoryId: 100,
        memo: "예정",
        date: "2024-01-01",
      },
      {
        ruleId: 2,
        ruleName: "보험료",
        ruleType: "EXPENSE",
        amount: 20000,
        currency: "KRW",
        accountId: 10,
        counterAccountId: null,
        categoryId: 200,
        memo: "예정",
        date: "2024-01-01",
      },
    ];

    const events: CalendarEvent[] = [];
    const holidays: CalendarHoliday[] = [{ date: "2024-01-01", name: "신정" }];

    const snapshot = composeCalendarSnapshot(params, transactions, occurrences, events, holidays);
    const bucket = snapshot.byDate["2024-01-01"];

    expect(bucket).toBeDefined();
  expect(bucket.totals.income).toBe(100000);
  expect(bucket.totals.expense).toBe(20000);
  expect(bucket.totals.net).toBe(80000);
  expect(bucket.recurring).toHaveLength(1);
  expect(bucket.holidays).toHaveLength(1);
  expect(snapshot.holidays).toHaveLength(1);
  expect(snapshot.totals.income).toBe(100000);
  expect(snapshot.totals.expense).toBe(20000);
  expect(snapshot.totals.net).toBe(80000);
    expect(bucket.transactions[0].recurring_rule_id).toBe(1);
    expect(bucket.transactions[0].recurring_rule_name).toBe("급여");
  });

  it("확정된 거래가 있는 정기 일정은 반복 목록에서 제거한다", () => {
    const params: CalendarRangeParams = { userId: 1, start: "2025-10-01", end: "2025-10-02" };

    const transactions: CalendarTransaction[] = [
      {
        id: 2,
        user_id: 1,
        occurred_at: "2025-10-01",
        occurred_time: null,
        type: "EXPENSE",
        group_id: null,
        account_id: 20,
        counter_account_id: null,
        category_id: 200,
        amount: -12500,
        currency: "KRW",
        memo: "확정 지출",
        payee_id: null,
        external_id: "rule-42-2025-10-01",
        is_balance_neutral: false,
        is_auto_transfer_match: false,
        exclude_from_reports: false,
      },
    ];

    const occurrences: RecurringOccurrence[] = [
      {
        ruleId: 42,
        ruleName: "변동 지출",
        ruleType: "EXPENSE",
        amount: null,
        currency: "KRW",
        accountId: 20,
        counterAccountId: null,
        categoryId: 200,
        memo: "예정",
        date: "2025-10-01",
      },
    ];

    const snapshot = composeCalendarSnapshot(params, transactions, occurrences, [], []);
    const bucket = snapshot.byDate["2025-10-01"];

    expect(bucket).toBeDefined();
    expect(bucket.transactions).toHaveLength(1);
    expect(bucket.recurring).toHaveLength(0);
  });

  it("exclude_from_reports 플래그가 달력 합계에서 제외된다", () => {
    const params: CalendarRangeParams = { userId: 1, start: "2024-02-01", end: "2024-02-02" };

    const transactions: CalendarTransaction[] = [
      {
        id: 3,
        user_id: 1,
        occurred_at: "2024-02-01",
        occurred_time: null,
        type: "EXPENSE",
        group_id: null,
        account_id: 30,
        counter_account_id: null,
        category_id: 300,
        amount: -5000,
        currency: "KRW",
        memo: "제외된 지출",
        payee_id: null,
        external_id: null,
        is_balance_neutral: false,
        is_auto_transfer_match: false,
        exclude_from_reports: true,
      },
      {
        id: 4,
        user_id: 1,
        occurred_at: "2024-02-01",
        occurred_time: null,
        type: "INCOME",
        group_id: null,
        account_id: 30,
        counter_account_id: null,
        category_id: 301,
        amount: 10000,
        currency: "KRW",
        memo: "포함된 수입",
        payee_id: null,
        external_id: null,
        is_balance_neutral: false,
        is_auto_transfer_match: false,
        exclude_from_reports: false,
      },
    ];

    const snapshot = composeCalendarSnapshot(params, transactions, [], [], []);
    const bucket = snapshot.byDate["2024-02-01"];

    expect(bucket).toBeDefined();
    expect(bucket?.transactions).toHaveLength(2);
    expect(bucket?.totals.expense).toBe(0);
    expect(bucket?.totals.income).toBe(10000);
    expect(bucket?.totals.net).toBe(10000);
    expect(snapshot.totals.expense).toBe(0);
    expect(snapshot.totals.income).toBe(10000);
    expect(snapshot.totals.net).toBe(10000);
  });
});
