import type { StatisticsInsight } from "@/lib/statistics/types";

const BADGE_COLOR: Record<StatisticsInsight["severity"], string> = {
  info: "bg-blue-100 text-blue-700",
  warning: "bg-amber-100 text-amber-700",
  positive: "bg-green-100 text-green-700",
};

type Props = {
  loading: boolean;
  insights: StatisticsInsight[];
};

export function InsightsList({ loading, insights }: Props) {
  return (
    <section className="space-y-3 rounded border bg-white p-4 shadow-sm">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">인사이트</h2>
        <span className="text-xs text-gray-500">자동으로 계산된 하이라이트</span>
      </header>
      {loading && insights.length === 0 && <p className="text-xs text-gray-500">분석 중…</p>}
      {!loading && insights.length === 0 && <p className="text-xs text-gray-400">표시할 인사이트가 없습니다.</p>}
      <div className="space-y-3">
        {insights.map((item) => (
          <article key={item.id} className="space-y-1 rounded border border-gray-200 bg-gray-50 p-3">
            <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${BADGE_COLOR[item.severity]}`}>
              {item.severity === "info" && "정보"}
              {item.severity === "warning" && "주의"}
              {item.severity === "positive" && "좋은 소식"}
            </span>
            <h3 className="text-sm font-semibold text-gray-800">{item.title}</h3>
            <p className="text-sm text-gray-600">{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
