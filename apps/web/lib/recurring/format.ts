import type { RecurringRule } from "./types";

const WEEKDAY_LABELS = "일월화수목금토";

type RuleLike = Pick<RecurringRule, "type" | "frequency" | "day_of_month" | "weekday" | "amount" | "currency" | "is_variable_amount">;

type RuleType = RuleLike["type"];

type FrequencyType = RuleLike["frequency"];

export function formatTxnTypeLabel(type: RuleType): string {
  switch (type) {
    case "INCOME":
      return "수입";
    case "EXPENSE":
      return "지출";
    case "TRANSFER":
      return "이체";
    default:
      return type;
  }
}

export function describeFrequency(rule: Pick<RuleLike, "frequency" | "day_of_month" | "weekday">): string {
  const frequency = rule.frequency as FrequencyType;
  switch (frequency) {
    case "DAILY":
      return "매일";
    case "WEEKLY": {
      const index = rule.weekday ?? 0;
      const label = WEEKDAY_LABELS[index] ?? "";
      return label ? `매주 ${label}요일` : "매주";
    }
    case "MONTHLY": {
      const day = rule.day_of_month;
      return day ? `매월 ${day}일` : "매월";
    }
    case "YEARLY":
      return "매년";
    default:
      return frequency;
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) {
    return value;
  }
  return asDate.toLocaleDateString("ko-KR");
}

export function formatCurrency(value: number, currency: string): string {
  const formatter = new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  return formatter.format(value);
}

export function formatRuleAmount(rule: Pick<RuleLike, "type" | "amount" | "currency" | "is_variable_amount">): string {
  if (rule.is_variable_amount) {
    return "변동";
  }
  const amount = rule.amount ?? 0;
  const base = formatCurrency(Math.abs(amount), rule.currency);
  if (rule.type === "EXPENSE") {
    return `- ${base}`;
  }
  if (rule.type === "INCOME") {
    return `+ ${base}`;
  }
  return base;
}

export type AmountTrendSummary = {
  direction: "increase" | "decrease" | "flat";
  delta: number;
  formattedDelta: string;
};

export function formatFrequencyComparisonLabel(frequency: FrequencyType): string {
  switch (frequency) {
    case "DAILY":
      return "전일 대비";
    case "WEEKLY":
      return "전주 대비";
    case "MONTHLY":
      return "전월 대비";
    case "YEARLY":
      return "전년 대비";
    default:
      return "이전 대비";
  }
}

export function summariseAmountTrend(
  current: number | null | undefined,
  previous: number | null | undefined,
  currency: string,
): AmountTrendSummary | null {
  if (current == null || previous == null) {
    return null;
  }

  const delta = current - previous;
  if (delta === 0) {
    return {
      direction: "flat",
      delta,
      formattedDelta: formatCurrency(0, currency),
    };
  }

  return {
    direction: delta > 0 ? "increase" : "decrease",
    delta,
    formattedDelta: formatCurrency(Math.abs(delta), currency),
  };
}
