"use client";

import { memo } from "react";

type TransactionItemProps = {
  id: number;
  date: string;
  description: string;
  category?: string | null;
  account_name?: string | null;
  amount: number;
  payment_method?: string | null;
  balance_after?: number | null;
  memo?: string | null;
};

export const TransactionItem = memo(function TransactionItem({
  date,
  description,
  category,
  account_name,
  amount,
  payment_method,
  balance_after,
  memo,
}: TransactionItemProps) {
  const isIncome = amount > 0;
  const isExpense = amount < 0;
  
  const amountClass = isIncome 
    ? "text-emerald-600" 
    : isExpense 
    ? "text-rose-600" 
    : "text-gray-700";
    
  const formattedAmount = isIncome 
    ? `+${amount.toLocaleString()}`
    : isExpense
    ? `-${Math.abs(amount).toLocaleString()}`
    : "0";

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2 text-sm text-gray-700">{date}</td>
      <td className="px-3 py-2">
        <div className="text-sm font-medium text-gray-900">{description}</div>
        {memo && <div className="text-xs text-gray-500">{memo}</div>}
      </td>
      <td className="px-3 py-2 text-sm text-gray-600">{category || "-"}</td>
      <td className="px-3 py-2 text-sm text-gray-600">{account_name || "-"}</td>
      <td className="px-3 py-2 text-sm text-gray-600">{payment_method || "-"}</td>
      <td className={`px-3 py-2 text-sm font-semibold text-right tabular-nums ${amountClass}`}>
        {formattedAmount}
      </td>
      <td className="px-3 py-2 text-sm text-gray-500 text-right tabular-nums">
        {balance_after?.toLocaleString() || "-"}
      </td>
    </tr>
  );
});