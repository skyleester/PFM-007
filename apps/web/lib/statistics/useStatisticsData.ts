"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CategoryShareDatum,
  StatisticsFilters,
  StatisticsOverview,
} from "./types";

export type UseStatisticsDataResult = {
  loading: boolean;
  error: string | null;
  data: StatisticsOverview | null;
  refresh: () => void;
};

const API_BASE = () => process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

type AnalyticsFiltersResponse = {
  start: string | null;
  end: string | null;
  account_id: number | null;
  include_transfers: boolean;
  include_settlements?: boolean;
  excluded_category_ids: number[];
};

type AnalyticsMonthlyFlowResponse = {
  month: string;
  income: number;
  expense: number;
  net: number;
};

type AnalyticsCategoryShareResponse = {
  category_group_id: number | null;
  category_group_name: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  percentage: number;
};

type AnalyticsTimelinePointResponse = {
  occurred_at: string;
  net_change: number;
  running_total: number;
};

type AnalyticsTimelineSeriesResponse = {
  account_id: number;
  account_name: string;
  currency: string | null;
  points: AnalyticsTimelinePointResponse[];
};

type AnalyticsKpisResponse = {
  total_income: number;
  total_expense: number;
  net: number;
  average_daily_expense: number;
  transaction_count: number;
  top_expense_category: AnalyticsCategoryShareResponse | null;
};

type AnalyticsInsightResponse = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "positive";
};

type AnalyticsAccountRefResponse = {
  id: number;
  name: string;
  currency: string | null;
};

type AnalyticsAccountVolatilityItemResponse = {
  account_id: number;
  account_name: string;
  currency: string | null;
  average_daily_change: number;
  daily_stddev: number;
  total_change: number;
};

type AnalyticsAdvancedKpisResponse = {
  savings_rate: number | null;
  savings_to_expense_ratio: number | null;
  average_daily_net: number;
  projected_runway_days: number | null;
  projected_runout_date: string | null;
  total_liquid_balance: number;
  expense_concentration_index: number;
  expense_concentration_level: "low" | "moderate" | "high";
  account_volatility: AnalyticsAccountVolatilityItemResponse[];
};

type AnalyticsCategoryTrendItemResponse = {
  category_group_id: number | null;
  category_group_name: string;
  type: "INCOME" | "EXPENSE";
  month: string;
  amount: number;
  previous_month_amount: number | null;
  mom_change: number | null;
  qoq_change: number | null;
  yoy_change: number | null;
};

type AnalyticsCategoryMomentumResponse = {
  top_rising: AnalyticsCategoryTrendItemResponse[];
  top_falling: AnalyticsCategoryTrendItemResponse[];
};

type AnalyticsHeatmapBucketResponse = {
  day_of_week: number;
  hour: number;
  amount: number;
};

type AnalyticsWeeklyHeatmapResponse = {
  buckets: AnalyticsHeatmapBucketResponse[];
  max_value: number;
};

type AnalyticsAnomalyResponse = {
  transaction_id: number;
  occurred_at: string;
  account_id: number;
  account_name: string;
  category_group_name: string;
  amount: number;
  z_score: number;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  memo: string | null;
};

type AnalyticsIncomeAlertResponse = {
  rule_id: number;
  rule_name: string;
  expected_date: string;
  last_seen_date: string | null;
  delay_days: number;
  account_name: string;
  amount_hint: number | null;
};

type AnalyticsRecurringCoverageItemResponse = {
  rule_id: number;
  rule_name: string;
  type: "INCOME" | "EXPENSE";
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  expected_occurrences: number;
  actual_occurrences: number;
  coverage_rate: number;
};

type AnalyticsRecurringCoverageResponse = {
  total_rules: number;
  rules_in_window: number;
  overall_coverage_rate: number | null;
  income_coverage_rate: number | null;
  expense_coverage_rate: number | null;
  uncovered_rules: AnalyticsRecurringCoverageItemResponse[];
};

type AnalyticsForecastResponse = {
  next_month_income: number;
  next_month_expense: number;
  next_month_net: number;
  methodology: string;
};

type AnalyticsOverviewResponse = {
  filters: AnalyticsFiltersResponse;
  kpis: AnalyticsKpisResponse;
  monthly_flow: AnalyticsMonthlyFlowResponse[];
  category_share: AnalyticsCategoryShareResponse[];
  account_timeline: AnalyticsTimelineSeriesResponse[];
  insights: AnalyticsInsightResponse[];
  accounts: AnalyticsAccountRefResponse[];
  advanced: AnalyticsAdvancedKpisResponse;
  category_trends: AnalyticsCategoryTrendItemResponse[];
  category_momentum: AnalyticsCategoryMomentumResponse;
  weekly_heatmap: AnalyticsWeeklyHeatmapResponse;
  expense_anomalies: AnalyticsAnomalyResponse[];
  income_alerts: AnalyticsIncomeAlertResponse[];
  recurring_coverage: AnalyticsRecurringCoverageResponse;
  forecast: AnalyticsForecastResponse;
};

function normalizeFilters(filters: AnalyticsFiltersResponse): StatisticsFilters {
  return {
    start: filters.start ?? "",
    end: filters.end ?? "",
    accountId: filters.account_id,
    includeTransfers: filters.include_transfers,
    includeSettlements: filters.include_settlements ?? false,
    excludedCategoryIds: filters.excluded_category_ids ?? [],
  };
}

function toCategoryShare(item: AnalyticsCategoryShareResponse): CategoryShareDatum {
  return {
    categoryGroupId: item.category_group_id,
    categoryGroupName: item.category_group_name,
    type: item.type,
    amount: item.amount,
    percentage: item.percentage,
  } satisfies CategoryShareDatum;
}

function mapOverview(response: AnalyticsOverviewResponse): StatisticsOverview {
  const categoryShare = response.category_share.map(toCategoryShare);

  return {
    filters: normalizeFilters(response.filters),
    kpis: {
      totalIncome: response.kpis.total_income,
      totalExpense: response.kpis.total_expense,
      net: response.kpis.net,
      averageDailyExpense: response.kpis.average_daily_expense,
      transactionCount: response.kpis.transaction_count,
      topExpenseCategory: response.kpis.top_expense_category
        ? toCategoryShare(response.kpis.top_expense_category)
        : null,
    },
    monthlyFlow: response.monthly_flow.map((item) => ({
      month: item.month,
      income: item.income,
      expense: item.expense,
      net: item.net,
    })),
    categoryShare,
    accountTimeline: response.account_timeline.map((series) => ({
      accountId: series.account_id,
      accountName: series.account_name,
      currency: series.currency ?? "KRW",
      points: series.points.map((point) => ({
        occurredAt: point.occurred_at,
        netChange: point.net_change,
        runningTotal: point.running_total,
      })),
    })),
    insights: response.insights.map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      severity: item.severity,
    })),
    accounts: response.accounts.map((acc) => ({
      id: acc.id,
      name: acc.name,
      currency: acc.currency ?? "KRW",
    })),
    advanced: {
      savingsRate: response.advanced.savings_rate,
      savingsToExpenseRatio: response.advanced.savings_to_expense_ratio,
      averageDailyNet: response.advanced.average_daily_net,
      projectedRunwayDays: response.advanced.projected_runway_days,
      projectedRunoutDate: response.advanced.projected_runout_date,
      totalLiquidBalance: response.advanced.total_liquid_balance,
      expenseConcentrationIndex: response.advanced.expense_concentration_index,
      expenseConcentrationLevel: response.advanced.expense_concentration_level,
      accountVolatility: response.advanced.account_volatility.map((item) => ({
        accountId: item.account_id,
        accountName: item.account_name,
        currency: item.currency,
        averageDailyChange: item.average_daily_change,
        dailyStddev: item.daily_stddev,
        totalChange: item.total_change,
      })),
    },
    categoryTrends: response.category_trends.map((item) => ({
      categoryGroupId: item.category_group_id,
      categoryGroupName: item.category_group_name,
      type: item.type,
      month: item.month,
      amount: item.amount,
      previousMonthAmount: item.previous_month_amount,
      momChange: item.mom_change,
      qoqChange: item.qoq_change,
      yoyChange: item.yoy_change,
    })),
    categoryMomentum: {
      topRising: response.category_momentum.top_rising.map((item) => ({
        categoryGroupId: item.category_group_id,
        categoryGroupName: item.category_group_name,
        type: item.type,
        month: item.month,
        amount: item.amount,
        previousMonthAmount: item.previous_month_amount,
        momChange: item.mom_change,
        qoqChange: item.qoq_change,
        yoyChange: item.yoy_change,
      })),
      topFalling: response.category_momentum.top_falling.map((item) => ({
        categoryGroupId: item.category_group_id,
        categoryGroupName: item.category_group_name,
        type: item.type,
        month: item.month,
        amount: item.amount,
        previousMonthAmount: item.previous_month_amount,
        momChange: item.mom_change,
        qoqChange: item.qoq_change,
        yoyChange: item.yoy_change,
      })),
    },
    weeklyHeatmap: {
      buckets: response.weekly_heatmap.buckets.map((bucket) => ({
        dayOfWeek: bucket.day_of_week,
        hour: bucket.hour,
        amount: bucket.amount,
      })),
      maxValue: response.weekly_heatmap.max_value,
    },
    expenseAnomalies: response.expense_anomalies.map((item) => ({
      transactionId: item.transaction_id,
      occurredAt: item.occurred_at,
      accountId: item.account_id,
      accountName: item.account_name,
      categoryGroupName: item.category_group_name,
      amount: item.amount,
      zScore: item.z_score,
      type: item.type,
      memo: item.memo,
    })),
    incomeAlerts: response.income_alerts.map((item) => ({
      ruleId: item.rule_id,
      ruleName: item.rule_name,
      expectedDate: item.expected_date,
      lastSeenDate: item.last_seen_date,
      delayDays: item.delay_days,
      accountName: item.account_name,
      amountHint: item.amount_hint,
    })),
    recurringCoverage: {
      totalRules: response.recurring_coverage.total_rules,
      rulesInWindow: response.recurring_coverage.rules_in_window,
      overallCoverageRate: response.recurring_coverage.overall_coverage_rate,
      incomeCoverageRate: response.recurring_coverage.income_coverage_rate,
      expenseCoverageRate: response.recurring_coverage.expense_coverage_rate,
      uncoveredRules: response.recurring_coverage.uncovered_rules.map((item) => ({
        ruleId: item.rule_id,
        ruleName: item.rule_name,
        type: item.type,
        frequency: item.frequency,
        expectedOccurrences: item.expected_occurrences,
        actualOccurrences: item.actual_occurrences,
        coverageRate: item.coverage_rate,
      })),
    },
    forecast: {
      nextMonthIncome: response.forecast.next_month_income,
      nextMonthExpense: response.forecast.next_month_expense,
      nextMonthNet: response.forecast.next_month_net,
      methodology: response.forecast.methodology,
    },
  } satisfies StatisticsOverview;
}

async function loadStatistics(filters: StatisticsFilters, signal: AbortSignal, userIds: number[]): Promise<StatisticsOverview> {
  const base = API_BASE();
  const url = new URL("/api/analytics/overview", base);
  const ids = (userIds && userIds.length > 0) ? userIds : [1];
  ids.forEach((id) => url.searchParams.append("user_id", String(id)));
  if (filters.start) url.searchParams.set("start", filters.start);
  if (filters.end) url.searchParams.set("end", filters.end);
  if (filters.accountId != null) url.searchParams.set("account_id", String(filters.accountId));
  url.searchParams.set("include_transfers", filters.includeTransfers ? "true" : "false");
  url.searchParams.set("include_settlements", filters.includeSettlements ? "true" : "false");

  const res = await fetch(url.toString(), { cache: "no-store", signal });
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const body = (await res.json()) as AnalyticsOverviewResponse;
  return mapOverview(body);
}

export function useStatisticsData(filters: StatisticsFilters, userIds: number[]): UseStatisticsDataResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StatisticsOverview | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const doLoad = useCallback(async (currentFilters: StatisticsFilters, signal: AbortSignal, users: number[]) => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadStatistics(currentFilters, signal, users);
      if (!signal.aborted) {
        setData(result);
      }
    } catch (err) {
      if (!signal.aborted) {
        const message = err instanceof Error ? err.message : "통계 데이터를 불러오지 못했습니다.";
        setError(message);
        setData(null);
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const users = userIds.length > 0 ? userIds : [1];
    void doLoad(filters, controller.signal, users);
    return () => {
      controller.abort();
    };
  }, [filters, userIds, refreshIndex, doLoad]);

  const refresh = useCallback(() => {
    setRefreshIndex((prev) => prev + 1);
  }, []);

  return useMemo(() => ({ loading, error, data, refresh }), [loading, error, data, refresh]);
}
