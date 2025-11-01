import type { WeeklyHeatmap } from "@/lib/statistics/types";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const HOURS = Array.from({ length: 24 }, (_, index) => index);

type Props = {
  loading: boolean;
  data: WeeklyHeatmap | null;
};

export function WeeklyHeatmapCard({ loading, data }: Props) {
  const bucketMap = new Map<string, number>();
  const maxValue = data?.maxValue ?? 0;
  data?.buckets.forEach((bucket) => {
    bucketMap.set(`${bucket.dayOfWeek}-${bucket.hour}`, bucket.amount);
  });

  return (
    <section className="rounded border bg-white p-4 shadow-sm">
      <header>
        <h2 className="text-sm font-semibold text-gray-800">요일·시간별 지출 히트맵</h2>
        <p className="text-xs text-gray-500">가장 지출이 집중된 요일과 시간대를 색상 강도로 표현했습니다.</p>
      </header>
      {loading && !data ? (
        <p className="mt-3 text-sm text-gray-400">데이터를 불러오는 중입니다…</p>
      ) : data && data.buckets.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <div className="inline-grid grid-cols-[auto_repeat(7,minmax(0,1fr))] gap-1">
            <div />
            {DAY_LABELS.map((label) => (
              <div key={label} className="px-2 py-1 text-center text-[11px] font-medium text-gray-600">{label}</div>
            ))}
            {HOURS.map((hour) => (
              <HourRow
                key={hour}
                hour={hour}
                maxValue={maxValue}
                bucketMap={bucketMap}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-400">표시할 히트맵 데이터가 없습니다.</p>
      )}
    </section>
  );
}

type HourRowProps = {
  hour: number;
  maxValue: number;
  bucketMap: Map<string, number>;
};

function HourRow({ hour, maxValue, bucketMap }: HourRowProps) {
  return (
    <>
      <div className="px-1 py-1 text-right text-[11px] text-gray-500">{hour.toString().padStart(2, "0")}:00</div>
      {DAY_LABELS.map((_, dayIndex) => {
        const key = `${dayIndex}-${hour}`;
        const amount = bucketMap.get(key) ?? 0;
        const intensity = maxValue > 0 ? amount / maxValue : 0;
        const background = intensity === 0 ? "rgba(229, 231, 235, 1)" : `rgba(37, 99, 235, ${Math.min(0.85, 0.2 + intensity * 0.8)})`;
        const textClass = intensity > 0.45 ? "text-white" : "text-gray-700";
        return (
          <div
            key={key}
            className={`flex h-8 items-center justify-center rounded text-[11px] font-medium ${textClass}`}
            style={{ backgroundColor: background }}
            title={`${DAY_LABELS[dayIndex]} ${hour}:00 — ${amount.toLocaleString()}원`}
          >
            {amount > 0 ? shortAmount(amount) : ""}
          </div>
        );
      })}
    </>
  );
}

function shortAmount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 100_000) return `${(value / 1_000).toFixed(0)}K`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}
