import { describeFrequency, formatDate, formatRuleAmount, formatTxnTypeLabel } from "@/lib/recurring/format";
import type { RecurringRule } from "@/lib/recurring/types";
import clsx from "clsx";

export type RecurringRuleTableProps = {
  rules: RecurringRule[];
  selectedRuleId: number | null;
  onSelect(ruleId: number): void;
  onCreate(): void;
  isLoading: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  createDisabled?: boolean;
  createDisabledReason?: string;
};

export function RecurringRuleTable({
  rules,
  selectedRuleId,
  onSelect,
  onCreate,
  isLoading,
  errorMessage,
  onRetry,
  createDisabled = false,
  createDisabledReason,
}: RecurringRuleTableProps) {
  return (
    <div className="rounded border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">정기 규칙 목록</h3>
          <p className="text-xs text-gray-500">활성/비활성 상태와 금액, 주기를 빠르게 확인하세요.</p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          disabled={createDisabled}
          title={createDisabled ? createDisabledReason : undefined}
          className={clsx(
            "inline-flex items-center rounded px-3 py-1 text-xs font-medium shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500",
            createDisabled
              ? "cursor-not-allowed border border-dashed border-gray-300 bg-gray-100 text-gray-400"
              : "bg-emerald-600 text-white hover:bg-emerald-700",
          )}
        >
          새 규칙 추가
        </button>
      </div>

      <div className="mt-3">
        {errorMessage ? (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            데이터를 불러오는 중 오류가 발생했습니다. 다시 시도해주세요.
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="ml-3 inline-flex items-center rounded border border-red-400 px-2 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-100"
              >
                다시 시도
              </button>
            )}
          </div>
        ) : isLoading ? (
          <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
            규칙 데이터를 불러오는 중입니다…
          </div>
        ) : rules.length === 0 ? (
          <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
            아직 등록된 정기 규칙이 없습니다. 상단 버튼을 눌러 첫 번째 규칙을 만들어보세요.
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">규칙명</th>
                  <th className="px-3 py-2">주기</th>
                  <th className="px-3 py-2">금액</th>
                  <th className="px-3 py-2">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white text-sm text-gray-700">
                {rules.map((rule) => {
                  const isSelected = selectedRuleId === rule.id;
                  return (
                    <tr
                      key={rule.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(rule.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(rule.id);
                        }
                      }}
                      className={clsx(
                        "cursor-pointer align-top transition focus:outline-none focus:ring-2 focus:ring-emerald-400",
                        isSelected ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-gray-50",
                      )}
                    >
                      <td className="px-3 py-3">
                        <div className="font-medium text-gray-900">{rule.name}</div>
                        <div className="mt-1 text-xs text-gray-500">계좌 #{rule.account_id}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-xs font-semibold uppercase text-gray-500">{formatTxnTypeLabel(rule.type)}</div>
                        <div className="mt-1 text-xs text-gray-500">{describeFrequency(rule)}</div>
                      </td>
                      <td className="px-3 py-3 font-semibold text-gray-900">
                        {formatRuleAmount(rule)}
                        {rule.is_variable_amount && (
                          <div className="mt-1 text-[11px] text-amber-600">미확정 {rule.pending_occurrences.length}건</div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={clsx(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                            rule.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-600",
                          )}
                        >
                          {rule.is_active ? "활성" : "비활성"}
                        </span>
                        <div className="mt-1 text-[11px] text-gray-400">최근 생성: {formatDate(rule.last_generated_at)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
