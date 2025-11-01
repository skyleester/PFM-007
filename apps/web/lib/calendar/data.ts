import { useEffect, useState } from "react";
import { apiGet } from "../api";
import type { RecurringRulePreviewResponse } from "../recurring/types";
import { loadCalendarEvents } from "./events";
import { loadCalendarHolidays } from "./holidays";
import type {
  CalendarDayBucket,
  CalendarEvent,
  CalendarHoliday,
  CalendarRangeParams,
  CalendarSnapshot,
  CalendarTotals,
  CalendarTransaction,
  RecurringOccurrence,
  RecurringRuleSummary,
  UseCalendarDataResult,
  UseCalendarDataState,
} from "./types";

const MAX_PAGE_SIZE = 2000;
const RECURRING_PREVIEW_PAGE_SIZE = 200;

function normaliseDate(value: string): string {
  return value.slice(0, 10);
}

export function extractRecurringRuleId(externalId: string | null | undefined): number | null {
  if (!externalId || !externalId.startsWith("rule-")) {
    return null;
  }
  const parts = externalId.split("-");
  if (parts.length < 3) {
    return null;
  }
  const ruleId = Number(parts[1]);
  return Number.isNaN(ruleId) ? null : ruleId;
}

function createEmptyTotals(): CalendarTotals {
  return {
    income: 0,
    expense: 0,
    net: 0,
    transferIn: 0,
    transferOut: 0,
  };
}

function cloneTotals(src: CalendarTotals): CalendarTotals {
  return { ...src };
}

function ensureBucket(map: Record<string, CalendarDayBucket>, date: string): CalendarDayBucket {
  if (!map[date]) {
    map[date] = {
      date,
      transactions: [],
      recurring: [],
      events: [],
      holidays: [],
      totals: createEmptyTotals(),
    };
  }
  return map[date];
}

function accumulateTransaction(bucket: CalendarDayBucket, tx: CalendarTransaction) {
  bucket.transactions.push(tx);
  if (tx.exclude_from_reports) {
    return;
  }
  if (tx.type === "TRANSFER") {
    if (tx.amount >= 0) {
      bucket.totals.transferIn += tx.amount;
    } else {
      bucket.totals.transferOut += Math.abs(tx.amount);
    }
    return;
  }

  if (tx.amount > 0) {
    bucket.totals.income += tx.amount;
    bucket.totals.net += tx.amount;
  } else if (tx.amount < 0) {
    const expense = Math.abs(tx.amount);
    bucket.totals.expense += expense;
    bucket.totals.net += tx.amount;
  }
}

function accumulateOccurrence(bucket: CalendarDayBucket, occurrence: RecurringOccurrence, grandTotals: CalendarTotals) {
  bucket.recurring.push(occurrence);
  if (typeof occurrence.amount !== "number" || !Number.isFinite(occurrence.amount)) {
    return;
  }

  if (occurrence.ruleType === "INCOME") {
    bucket.totals.income += occurrence.amount;
    bucket.totals.net += occurrence.amount;
    grandTotals.income += occurrence.amount;
    grandTotals.net += occurrence.amount;
  } else if (occurrence.ruleType === "EXPENSE") {
    const expense = Math.abs(occurrence.amount);
    bucket.totals.expense += expense;
    bucket.totals.net -= expense;
    grandTotals.expense += expense;
    grandTotals.net -= expense;
  }
}

function accumulateHoliday(bucket: CalendarDayBucket, holiday: CalendarHoliday) {
  bucket.holidays.push(holiday);
}

function accumulateEvent(bucket: CalendarDayBucket, event: CalendarEvent) {
  bucket.events.push(event);
}

async function fetchTransactions(params: CalendarRangeParams): Promise<CalendarTransaction[]> {
  const { userId, start, end } = params;
  return apiGet<CalendarTransaction[]>("/api/transactions", {
    user_id: userId,
    start,
    end,
    page: 1,
    page_size: MAX_PAGE_SIZE,
    sort_by: "occurred_at",
    sort_order: "asc",
  });
}

async function fetchRecurringRules(userId: number): Promise<RecurringRuleSummary[]> {
  return apiGet<RecurringRuleSummary[]>("/api/recurring-rules", { user_id: userId });
}

async function fetchRecurringOccurrences(params: CalendarRangeParams): Promise<RecurringOccurrence[]> {
  const { userId, start, end } = params;
  const rules = await fetchRecurringRules(userId);
  const activeRules = rules.filter((rule) => rule.is_active);
  if (activeRules.length === 0) {
    return [];
  }

  const occurrencesPerRule = await Promise.all(
    activeRules.map(async (rule) => {
      const convertItemsToOccurrences = (response: RecurringRulePreviewResponse) =>
        response.items.map<RecurringOccurrence>((item) => ({
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.type,
          amount: item.draft_amount ?? rule.amount ?? null,
          currency: rule.currency,
          accountId: rule.account_id,
          counterAccountId: rule.counter_account_id ?? null,
          categoryId: rule.category_id ?? null,
          memo: rule.memo ?? undefined,
          date: item.occurred_at,
        }));

      const firstPage = await apiGet<RecurringRulePreviewResponse>(`/api/recurring-rules/${rule.id}/preview`, {
        start,
        end,
        page: 1,
        page_size: RECURRING_PREVIEW_PAGE_SIZE,
      });

      const occurrences: RecurringOccurrence[] = [...convertItemsToOccurrences(firstPage)];

      const totalPages =
        firstPage.total_count > 0 && firstPage.page_size > 0
          ? Math.ceil(firstPage.total_count / firstPage.page_size)
          : 0;

      if (totalPages <= 1) {
        return occurrences;
      }

      for (let page = 2; page <= totalPages; page += 1) {
        const response = await apiGet<RecurringRulePreviewResponse>(`/api/recurring-rules/${rule.id}/preview`, {
          start,
          end,
          page,
          page_size: firstPage.page_size,
        });
        occurrences.push(...convertItemsToOccurrences(response));
      }

      return occurrences;
    })
  );

  return occurrencesPerRule.flat();
}

function buildSnapshot(
  params: CalendarRangeParams,
  transactions: CalendarTransaction[],
  occurrences: RecurringOccurrence[],
  events: CalendarEvent[],
  holidays: CalendarHoliday[]
): CalendarSnapshot {
  const byDate: Record<string, CalendarDayBucket> = {};
  const grandTotals = createEmptyTotals();

  const ruleNameMap = new Map<number, string>();
  for (const occurrence of occurrences) {
    ruleNameMap.set(occurrence.ruleId, occurrence.ruleName);
  }

  const confirmedOccurrences = new Set<string>();

  for (const transaction of transactions) {
    const date = normaliseDate(transaction.occurred_at);
    const bucket = ensureBucket(byDate, date);
    accumulateTransaction(bucket, transaction);
    if (transaction.exclude_from_reports) {
      continue;
    }
    if (transaction.type === "TRANSFER") {
      if (transaction.amount >= 0) {
        grandTotals.transferIn += transaction.amount;
      } else {
        grandTotals.transferOut += Math.abs(transaction.amount);
      }
    } else if (transaction.amount > 0) {
      grandTotals.income += transaction.amount;
      grandTotals.net += transaction.amount;
    } else if (transaction.amount < 0) {
      const expense = Math.abs(transaction.amount);
      grandTotals.expense += expense;
      grandTotals.net += transaction.amount;
    }

    const ruleId = extractRecurringRuleId(transaction.external_id ?? null);
    if (ruleId !== null) {
      const key = `${ruleId}:${date}`;
      confirmedOccurrences.add(key);
      transaction.recurring_rule_id = ruleId;
      transaction.recurring_rule_name = ruleNameMap.get(ruleId) ?? null;
    }
  }

  for (const occurrence of occurrences) {
    const date = normaliseDate(occurrence.date);
    const confirmedKey = `${occurrence.ruleId}:${date}`;
    if (confirmedOccurrences.has(confirmedKey)) {
      continue;
    }
    const bucket = ensureBucket(byDate, date);
    accumulateOccurrence(bucket, occurrence, grandTotals);
  }

  for (const event of events) {
    const date = normaliseDate(event.date);
    const bucket = ensureBucket(byDate, date);
    accumulateEvent(bucket, event);
  }

  for (const holiday of holidays) {
    const date = normaliseDate(holiday.date);
    const bucket = ensureBucket(byDate, date);
    accumulateHoliday(bucket, holiday);
  }

  const dates = Object.keys(byDate).sort();
  // 정렬된 버킷에서 트랜잭션/반복/이벤트도 보기 좋게 정렬
  for (const date of dates) {
    const bucket = byDate[date];
    bucket.transactions.sort((a, b) => {
      const timeA = a.occurred_time ?? "";
      const timeB = b.occurred_time ?? "";
      if (timeA === timeB) {
        return a.id - b.id;
      }
      return timeA.localeCompare(timeB);
    });
    bucket.recurring.sort((a, b) => a.ruleName.localeCompare(b.ruleName));
    bucket.events.sort((a, b) => a.title.localeCompare(b.title));
    bucket.holidays.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    range: { start: params.start, end: params.end },
    transactions,
    recurringOccurrences: occurrences,
    events,
    holidays,
    byDate,
    dates,
    totals: cloneTotals(grandTotals),
  };
}

export function composeCalendarSnapshot(
  params: CalendarRangeParams,
  transactions: CalendarTransaction[],
  occurrences: RecurringOccurrence[],
  events: CalendarEvent[],
  holidays: CalendarHoliday[]
): CalendarSnapshot {
  return buildSnapshot(params, transactions, occurrences, events, holidays);
}

export async function fetchCalendarSnapshot(params: CalendarRangeParams): Promise<CalendarSnapshot> {
  const [transactions, occurrences, events, holidays] = await Promise.all([
    fetchTransactions(params),
    fetchRecurringOccurrences(params),
    loadCalendarEvents(params.userId, params.start, params.end),
    loadCalendarHolidays(params.start, params.end),
  ]);

  return buildSnapshot(params, transactions, occurrences, events, holidays);
}

export function useCalendarData(params: CalendarRangeParams): UseCalendarDataResult {
  const [state, setState] = useState<UseCalendarDataState>({ status: "idle" });
  const [version, setVersion] = useState(0);

  const { start, end, userId } = params;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetchCalendarSnapshot({ userId, start, end })
      .then((snapshot) => {
        if (cancelled) return;
        setState({ status: "success", data: snapshot });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      });

    return () => {
      cancelled = true;
    };
  }, [userId, start, end, version]);

  const refresh = () => {
    setVersion((prev) => prev + 1);
  };

  return {
    ...state,
    refresh,
  };
}
