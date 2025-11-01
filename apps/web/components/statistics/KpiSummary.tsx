import type { StatisticsKPIs } from "@/lib/statistics/types";

function formatCurrency(amount: number) {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

type Props = {
  loading: boolean;
  kpis: StatisticsKPIs | null;
};

const KPI_ITEMS: Array<{ key: keyof StatisticsKPIs; label: string; suffix?: string }> = [
  { key: "totalExpense", label: "총 지출" },
  { key: "totalIncome", label: "총 수입" },
  { key: "net", label: "순 지출" },
  { key: "averageDailyExpense", label: "일 평균 지출" },
  { key: "transactionCount", label: "거래 건수", suffix: "건" },
];

export function KpiSummary({ loading, kpis }: Props) {
  return (
    <section className="grid gap-4 rounded border bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
      {KPI_ITEMS.map((item) => {
        const value = kpis ? kpis[item.key] : null;
        const isCurrency = item.key !== "transactionCount";
        return (
          <article key={item.key} className="space-y-1">
            <p className="text-xs text-gray-500">{item.label}</p>
            <p className="text-xl font-semibold text-gray-900">
              {loading && value === null && <span className="text-sm text-gray-400">불러오는 중…</span>}
              {!loading && value === null && <span className="text-sm text-gray-400">-</span>}
              {value != null && (
                <span>
                  {isCurrency ? `${formatCurrency(Number(value))}원` : `${value}${item.suffix ?? ""}`}
                </span>
              )}
            </p>
          </article>
        );
      })}
      <article className="sm:col-span-2 lg:col-span-1">
        <p className="text-xs text-gray-500">최대 지출 카테고리</p>
        {loading && <p className="text-sm text-gray-400">불러오는 중…</p>}
        {!loading && kpis?.topExpenseCategory && (
          <p className="text-sm font-medium text-gray-900">
            {kpis.topExpenseCategory.categoryGroupName}
            <span className="ml-1 text-xs text-gray-500">
              {formatCurrency(kpis.topExpenseCategory.amount)}원
            </span>
          </p>
        )}
        {!loading && !kpis?.topExpenseCategory && <p className="text-sm text-gray-400">데이터 없음</p>}
      </article>
    </section>
  );
}
