"use client";

import { useEffect, useMemo, useState } from "react";
import { Category, fetchCategories } from "@/lib/categories";

type Props = {
  userId: number;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  value: number | "";
  onChange: (id: number | "") => void;
  disabled?: boolean;
};

export default function CategoryPicker({ userId, type, value, onChange, disabled }: Props) {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const typeFilter = useMemo(() => (type === "INCOME" ? "I" : type === "EXPENSE" ? "E" : undefined), [type]);

  useEffect(() => {
    if (!typeFilter) return; // TRANSFER는 비활성
    let ignore = false;
    setLoading(true);
    setError(null);
    fetchCategories({ user_id: userId, type: typeFilter, search, page: 1, page_size: 200 })
      .then((rows) => { if (!ignore) setItems(rows); })
      .catch((e) => { if (!ignore) setError(String(e.message || e)); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [userId, typeFilter, search]);

  if (type === "TRANSFER") {
    return (
      <select value={""} disabled className="mt-1 w-full rounded border px-2 py-1">
        <option value="">(TRANSFER는 카테고리 없음)</option>
      </select>
    );
  }

  return (
    <div className="flex gap-2">
      <input
        type="text"
        placeholder="검색"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-32 rounded border px-2 py-1"
        disabled={disabled}
      />
      <select value={value || ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")} className="flex-1 rounded border px-2 py-1" disabled={disabled || loading}>
        <option value="">전체</option>
        {error ? (
          <option value="" disabled>불러오기 실패</option>
        ) : items.map((c) => (
          <option key={c.id} value={c.id}>{c.full_code} {c.name}</option>
        ))}
      </select>
    </div>
  );
}
