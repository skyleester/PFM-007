"use client";

export function TransactionsSimple() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Transactions</h1>
          <p className="mt-1 text-sm text-gray-600">전체 거래 내역을 관리합니다.</p>
        </div>
      </div>

      <div className="rounded border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-medium text-gray-900 mb-3">거래 목록</h2>
        <p className="text-sm text-gray-500">기능을 단계적으로 추가하고 있습니다...</p>
      </div>
    </div>
  );
}

export default TransactionsSimple;