"use client";

import { useMemo } from "react";
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";

import type { CategoryMomentum } from "@/lib/statistics/types";

function formatPercentage(value: number | null) {
  if (value == null) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

type Props = {
  loading: boolean;
  momentum: CategoryMomentum | null;
};

export function CategoryMomentumCard({ loading, momentum }: Props) {
  const charts = useMemo(() => buildChartData(momentum), [momentum]);

  return (
    <section className="rounded border bg-white p-4 shadow-sm">
      <header>
        <h2 className="text-sm font-semibold text-gray-800">카테고리 모멘텀</h2>
        <p className="text-xs text-gray-500">최근 월 대비 큰 폭으로 오른/내린 지출 카테고리를 정리했습니다.</p>
      </header>
      {loading && !momentum ? (
        <p className="mt-3 text-sm text-gray-400">데이터를 불러오는 중입니다…</p>
      ) : momentum ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <MomentumChart
              title="상승 모멘텀"
              data={charts.rising}
              color="#22c55e"
              emptyText="상승한 카테고리가 없습니다."
            />
            <MomentumChart
              title="감소 모멘텀"
              data={charts.falling}
              color="#ef4444"
              emptyText="감소한 카테고리가 없습니다."
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <MomentumList title="상승 Top" items={momentum.topRising} emptyText="상승한 카테고리가 없습니다." />
            <MomentumList title="감소 Top" items={momentum.topFalling} emptyText="감소한 카테고리가 없습니다." negative />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-400">모멘텀 데이터를 계산할 수 없습니다.</p>
      )}
    </section>
  );
}

type MomentumListProps = {
  title: string;
  items: CategoryMomentum["topRising"];
  emptyText: string;
  negative?: boolean;
};

function MomentumList({ title, items, emptyText, negative }: MomentumListProps) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-600">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">{emptyText}</p>
      ) : (
        <ul className="mt-2 space-y-2 text-xs text-gray-700">
          {items.map((item) => (
            <li key={`${item.type}-${item.categoryGroupId ?? "none"}`}
              className="rounded border bg-gray-50 p-2">
              <p className="font-medium text-gray-800">{item.categoryGroupName}</p>
              <p className="text-[11px] text-gray-500">{item.month} 지출 {item.amount.toLocaleString()}원</p>
              {item.momChange != null && (
                <p className={`text-[11px] ${negative ? "text-emerald-600" : "text-rose-600"}`}>
                  전월 대비 {formatPercentage(item.momChange)}
                </p>
              )}
              {item.yoyChange != null && (
                <p className="text-[11px] text-gray-500">전년 동월 대비 {formatPercentage(item.yoyChange)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type MomentumChartProps = {
  title: string;
  data: MomentumChartDatum[];
  color: string;
  emptyText: string;
};

function MomentumChart({ title, data, color, emptyText }: MomentumChartProps) {
  return (
    <article className="rounded border bg-gray-50 p-3">
      <p className="text-xs font-semibold text-gray-600">{title}</p>
      {data.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">{emptyText}</p>
      ) : (
        <div className="mt-3 h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value: number) => [`${value}%`, "모멘텀"]} />
              <Legend formatter={() => "MoM 변화"} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="change" name="MoM 변화" fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </article>
  );
}

type MomentumChartDatum = {
  name: string;
  change: number;
};

function buildChartData(momentum: CategoryMomentum | null): { rising: MomentumChartDatum[]; falling: MomentumChartDatum[] } {
  if (!momentum) {
    return { rising: [], falling: [] };
  }

  const rising = normalizeItems(momentum.topRising).slice(0, 6);
  const falling = normalizeItems(momentum.topFalling, true).slice(0, 6);
  return {
    rising,
    falling,
  };
}

function normalizeItems(items: CategoryMomentum["topRising"], invert = false): MomentumChartDatum[] {
  return items
    .map((item) => {
      const baseChange = item.momChange ?? item.yoyChange ?? 0;
      const percent = Number.isFinite(baseChange) ? baseChange * 100 : 0;
      return {
        name: item.categoryGroupName,
        change: invert ? Math.round(percent * 10) / 10 : Math.round(percent * 10) / 10,
        inverted: invert,
      };
    })
    .filter((item) => item.change !== 0)
    .sort((a, b) => (invert ? a.change - b.change : b.change - a.change))
    .map((item) => ({
      name: item.name,
      change: invert ? Math.abs(item.change) * -1 : item.change,
    }));
}
