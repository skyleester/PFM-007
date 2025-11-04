"use client";

import { TransactionFilterType } from "@/hooks/useTransactionsFilter";

type TransactionsFilterBarProps = {
  filterType: TransactionFilterType;
  onFilterChange: (type: TransactionFilterType) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
};

export function TransactionsFilterBar({ 
  filterType, 
  onFilterChange, 
  onRefresh,
  isLoading = false 
}: TransactionsFilterBarProps) {
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-900">거래 유형 필터</h3>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
          >
            {isLoading ? "불러오는 중..." : "새로고침"}
          </button>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "ALL" as const, label: "전체" },
          { key: "INCOME" as const, label: "수입" },
          { key: "EXPENSE" as const, label: "지출" },
          { key: "TRANSFER" as const, label: "이체" },
        ].map(({ key, label }) => {
          const active = filterType === key;
          return (
            <button
              key={key}
              onClick={() => onFilterChange(key)}
              className={`px-3 py-1 rounded text-sm border transition-colors ${
                active
                  ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default TransactionsFilterBar;