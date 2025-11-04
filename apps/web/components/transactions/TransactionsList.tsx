"use client";

import { TransactionItem } from "@/hooks/useTransactionsData";
import { TransactionFilterType } from "@/hooks/useTransactionsFilter";

type TransactionsListProps = {
  transactions: TransactionItem[];
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  filterType: TransactionFilterType;
};

export function TransactionsList({ 
  transactions, 
  status, 
  error, 
  filterType 
}: TransactionsListProps) {
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-gray-900">
          거래 목록 
          {filterType !== "ALL" && (
            <span className="ml-2 text-xs text-gray-500">
              ({filterType} 필터 적용: {transactions.length}건)
            </span>
          )}
        </h2>
      </div>
      
      {status === "error" && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
          오류: {error}
        </div>
      )}
      
      {status === "loading" && (
        <p className="text-sm text-gray-500">거래 데이터를 불러오는 중...</p>
      )}
      
      {status === "success" && transactions.length === 0 && (
        <p className="text-sm text-gray-500">
          {filterType === "ALL" 
            ? "거래 내역이 없습니다." 
            : `${filterType} 유형의 거래 내역이 없습니다.`
          }
        </p>
      )}
      
      {status === "success" && transactions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="px-2 py-2">날짜</th>
                <th className="px-2 py-2">유형</th>
                <th className="px-2 py-2 text-right">금액</th>
                <th className="px-2 py-2">메모</th>
                <th className="px-2 py-2">카테고리</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => {
                const amountColor = tx.amount > 0 
                  ? "text-emerald-600" 
                  : tx.amount < 0 
                  ? "text-rose-600" 
                  : "text-gray-700";
                const formattedAmount = tx.amount > 0 
                  ? `+${tx.amount.toLocaleString()}`
                  : tx.amount < 0
                  ? `-${Math.abs(tx.amount).toLocaleString()}`
                  : "0";
                return (
                  <tr key={tx.id} className="border-t border-gray-100">
                    <td className="px-2 py-2 text-gray-700">
                      {tx.occurred_at}
                      {tx.occurred_time && (
                        <span className="text-gray-500 ml-1">
                          {tx.occurred_time.slice(0,5)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-gray-600">{tx.type}</td>
                    <td className={`px-2 py-2 text-right font-semibold tabular-nums ${amountColor}`}>
                      {formattedAmount}
                    </td>
                    <td className="px-2 py-2 text-gray-600">{tx.memo || "-"}</td>
                    <td className="px-2 py-2 text-gray-600">{tx.category || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default TransactionsList;