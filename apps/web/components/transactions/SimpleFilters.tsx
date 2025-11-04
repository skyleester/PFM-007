"use client";

type SimpleFiltersProps = {
  filterType: "ALL" | "INCOME" | "EXPENSE" | "TRANSFER";
  onFilterChange: (type: "ALL" | "INCOME" | "EXPENSE" | "TRANSFER") => void;
};

export function SimpleFilters({ filterType, onFilterChange }: SimpleFiltersProps) {
  return (
    <div className="rounded border border-gray-200 bg-white p-4 mb-4">
      <h3 className="text-sm font-medium text-gray-900 mb-3">거래 유형 필터</h3>
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "ALL", label: "전체" },
          { key: "INCOME", label: "수입" },
          { key: "EXPENSE", label: "지출" },
          { key: "TRANSFER", label: "이체" },
        ].map(({ key, label }) => {
          const active = filterType === key;
          return (
            <button
              key={key}
              onClick={() => onFilterChange(key as any)}
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

export default SimpleFilters;