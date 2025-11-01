"use client";

type Txn = {
  id: number;
  occurred_at: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  currency: string;
  account_id: number;
  counter_account_id?: number | null;
  category_id?: number | null;
  memo?: string | null;
};

type Account = { id: number; name: string };
type Category = { id: number; name: string; full_code: string; group_id: number };

type Props = {
  activeTxn: Txn | null;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
};

export default function DetailPanel({ activeTxn, accounts, categories, onClose }: Props) {
  const accountName = (id?: number | null) => accounts.find(a => a.id === id)?.name || "-";
  const categoryText = (id?: number | null) => {
    if (!id) return "-";
    const cat = categories.find(c => c.id === id);
    return cat ? `${cat.full_code} ${cat.name}` : String(id);
  };

  return (
    <div className="w-96 sticky top-6 self-start">
      <div className="rounded border bg-white p-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">상세정보</h3>
          {activeTxn && (
            <button className="text-sm text-gray-600" onClick={onClose}>닫기</button>
          )}
        </div>
        {!activeTxn ? (
          <div className="text-sm text-gray-500 mt-4">행을 클릭하면 상세정보가 표시됩니다.</div>
        ) : (
          <div className="mt-3 text-sm space-y-2">
            <div className="flex justify-between"><span className="text-gray-600">날짜</span><span>{activeTxn.occurred_at}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">유형</span><span>{activeTxn.type}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">분류</span><span>{categoryText(activeTxn.category_id)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">내용</span><span>{activeTxn.memo || '-'}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">금액</span><span>{activeTxn.amount.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">계정</span><span>{accountName(activeTxn.account_id)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">화폐</span><span>{activeTxn.currency}</span></div>
            {activeTxn.counter_account_id ? (
              <div className="flex justify-between"><span className="text-gray-600">상대계정</span><span>{accountName(activeTxn.counter_account_id)}</span></div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
