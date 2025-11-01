"use client";

import type { CSSProperties } from "react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import type { AccountTimelinePoint, AccountTimelineSeries } from "@/lib/statistics/types";

function formatCurrency(amount: number) {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

type Props = {
  loading: boolean;
  series: AccountTimelineSeries[];
};

function summarizeSeries(series: AccountTimelineSeries) {
  if (series.points.length === 0) {
    return { start: 0, end: 0, delta: 0 };
  }
  const start = series.points[0]?.runningTotal ?? 0;
  const end = series.points[series.points.length - 1]?.runningTotal ?? 0;
  return {
    start,
    end,
    delta: end - start,
  };
}

const tooltipStyle: CSSProperties = {
  borderRadius: "0.5rem",
  boxShadow: "0 10px 25px rgba(15, 23, 42, 0.08)",
  border: "1px solid rgba(226, 232, 240, 0.7)",
  backgroundColor: "#fff",
  padding: "0.75rem",
};

const MAX_POINTS = 180;

function downsample(points: AccountTimelinePoint[], maxPoints = MAX_POINTS): AccountTimelinePoint[] {
  if (points.length <= maxPoints) {
    return points;
  }
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_: AccountTimelinePoint, index: number) => index % step === 0 || index === points.length - 1);
}

export function AccountTimelineCard({ loading, series }: Props) {
  return (
    <section className="space-y-3 rounded border bg-white p-4 shadow-sm">
      <header>
        <h2 className="text-sm font-semibold text-gray-800">계좌별 흐름</h2>
        <p className="text-xs text-gray-500">일별 누적 잔액 변화를 간소화해 표시합니다.</p>
      </header>
      {loading && series.length === 0 && <p className="text-xs text-gray-500">불러오는 중…</p>}
      {!loading && series.length === 0 && <p className="text-xs text-gray-400">표시할 계좌 데이터가 없습니다.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {series.map((item) => {
          const summary = summarizeSeries(item);
          const compressedPoints = downsample(item.points);
          const chartData = compressedPoints.map((point: AccountTimelinePoint, index: number) => ({
            occurredAt: point.occurredAt,
            runningTotal: point.runningTotal,
            netChange: point.netChange,
            order: index,
          }));

          return (
            <article key={item.accountId} className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span className="font-medium text-gray-800">{item.accountName}</span>
                <span>{item.currency}</span>
              </div>
              <p className="text-sm text-gray-700">
                시작 {formatCurrency(summary.start)} → 종료 {formatCurrency(summary.end)}
              </p>
              <p className={summary.delta >= 0 ? "text-xs text-green-700" : "text-xs text-red-700"}>
                변화 {formatCurrency(summary.delta)}
              </p>
              {chartData.length > 0 ? (
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="occurredAt" stroke="#475569" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis
                        stroke="#475569"
                        tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value: number, name) => {
                          const labelMap: Record<string, string> = {
                            runningTotal: "누적 잔액",
                            netChange: "순 변화",
                          };
                          return [`${formatCurrency(value)}원`, labelMap[name] ?? name];
                        }}
                      />
                      <ReferenceLine y={0} stroke="#cbd5f5" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="runningTotal" name="누적 잔액" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-[11px] text-gray-500">표시할 데이터가 없습니다.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
