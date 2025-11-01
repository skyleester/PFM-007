"use client";

import { useMemo } from "react";
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Legend } from "recharts";

import type { RecurringCoverage } from "@/lib/statistics/types";
import type { IncomeAlert } from "@/lib/statistics/types";

function formatPercentage(value: number | null) {
  if (value == null) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

type Props = {
  loading: boolean;
  coverage: RecurringCoverage | null;
  alerts: IncomeAlert[];
};

export function RecurringCoverageCard({ loading, coverage, alerts }: Props) {
  const summaryChart = useMemo(() => buildSummaryChart(coverage), [coverage]);
  const uncoveredChart = useMemo(() => buildUncoveredChart(coverage?.uncoveredRules ?? []), [coverage?.uncoveredRules]);

  return (
    <section className="rounded border bg-white p-4 shadow-sm">
      <header>
        <h2 className="text-sm font-semibold text-gray-800">정기 거래 커버리지</h2>
        <p className="text-xs text-gray-500">등록된 정기 거래가 실제 거래와 얼마나 일치하는지 확인합니다.</p>
      </header>
      {loading && !coverage ? (
        <p className="mt-3 text-sm text-gray-400">데이터를 불러오는 중입니다…</p>
      ) : coverage ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <CoverageMetric label="전체 커버리지" value={formatPercentage(coverage.overallCoverageRate)} />
            <CoverageMetric label="수입 커버리지" value={formatPercentage(coverage.incomeCoverageRate)} />
            <CoverageMetric label="지출 커버리지" value={formatPercentage(coverage.expenseCoverageRate)} />
          </div>
          <p className="mt-3 text-[11px] text-gray-500">
            모니터링 대상 {coverage.rulesInWindow}/{coverage.totalRules}개 규칙
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <article className="rounded border bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-600">커버리지 요약</p>
              {summaryChart.length === 0 ? (
                <p className="mt-2 text-xs text-gray-400">요약 데이터를 표시할 수 없습니다.</p>
              ) : (
                <div className="mt-3 h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summaryChart} layout="vertical" margin={{ top: 12, right: 16, left: 0, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} />
                      <YAxis dataKey="label" type="category" width={80} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => [`${value}%`, "커버리지"]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="value" name="커버리지" fill="#2563eb" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>

            <article className="rounded border bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-600">커버리지 미달 규칙</p>
              {uncoveredChart.length === 0 ? (
                <p className="mt-2 text-xs text-gray-400">추가 확인이 필요한 규칙이 없습니다.</p>
              ) : (
                <div className="mt-3 h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={uncoveredChart} layout="vertical" margin={{ top: 12, right: 16, left: 0, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} />
                      <YAxis dataKey="label" type="category" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => [`${value}%`, "커버리지"]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="value" name="커버리지" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-600">정기 수입 지연 경고</p>
              {alerts.length === 0 ? (
                <p className="mt-2 text-xs text-gray-400">예상 대비 누락된 정기 수입이 없습니다.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs text-gray-700">
                  {alerts.map((alert) => (
                    <li key={alert.ruleId} className="rounded border border-amber-200 bg-amber-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold text-amber-700">{alert.ruleName}</p>
                          <p className="text-[11px] text-amber-600">예상일 {alert.expectedDate} · 최근 수취일 {alert.lastSeenDate ?? "없음"}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-amber-700">지연 {alert.delayDays}일</p>
                          {alert.amountHint != null && (
                            <p className="text-[10px] text-amber-600">예상 금액 {alert.amountHint.toLocaleString()}원</p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-xs font-semibold text-gray-600">추가 확인이 필요한 규칙</p>
            {coverage.uncoveredRules.length === 0 ? (
              <p className="mt-2 text-xs text-gray-400">모든 정기 거래가 예상대로 발생하고 있습니다.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-xs text-gray-700">
                {coverage.uncoveredRules.map((rule) => (
                  <li key={rule.ruleId} className="rounded border bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-800">{rule.ruleName}</p>
                        <p className="text-[11px] text-gray-500">{rule.type === "INCOME" ? "수입" : "지출"} · {rule.frequency}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-rose-600">커버리지 {formatPercentage(rule.coverageRate)}</p>
                        <p className="text-[10px] text-gray-500">{rule.actualOccurrences}/{rule.expectedOccurrences}건 매칭</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-gray-400">정기 거래 데이터가 없습니다.</p>
      )}
    </section>
  );
}

type MetricProps = {
  label: string;
  value: string;
};

function CoverageMetric({ label, value }: MetricProps) {
  return (
    <article className="space-y-1 rounded border bg-gray-50 p-3">
      <p className="text-xs font-semibold text-gray-600">{label}</p>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
    </article>
  );
}

type SummaryChartDatum = {
  label: string;
  value: number;
};

function buildSummaryChart(coverage: RecurringCoverage | null): SummaryChartDatum[] {
  if (!coverage) {
    return [];
  }
  const entries: Array<[string, number | null]> = [
    ["전체", coverage.overallCoverageRate],
    ["수입", coverage.incomeCoverageRate],
    ["지출", coverage.expenseCoverageRate],
  ];
  return entries
    .filter((entry): entry is [string, number] => entry[1] != null)
    .map(([label, value]) => ({ label, value: Math.round(value * 1000) / 10 }))
    .sort((a, b) => b.value - a.value);
}

type UncoveredChartDatum = {
  label: string;
  value: number;
};

function buildUncoveredChart(items: RecurringCoverage["uncoveredRules"]): UncoveredChartDatum[] {
  return items
    .map((item) => ({
      label: item.ruleName,
      value: Math.round((item.coverageRate ?? 0) * 1000) / 10,
    }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 8);
}
