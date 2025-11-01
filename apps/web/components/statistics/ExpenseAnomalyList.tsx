import type { ExpenseAnomaly } from "@/lib/statistics/types";

function formatCurrency(amount: number) {
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}원`;
}

type Props = {
  loading: boolean;
  anomalies: ExpenseAnomaly[];
};

export function ExpenseAnomalyList({ loading, anomalies }: Props) {
  return (
    <section className="rounded border bg-white p-4 shadow-sm">
      <header>
        <h2 className="text-sm font-semibold text-gray-800">이상 지출 감지</h2>
        <p className="text-xs text-gray-500">평균 대비 급격하게 큰 지출을 자동으로 표시합니다.</p>
      </header>
      {loading && anomalies.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">분석 중입니다…</p>
      ) : anomalies.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">이상 지출로 판단된 거래가 없습니다.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-xs text-gray-700">
          {anomalies.map((item) => (
            <li key={item.transactionId} className="rounded border bg-gray-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{item.categoryGroupName}</p>
                  <p className="text-[11px] text-gray-500">{item.occurredAt} · {item.accountName}</p>
                  {item.memo && <p className="mt-1 text-[11px] text-gray-500">{item.memo}</p>}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-rose-600">{formatCurrency(item.amount)}</p>
                  <p className="text-[10px] text-gray-500">Z-score {item.zScore.toFixed(2)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
