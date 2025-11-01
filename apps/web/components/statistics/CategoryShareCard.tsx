"use client";

import type { CSSProperties } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import type { CategoryShareDatum } from "@/lib/statistics/types";

const COLORS = ["#0ea5e9", "#6366f1", "#22c55e", "#f97316", "#a855f7", "#14b8a6", "#facc15", "#f43f5e"];
const MAX_SLICES = 8;

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCurrency(amount: number) {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const tooltipStyle: CSSProperties = {
  borderRadius: "0.5rem",
  boxShadow: "0 10px 25px rgba(15, 23, 42, 0.08)",
  border: "1px solid rgba(226, 232, 240, 0.7)",
  backgroundColor: "#fff",
  padding: "0.75rem",
};

type Props = {
  loading: boolean;
  data: CategoryShareDatum[];
};

type ChartSlice = {
  name: string;
  amount: number;
  percentage: number;
  key: string;
};

function buildSlices(items: CategoryShareDatum[], keyPrefix: string): ChartSlice[] {
  if (items.length === 0) {
    return [];
  }
  const total = items.reduce((sum, item) => sum + item.amount, 0) || 1;
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  if (sorted.length <= MAX_SLICES) {
    return sorted.map((item) => ({
      name: item.categoryGroupName,
      amount: item.amount,
      percentage: item.amount / total,
      key: `${keyPrefix}-${item.categoryGroupId ?? "uncategorized"}-${item.type}-${item.categoryGroupName}`,
    }));
  }

  const keepCount = MAX_SLICES - 1;
  const head = sorted.slice(0, keepCount).map((item) => ({
    name: item.categoryGroupName,
    amount: item.amount,
    percentage: item.amount / total,
    key: `${keyPrefix}-${item.categoryGroupId ?? "uncategorized"}-${item.type}-${item.categoryGroupName}`,
  }));
  const tailAmount = sorted.slice(keepCount).reduce((sum, item) => sum + item.amount, 0);
  const tailPercentage = tailAmount / total;
  return [
    ...head,
    {
      name: "기타",
      amount: tailAmount,
      percentage: tailPercentage,
      key: `${keyPrefix}-others`,
    },
  ];
}

export function CategoryShareCard({ loading, data }: Props) {
  const incomeData = data.filter((item) => item.type === "INCOME");
  const expenseData = data.filter((item) => item.type === "EXPENSE");

  const incomeSlices = buildSlices(incomeData, "income");
  const expenseSlices = buildSlices(expenseData, "expense");

  return (
    <section className="space-y-4 rounded border bg-white p-4 shadow-sm">
      <header>
        <h2 className="text-sm font-semibold text-gray-800">카테고리 비중</h2>
        <p className="text-xs text-gray-500">수입/지출을 분리해 주요 비중을 확인합니다.</p>
      </header>

      {loading && data.length === 0 && <p className="text-xs text-gray-500">불러오는 중…</p>}
      {!loading && data.length === 0 && <p className="text-xs text-gray-400">표시할 데이터가 없습니다.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-emerald-600">수입</h3>
          {incomeSlices.length === 0 ? (
            <p className="text-xs text-gray-400">수입 데이터가 없습니다.</p>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={incomeSlices} dataKey="amount" nameKey="name" innerRadius={50} outerRadius={80}>
                    {incomeSlices.map((slice, index) => (
                      <Cell key={slice.key} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number, name, payload) => {
                      const percentage = payload?.payload?.percentage ?? 0;
                      return [`${formatCurrency(value)}원 (${formatPercent(percentage)})`, name];
                    }}
                  />
                  <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-rose-600">지출 (대분류)</h3>
          {expenseSlices.length === 0 ? (
            <p className="text-xs text-gray-400">지출 데이터가 없습니다.</p>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={expenseSlices} dataKey="amount" nameKey="name" innerRadius={50} outerRadius={80}>
                    {expenseSlices.map((slice, index) => (
                      <Cell key={slice.key} fill={COLORS[(index + 3) % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number, name, payload) => {
                      const percentage = payload?.payload?.percentage ?? 0;
                      return [`${formatCurrency(value)}원 (${formatPercent(percentage)})`, name];
                    }}
                  />
                  <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
