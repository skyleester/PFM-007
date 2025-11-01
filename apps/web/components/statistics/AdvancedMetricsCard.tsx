import type { AdvancedKpis } from "@/lib/statistics/types";

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "-";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}원`;
}

function formatPercentage(value: number | null | undefined) {
  if (value == null) return "-";
  return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

type Props = {
  loading: boolean;
  data: AdvancedKpis | null;
};

export function AdvancedMetricsCard({ loading, data }: Props) {
  const runwayLabel = (() => {
    if (!data?.projectedRunwayDays) return "-";
    const days = Math.floor(data.projectedRunwayDays);
    return days > 0 ? `${days.toLocaleString()}일` : "1일 미만";
  })();

  const runoutDate = data?.projectedRunoutDate ?? null;

  return (
    <section className="rounded border bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">재무 심층 지표</h2>
          <p className="text-xs text-gray-500">저축률과 잔고 소진 예상 시점, 지출 집중도를 한눈에 확인하세요.</p>
        </div>
      </header>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="저축률" value={formatPercentage(data?.savingsRate)} loading={loading} />
        <MetricCard title="지출 대비 순손익" value={formatPercentage(data?.savingsToExpenseRatio)} loading={loading} />
        <MetricCard title="일 평균 순손익" value={formatCurrency(data?.averageDailyNet ?? null)} loading={loading} />
        <MetricCard title="잔고 소진 예상" value={runwayLabel} subtitle={runoutDate ? `예상 소진일 ${runoutDate}` : undefined} loading={loading} />
        <MetricCard title="가용 잔액" value={formatCurrency(data?.totalLiquidBalance ?? null)} loading={loading} />
        <MetricCard
          title="지출 집중도 지수"
          value={data ? data.expenseConcentrationIndex.toFixed(3) : "-"}
          subtitle={data ? concentrationLabel[data.expenseConcentrationLevel] : undefined}
          loading={loading}
        />
      </div>
      <div className="mt-5">
        <p className="text-xs font-semibold text-gray-600">변동성이 큰 계좌</p>
        {loading && !data && <p className="mt-2 text-xs text-gray-400">데이터를 불러오는 중입니다…</p>}
        {!loading && (!data || data.accountVolatility.length === 0) && (
          <p className="mt-2 text-xs text-gray-400">변동성 데이터가 아직 없습니다.</p>
        )}
        {data && data.accountVolatility.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-gray-700">
            {data.accountVolatility.slice(0, 5).map((item) => {
              const stddev = Math.round(item.dailyStddev);
              return (
                <li key={item.accountId} className="flex items-center justify-between rounded border px-3 py-1">
                  <span className="truncate font-medium text-gray-800">{item.accountName}</span>
                  <span className="ml-3 text-[11px] text-gray-500">일 변동 표준편차 {stddev.toLocaleString()}원</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

type MetricCardProps = {
  title: string;
  value: string;
  loading: boolean;
  subtitle?: string;
};

function MetricCard({ title, value, subtitle, loading }: MetricCardProps) {
  return (
    <article className="space-y-1 rounded border bg-gray-50 p-3">
      <p className="text-xs font-semibold text-gray-600">{title}</p>
      {loading ? (
        <p className="text-sm text-gray-400">불러오는 중…</p>
      ) : (
        <p className="text-lg font-semibold text-gray-900">{value}</p>
      )}
      {subtitle && <p className="text-[11px] text-gray-500">{subtitle}</p>}
    </article>
  );
}

const concentrationLabel: Record<"low" | "moderate" | "high", string> = {
  low: "분산됨",
  moderate: "보통 집중",
  high: "고도 집중",
};
