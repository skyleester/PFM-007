"use client";

import { useEffect, useMemo, useState } from "react";

type Member = { id: number; name: string };

async function fetchMembers(): Promise<Member[]> {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
  const res = await fetch(new URL("/api/members", base).toString(), { cache: "no-store" });
  if (!res.ok) {
    return [
      { id: 1, name: "me" },
      { id: 2, name: "member1" },
    ];
  }
  return (await res.json()) as Member[];
}

export function MemberSelector({ value, onChange, className = "" }: { value: number[]; onChange: (ids: number[]) => void; className?: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    fetchMembers()
      .then((list) => {
        if (!ignore) setMembers(list);
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const selected = useMemo(() => new Set(value), [value]);

  if (loading) return <div className={className}>멤버 불러오는 중…</div>;
  if (error) return <div className={className}>멤버 로드 실패</div>;

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next).sort((a, b) => a - b));
  }

  function selectAll() {
    onChange([...members.map((m) => m.id)].sort((a, b) => a - b));
  }
  function clearAll() {
    onChange([]);
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-xs text-gray-600">멤버:</span>
      {members.map((m) => (
        <label key={m.id} className="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
          <span>{m.name}</span>
        </label>
      ))}
      <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={selectAll}>전체</button>
      <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={clearAll}>초기화</button>
    </div>
  );
}
