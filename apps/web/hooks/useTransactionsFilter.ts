import { useState } from "react";

export type TransactionFilterType = "ALL" | "INCOME" | "EXPENSE" | "TRANSFER";

export function useTransactionsFilter() {
  const [filterType, setFilterType] = useState<TransactionFilterType>("ALL");

  const handleFilterChange = (newFilterType: TransactionFilterType) => {
    setFilterType(newFilterType);
  };

  return {
    filterType,
    setFilterType: handleFilterChange,
  };
}

export default useTransactionsFilter;