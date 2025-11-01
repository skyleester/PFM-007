"use client";

import { useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";
import type { CategoryTrendItem } from "@/lib/statistics/types";

const COLORS = ["#0ea5e9", "#6366f1", "#22c55e", "#f97316", "#a855f7", "#14b8a6", "#facc15", "#f43f5e"];

type Props = {
  loading: boolean;
  trends: CategoryTrendItem[];
};

type ChartDatum = {
  month: string;
  [categoryKey: string]: string | number;
};

type PreparedSeries = {
  type: "INCOME" | "EXPENSE";
  label: string;
  data: ChartDatum[];
  categories: Array<{ key: string; name: string }>;
};

export function CategoryTrendChart({ loading, trends }: Props) {
  const prepared = useMemo(() => buildSeries(trends), [trends]);

  const hasAnyData = prepared.some((item) => item.categories.length > 0 && item.data.length > 1);

  return (
    <section className="rounded border bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">카테고리 추세 차트</h2>
          <p className="text-xs text-gray-500">최근 월 지출/수입 상위 카테고리의 흐름을 꺾은선으로 확인합니다.</p>
        </div>
      </header>
      {loading && !hasAnyData ? (
        <p className="mt-4 text-sm text-gray-400">데이터를 불러오는 중입니다…</p>
      ) : !hasAnyData ? (
        <p className="mt-4 text-sm text-gray-400">표시할 카테고리 추세 데이터가 없습니다.</p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {prepared.map((item) => (
            <article key={item.type} className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-600">{item.label}</h3>
              {item.categories.length === 0 || item.data.length <= 1 ? (
                <p className="text-xs text-gray-400">표시할 데이터가 부족합니다.</p>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={item.data} margin={{ top: 16, right: 24, left: 8, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" stroke="#475569" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#475569" tickFormatter={(value) => formatYAxis(Number(value))} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number, name) => [
                          `${value.toLocaleString()}원`,
                          name,
                        ]}
                        labelFormatter={(label) => `${label}`}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {item.categories.map((category, index) => (
                        <Line
                          key={category.key}
                          type="monotone"
                          dataKey={category.key}
                          name={category.name}
                          stroke={COLORS[index % COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          activeDot={{ r: 4 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const MONTH_PARSE_CACHE = new Map<string, number>();

function toMonthOrder(value: string): number {
  const cached = MONTH_PARSE_CACHE.get(value);
  if (cached != null) {
    return cached;
  }
  const timestamp = Number(new Date(`${value}-01T00:00:00Z`).getTime());
  MONTH_PARSE_CACHE.set(value, timestamp);
  return timestamp;
}

function buildSeries(trends: CategoryTrendItem[]): PreparedSeries[] {
  const byType: Record<"INCOME" | "EXPENSE", CategoryTrendItem[]> = {
    INCOME: [],
    EXPENSE: [],
  };
  trends.forEach((item) => {
    if (item.type === "INCOME" || item.type === "EXPENSE") {
      byType[item.type].push(item);
    }
  });

  return (Object.entries(byType) as Array<["INCOME" | "EXPENSE", CategoryTrendItem[]]>).map(([type, list]) => {
    const series = prepareTypeSeries(list);
    const label = type === "INCOME" ? "수입 상위 추세" : "지출 상위 추세";
    return {
      type,
      label,
      ...series,
    };
  });
}

type PreparedTypeSeries = {
  data: ChartDatum[];
  categories: Array<{ key: string; name: string }>;
};

const MAX_CATEGORY_COUNT = 4;

function prepareTypeSeries(list: CategoryTrendItem[]): PreparedTypeSeries {
  if (list.length === 0) {
    return { data: [], categories: [] };
  }

  const byCategory = new Map<string, { name: string; months: Map<string, number> }>();
  list.forEach((item) => {
    const key = buildCategoryKey(item);
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        name: item.categoryGroupName,
        months: new Map(),
      });
    }
    byCategory.get(key)!.months.set(item.month, item.amount);
  });

  const sortedCategories = Array.from(byCategory.entries())
    .map(([key, value]) => {
      const latestAmount = Array.from(value.months.entries())
        .sort((a, b) => toMonthOrder(b[0]) - toMonthOrder(a[0]))[0]?.[1] ?? 0;
      const totalAbsolute = Array.from(value.months.values()).reduce((sum, amount) => sum + Math.abs(amount), 0);
      return {
        key,
        name: value.name,
        latestAmount,
        score: totalAbsolute + latestAmount * 0.5,
        months: value.months,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CATEGORY_COUNT);

  const monthSet = new Set<string>();
  sortedCategories.forEach((category) => {
    category.months.forEach((_value, month) => monthSet.add(month));
  });
  const months = Array.from(monthSet).sort((a, b) => toMonthOrder(a) - toMonthOrder(b));

  const data: ChartDatum[] = months.map((month) => {
    const entry: ChartDatum = { month };
    sortedCategories.forEach((category) => {
      entry[category.key] = category.months.get(month) ?? 0;
    });
    return entry;
  });

  const categories = sortedCategories.map((category) => ({ key: category.key, name: category.name }));
  return { data, categories };
}

function buildCategoryKey(item: CategoryTrendItem): string {
  const groupId = item.categoryGroupId ?? "uncategorized";
  return `${item.type}-${groupId}`;
}

function formatYAxis(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return value.toString();
}
