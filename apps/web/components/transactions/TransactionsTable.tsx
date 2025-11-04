"use client";"use client";



import { useMemo } from "react";import { useMemo } from "react";



export type Txn = {export type Txn = {

  id: number;

  occurred_at: string;  id: number;

  type: "INCOME" | "EXPENSE" | "TRANSFER";

  amount: number;type TransactionsTableProps = {  occurred_at: string;

  currency: string;

  account_id: number;  transactions: TransactionItem[];  type: "INCOME" | "EXPENSE" | "TRANSFER";

  category_id?: number | null;

  memo?: string | null;  status: "idle" | "loading" | "success" | "error";  amount: number;

};

  error: string | null;  currency: string;

type Props = {

  txns: Txn[];  filterType: TransactionFilterType;  account_id: number;

  status: "idle" | "loading" | "success" | "error";

  error: string | null;  searchQuery?: string;  category_id?: number | null;

  searchQuery?: string;

  onRefresh?: () => void;  onRefresh?: () => void;  memo?: string | null;

};

};};

export function TransactionsTable({

  txns,

  status,

  error,export function TransactionsTable({type Props = {

  searchQuery,

  onRefresh,  transactions,  txns: Txn[];

}: Props) {

  // Calculate summary statistics  status,  loading: boolean;

  const stats = useMemo(() => {

    const total = txns.length;  error,  error: string | null;

    const income = txns

      .filter(tx => tx.amount > 0)  filterType,  selectedIds: Set<number>;

      .reduce((sum, tx) => sum + tx.amount, 0);

    const expense = txns  searchQuery = "",  onToggleSelect: (id: number) => void;

      .filter(tx => tx.amount < 0)

      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);  onRefresh,  onSelectAllPage: (checked: boolean) => void;

    const net = income - expense;

}: TransactionsTableProps) {};

    return { total, income, expense, net };

  }, [txns]);  // Filter and search transactions



  return (  const filteredTransactions = useMemo(() => {export default function TransactionsTable({ txns, loading, error, selectedIds, onToggleSelect, onSelectAllPage }: Props) {

    <div className="space-y-4">

      {/* Summary Statistics */}    let filtered = transactions;  const rows = useMemo(() => txns, [txns]);

      <div className="grid grid-cols-4 gap-4">

        <div className="bg-white rounded border border-gray-200 p-4">  return (

          <div className="text-sm text-gray-600">총 건수</div>

          <div className="text-2xl font-semibold text-gray-900">    // Apply type filter    <div className="overflow-x-auto rounded border bg-white">

            {stats.total.toLocaleString()}

          </div>    if (filterType !== "ALL") {      <table className="min-w-full text-sm">

        </div>

        <div className="bg-white rounded border border-gray-200 p-4">      filtered = filtered.filter(tx => tx.type === filterType);        <thead className="border-b bg-gray-50">

          <div className="text-sm text-gray-600">수입</div>

          <div className="text-2xl font-semibold text-emerald-600">    }          <tr>

            +{stats.income.toLocaleString()}

          </div>            <th className="px-3 py-2"><input type="checkbox" onChange={(e) => onSelectAllPage(e.target.checked)} /></th>

        </div>

        <div className="bg-white rounded border border-gray-200 p-4">    // Apply search filter            <th className="px-3 py-2 text-left">날짜</th>

          <div className="text-sm text-gray-600">지출</div>

          <div className="text-2xl font-semibold text-rose-600">    if (searchQuery.trim()) {            <th className="px-3 py-2 text-left">유형</th>

            -{stats.expense.toLocaleString()}

          </div>      const query = searchQuery.toLowerCase();            <th className="px-3 py-2 text-left">내용</th>

        </div>

        <div className="bg-white rounded border border-gray-200 p-4">      filtered = filtered.filter(tx =>            <th className="px-3 py-2 text-right">금액</th>

          <div className="text-sm text-gray-600">순액</div>

          <div className={`text-2xl font-semibold ${        tx.memo?.toLowerCase().includes(query) ||          </tr>

            stats.net >= 0 ? "text-emerald-600" : "text-rose-600"

          }`}>        tx.category?.toLowerCase().includes(query) ||        </thead>

            {stats.net >= 0 ? "+" : ""}{stats.net.toLocaleString()}

          </div>        tx.account_name?.toLowerCase().includes(query) ||        <tbody>

        </div>

      </div>        tx.type.toLowerCase().includes(query) ||          {loading ? (



      {/* Transactions List */}        tx.amount.toString().includes(query)            <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">불러오는 중…</td></tr>

      <div className="bg-white rounded border border-gray-200">

        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">      );          ) : error ? (

          <h3 className="text-sm font-medium text-gray-900">

            거래 목록    }            <tr><td colSpan={5} className="px-3 py-6 text-center text-red-600">{error}</td></tr>

            {searchQuery && (

              <span className="ml-2 text-xs text-gray-500">          ) : rows.length === 0 ? (

                (검색: {searchQuery})

              </span>    return filtered;            <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">데이터가 없습니다</td></tr>

            )}

          </h3>  }, [transactions, filterType, searchQuery]);          ) : (

          {onRefresh && (

            <button            rows.map((t) => (

              onClick={onRefresh}

              disabled={status === "loading"}  // Calculate summary stats              <tr key={t.id} className="border-b last:border-0">

              className="text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50"

            >  const stats = useMemo(() => {                <td className="px-3 py-2">

              {status === "loading" ? "불러오는 중..." : "새로고침"}

            </button>    const income = filteredTransactions                  <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => onToggleSelect(t.id)} />

          )}

        </div>      .filter(tx => tx.amount > 0)                </td>



        {status === "error" && (      .reduce((sum, tx) => sum + tx.amount, 0);                <td className="px-3 py-2">{t.occurred_at}</td>

          <div className="p-4 bg-red-50 border-b border-red-200">

            <p className="text-red-800">오류: {error}</p>                    <td className="px-3 py-2">{t.type}</td>

          </div>

        )}    const expense = filteredTransactions                <td className="px-3 py-2">{t.memo || '-'}</td>



        {status === "loading" && (      .filter(tx => tx.amount < 0)                <td className="px-3 py-2 text-right">{t.amount.toLocaleString()}</td>

          <div className="p-8 text-center">

            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 mb-2"></div>      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);              </tr>

            <p className="text-gray-600">거래 데이터를 불러오는 중...</p>

          </div>            ))

        )}

    return {          )}

        {status === "success" && txns.length === 0 && (

          <div className="p-8 text-center text-gray-500">      total: filteredTransactions.length,        </tbody>

            거래 내역이 없습니다.

          </div>      income,      </table>

        )}

      expense,    </div>

        {status === "success" && txns.length > 0 && (

          <div className="overflow-x-auto">      net: income - expense,  );

            <table className="min-w-full">

              <thead className="bg-gray-50">    };}

                <tr>

                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">날짜</th>  }, [filteredTransactions]);

                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">유형</th>

                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">금액</th>  if (status === "loading") {

                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">메모</th>    return (

                </tr>      <div className="rounded border border-gray-200 bg-white p-8">

              </thead>        <div className="text-center">

              <tbody className="bg-white divide-y divide-gray-200">          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 mb-2"></div>

                {txns.map((tx) => {          <p className="text-gray-600">거래 데이터를 불러오는 중...</p>

                  const amountColor = tx.amount > 0         </div>

                    ? "text-emerald-600"       </div>

                    : tx.amount < 0     );

                    ? "text-rose-600"   }

                    : "text-gray-700";

                    if (status === "error") {

                  const formattedAmount = tx.amount > 0     return (

                    ? `+${tx.amount.toLocaleString()}`      <div className="rounded border border-red-200 bg-red-50 p-4">

                    : tx.amount < 0        <div className="flex items-center justify-between">

                    ? `-${Math.abs(tx.amount).toLocaleString()}`          <p className="text-red-800">오류: {error}</p>

                    : "0";          {onRefresh && (

            <button

                  const typeColor = {              onClick={onRefresh}

                    INCOME: "text-emerald-700 bg-emerald-50",              className="text-red-600 hover:text-red-700 text-sm underline"

                    EXPENSE: "text-rose-700 bg-rose-50",            >

                    TRANSFER: "text-blue-700 bg-blue-50",              다시 시도

                  }[tx.type];            </button>

          )}

                  const typeLabel = {        </div>

                    INCOME: "수입",      </div>

                    EXPENSE: "지출",     );

                    TRANSFER: "이체",  }

                  }[tx.type];

  return (

                  return (    <div className="space-y-4">

                    <tr key={tx.id} className="hover:bg-gray-50">      {/* Summary Statistics */}

                      <td className="px-4 py-3 text-sm text-gray-900">      <div className="grid grid-cols-4 gap-4">

                        {tx.occurred_at}        <div className="bg-white rounded border border-gray-200 p-4">

                      </td>          <div className="text-sm text-gray-600">총 건수</div>

                      <td className="px-4 py-3 text-sm">          <div className="text-2xl font-semibold text-gray-900">

                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${typeColor}`}>            {stats.total.toLocaleString()}

                          {typeLabel}          </div>

                        </span>        </div>

                      </td>        <div className="bg-white rounded border border-gray-200 p-4">

                      <td className={`px-4 py-3 text-sm font-medium text-right tabular-nums ${amountColor}`}>          <div className="text-sm text-gray-600">수입</div>

                        {formattedAmount}          <div className="text-2xl font-semibold text-emerald-600">

                      </td>            +{stats.income.toLocaleString()}

                      <td className="px-4 py-3 text-sm text-gray-900">          </div>

                        {tx.memo || "-"}        </div>

                      </td>        <div className="bg-white rounded border border-gray-200 p-4">

                    </tr>          <div className="text-sm text-gray-600">지출</div>

                  );          <div className="text-2xl font-semibold text-rose-600">

                })}            -{stats.expense.toLocaleString()}

              </tbody>          </div>

            </table>        </div>

          </div>        <div className="bg-white rounded border border-gray-200 p-4">

        )}          <div className="text-sm text-gray-600">순액</div>

      </div>          <div className={`text-2xl font-semibold ${

    </div>            stats.net >= 0 ? "text-emerald-600" : "text-rose-600"

  );          }`}>

}            {stats.net >= 0 ? "+" : ""}{stats.net.toLocaleString()}

          </div>

export default TransactionsTable;        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">
            거래 목록
            {filterType !== "ALL" && (
              <span className="ml-2 text-xs text-gray-500">
                ({filterType} 필터 적용)
              </span>
            )}
            {searchQuery && (
              <span className="ml-2 text-xs text-gray-500">
                (검색: "{searchQuery}")
              </span>
            )}
          </h3>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="text-xs text-indigo-600 hover:text-indigo-700"
            >
              새로고침
            </button>
          )}
        </div>

        {filteredTransactions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {searchQuery 
              ? `"${searchQuery}"에 대한 검색 결과가 없습니다.`
              : filterType === "ALL"
              ? "거래 내역이 없습니다."
              : `${filterType} 유형의 거래 내역이 없습니다.`
            }
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    날짜
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    유형
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    금액
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    메모
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    카테고리
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    계좌
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredTransactions.map((tx) => {
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

                  const typeColor = {
                    INCOME: "text-emerald-700 bg-emerald-50",
                    EXPENSE: "text-rose-700 bg-rose-50",
                    TRANSFER: "text-blue-700 bg-blue-50",
                  }[tx.type];

                  const typeLabel = {
                    INCOME: "수입",
                    EXPENSE: "지출", 
                    TRANSFER: "이체",
                  }[tx.type];

                  return (
                    <tr key={tx.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <div>{tx.occurred_at}</div>
                        {tx.occurred_time && (
                          <div className="text-xs text-gray-500">
                            {tx.occurred_time.slice(0, 5)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${typeColor}`}>
                          {typeLabel}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-sm font-medium text-right tabular-nums ${amountColor}`}>
                        {formattedAmount}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {tx.memo || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {tx.category || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {tx.account_name || "-"}
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

export default TransactionsTable;