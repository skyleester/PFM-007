"use client";

import type { CSSProperties } from "react";
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar, Line } from "recharts";
import type { MonthlyFlowDatum } from "@/lib/statistics/types";

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
  data: MonthlyFlowDatum[];
};

export function MonthlyFlowCard({ loading, data }: Props) {
  const chartData = data.map((item) => ({
    month: item.month,
    income: item.income,
    expense: item.expense,
    net: item.net,
  }));

  return (
    <section className="space-y-3 rounded border bg-white p-4 shadow-sm">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">월별 수입/지출</h2>
          <p className="text-xs text-gray-500">수입/지출을 막대, 순 변화를 꺾은선으로 비교합니다.</p>
        </div>
      </header>
      {loading && chartData.length === 0 && <p className="text-xs text-gray-500">불러오는 중…</p>}
      {!loading && chartData.length === 0 && <p className="text-xs text-gray-400">표시할 월별 집계가 없습니다.</p>}
      {chartData.length > 0 && (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" stroke="#475569" tick={{ fontSize: 12 }} />
              <YAxis
                stroke="#475569"
                tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name) => {
                  const labelMap: Record<string, string> = {
                    income: "수입",
                    expense: "지출",
                    net: "순 변화",
                  };
                  return [`${formatCurrency(value)}원`, labelMap[name] ?? name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name="수입" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="지출" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="net" name="순 변화" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
