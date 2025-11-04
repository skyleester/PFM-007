// Minimal stub to unblock Next.js production build; full implementation will be reintroduced incrementally.
export interface ParsedTransaction {
  date: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  memo?: string;
  category_main?: string;
  category_sub?: string;
  description?: string;
  account_name?: string;
  currency?: string;
}

export type ColumnMapping = {
  date: string | null;
  time?: string | null;
  type: string | null;
  amount: string | null;
  memo: string | null;
  category: string | null;
  account: string | null;
  currency: string | null;
};

function useExcelParser() {
  const parseFile = async (_file: File) => {
    // no-op stub
    return;
  };
  return {
    parseFile,
    headers: [] as string[],
    error: null as string | null,
    isLoading: false,
  } as const;
}

export default useExcelParser;