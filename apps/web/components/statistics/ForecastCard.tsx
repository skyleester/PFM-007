import type { Forecast } from "@/lib/statistics/types";

function formatCurrency(amount: number) {
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}원`;
}

type Props = {
  loading: boolean;
  data: Forecast | null;
};

export function ForecastCard({ loading, data }: Props) {
  return (
    <section className="rounded border bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">다음 달 예상</h2>
          <p className="text-xs text-gray-500">최근 실적을 기반으로 단순 예측한 다음 달 수입과 지출입니다.</p>
        </div>
        {data && (
          <span className="rounded bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-600">
            기준: {data.methodology === "three_month_average" ? "최근 3개월 평균" : "단순 평균"}
          </span>
        )}
      </header>
      {loading && !data ? (
        <p className="mt-3 text-sm text-gray-400">예상치를 계산하는 중입니다…</p>
      ) : data ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ForecastMetric label="예상 수입" value={data.nextMonthIncome} />
          <ForecastMetric label="예상 지출" value={data.nextMonthExpense} />
          <ForecastMetric
            label="예상 순손익"
            value={data.nextMonthNet}
            highlight={data.nextMonthNet >= 0 ? "positive" : "negative"}
          />
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-400">예측할 데이터가 부족합니다.</p>
      )}
    </section>
  );
}

type ForecastMetricProps = {
  label: string;
  value: number;
  highlight?: "positive" | "negative";
};

function ForecastMetric({ label, value, highlight }: ForecastMetricProps) {
  const className = highlight === "positive" ? "text-emerald-600" : highlight === "negative" ? "text-rose-600" : "text-gray-900";
  return (
    <article className="space-y-1 rounded border bg-gray-50 p-3">
      <p className="text-xs font-semibold text-gray-600">{label}</p>
      <p className={`text-lg font-semibold ${className}`}>{formatCurrency(value)}</p>
    </article>
  );
}
