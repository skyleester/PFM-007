import type { CategoryTrendItem } from "@/lib/statistics/types";

type Props = {
  loading: boolean;
  trends: CategoryTrendItem[];
};

export function CategoryTrendsTable({ loading, trends }: Props) {
  const topTrends = trends.slice(0, 15);

  return (
    <section className="rounded border bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">카테고리 흐름 상세</h2>
          <p className="text-xs text-gray-500">최근 월의 지출/수입 규모와 전월·전분기·전년 대비 변화를 제공합니다.</p>
        </div>
        <span className="text-[11px] text-gray-500">{trends.length}개 항목 중 상위 {topTrends.length}개</span>
      </header>
      {loading && trends.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">데이터를 불러오는 중입니다…</p>
      ) : topTrends.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">표시할 카테고리 데이터가 없습니다.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">카테고리</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">월</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">금액</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">전월 대비</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">전분기 대비</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">전년 동월 대비</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {topTrends.map((item) => (
                <tr key={`${item.type}-${item.categoryGroupId ?? "none"}-${item.month}`}
                  className={item.type === "INCOME" ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-800">{item.categoryGroupName}</p>
                    <p className="text-[10px] uppercase text-gray-500">{item.type === "INCOME" ? "수입" : "지출"}</p>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{item.month}</td>
                  <td className="px-3 py-2 text-right text-gray-800">{item.amount.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{formatChange(item.momChange)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{formatChange(item.qoqChange)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{formatChange(item.yoyChange)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatChange(value: number | null) {
  if (value == null) return "-";
  const percentage = (value * 100).toFixed(1);
  return `${percentage}%`;
}
