"use client";

import { useEffect, useState } from "react";

type CategoryGroup = { id: number; user_id: number; type: "I" | "E" | "T"; code_gg: number; name: string };

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
const USER_ID = 1; // TODO: wire with auth later

async function readErrorResponse(res: Response): Promise<string> {
  const raw = await res.text();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string") return parsed;
      if (parsed?.detail) {
        if (Array.isArray(parsed.detail)) {
          return parsed.detail.map((d: any) => (typeof d === "string" ? d : d?.msg)).filter(Boolean).join("\n") || raw;
        }
        if (typeof parsed.detail === "string") return parsed.detail;
      }
      if (parsed?.message && typeof parsed.message === "string") return parsed.message;
    } catch {
      // non-JSON content, fall through to raw text
    }
    return raw;
  }
  return `${res.status} ${res.statusText || "에러"}`;
}

export default function CategoryGroupsPage() {
  const [type, setType] = useState<"ALL" | "I" | "E" | "T">("ALL");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<CategoryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<{ id: number; name: string } | null>(null);
  const [showDelete, setShowDelete] = useState<{ id: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const url = new URL("/api/category-groups", BACKEND_URL);
        url.searchParams.set("user_id", String(USER_ID));
        if (type !== "ALL") url.searchParams.set("type", type);
        if (search) url.searchParams.set("search", search);
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) throw new Error(await readErrorResponse(res));
        const data = (await res.json()) as CategoryGroup[];
        if (!ignore) setRows(data);
      } catch (e: any) {
        if (!ignore) setError(e?.message || "로드 실패");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [type, search]);

  async function createGroup(payload: { type: "I" | "E" | "T"; code_gg: number; name: string }) {
    const url = new URL("/api/category-groups", BACKEND_URL);
    const res = await fetch(url.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: USER_ID, ...payload }) });
    if (!res.ok) throw new Error(await readErrorResponse(res));
    setShowCreate(false);
    // refresh
    setType(t => t);
  }

  async function updateGroupName(id: number, name: string) {
    const url = new URL(`/api/category-groups/${id}`, BACKEND_URL);
    const res = await fetch(url.toString(), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!res.ok) throw new Error(await readErrorResponse(res));
    setShowEdit(null);
    setType(t => t);
  }

  async function updateGroupCode(id: number, code_gg: number) {
    const url = new URL(`/api/category-groups/${id}`, BACKEND_URL);
    const res = await fetch(url.toString(), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code_gg }) });
    if (!res.ok) throw new Error(await readErrorResponse(res));
  }

  async function deleteGroup(id: number) {
    const url = new URL(`/api/category-groups/${id}`, BACKEND_URL);
    const res = await fetch(url.toString(), { method: "DELETE" });
    if (!res.ok) {
      const msg = await readErrorResponse(res);
      if (res.status === 409) setToast("그룹에 소분류가 있어 삭제할 수 없습니다.");
      else setToast(`삭제 실패: ${msg}`);
      return;
    }
    setShowDelete(null);
    setType(t => t);
  }

  return (
    <div className="p-6 space-y-4">
      {toast && (
        <div className="rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">{toast}<button className="float-right" onClick={() => setToast(null)}>닫기</button></div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">카테고리 그룹 관리</h1>
        <button className="rounded bg-blue-600 px-3 py-1 text-white" onClick={() => setShowCreate(true)}>+ 새 그룹</button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600">유형</label>
          <select className="mt-1 rounded border px-2 py-1" value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="ALL">전체</option>
            <option value="E">지출(E)</option>
            <option value="I">수입(I)</option>
            <option value="T">이체(T)</option>
          </select>
        </div>
        <div className="grow max-w-[420px]">
          <label className="block text-xs text-gray-600">검색</label>
          <input className="mt-1 w-full rounded border px-2 py-1" placeholder="그룹명 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="rounded border bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">유형</th>
              <th className="px-3 py-2 text-left">코드</th>
              <th className="px-3 py-2 text-left">이름</th>
              <th className="px-3 py-2 text-right">작업</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-6 text-center" colSpan={4}>불러오는 중…</td></tr>
            ) : error ? (
              <tr><td className="px-3 py-6 text-red-600" colSpan={4}>에러: {error}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-3 py-6 text-center" colSpan={4}>데이터가 없습니다</td></tr>
            ) : (
              rows.map(g => (
                <tr key={g.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{g.type}</td>
                  <td className="px-3 py-2">
                    <InlineGgEditor
                      type={g.type}
                      gg={g.code_gg}
                      disabled={g.code_gg === 0}
                      onSubmit={async (newGg) => {
                        try {
                          await updateGroupCode(g.id, newGg);
                          setType(t => t);
                        } catch (e) { /* ignore */ }
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">{g.name}</td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button className="rounded border px-2 py-1" onClick={() => setShowEdit({ id: g.id, name: g.name })}>수정</button>
                    <button className="rounded border px-2 py-1 text-red-600" onClick={() => setShowDelete({ id: g.id })}>삭제</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreate={async (p) => { try { await createGroup(p); } catch (e: any) { setToast(e?.message || "생성 실패"); } }} />
      )}
      {showEdit && (
        <EditModal initial={showEdit} onClose={() => setShowEdit(null)} onSave={async (id, name) => { try { await updateGroupName(id, name); } catch (e: any) { setToast(e?.message || "수정 실패"); } }} />
      )}
      {showDelete && (
        <DeleteModal id={showDelete.id} onClose={() => setShowDelete(null)} onDelete={async (id) => { await deleteGroup(id); }} />
      )}
    </div>
  );
}

function InlineGgEditor({ type, gg, disabled, onSubmit }: { type: "I" | "E" | "T"; gg: number; disabled: boolean; onSubmit: (newGg: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(gg).padStart(2,'0'));
  useEffect(() => { setVal(String(gg).padStart(2,'0')); }, [gg]);
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono">{type}{val}</span>
      <button className="text-xs underline disabled:opacity-50" disabled={disabled} onClick={() => setEditing(true)}>코드변경</button>
      {editing && (
        <span className="flex items-center gap-1">
          <input className="w-14 rounded border px-1 py-0.5 font-mono" maxLength={2} value={val} onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, '').slice(0,2);
            setVal(raw.padStart(2,'0'));
          }} />
          <button className="rounded border px-2 py-0.5 text-xs" onClick={async () => { await onSubmit(Number(val)); setEditing(false); }}>저장</button>
          <button className="rounded border px-2 py-0.5 text-xs" onClick={() => { setVal(String(gg).padStart(2,'0')); setEditing(false); }}>취소</button>
        </span>
      )}
    </div>
  );
}

function CreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (payload: { type: "I" | "E" | "T"; code_gg: number; name: string }) => Promise<void> }) {
  const [type, setType] = useState<"I" | "E" | "T">("E");
  const [codeGg, setCodeGg] = useState<number | "">("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = type && codeGg !== "" && name.trim().length > 0;
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-md rounded bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">새 그룹</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600">유형</label>
            <select className="mt-1 w-full rounded border px-2 py-1" value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="E">지출(E)</option>
              <option value="I">수입(I)</option>
              <option value="T">이체(T)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600">그룹 코드(GG)</label>
            <input className="mt-1 w-full rounded border px-2 py-1" type="number" min={0} max={99} value={codeGg === "" ? "" : codeGg} onChange={(e) => {
              const v = e.target.value === "" ? "" : Math.max(0, Math.min(99, Number(e.target.value)));
              setCodeGg(v as any);
            }} placeholder="00-99" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-600">이름</label>
            <input className="mt-1 w-full rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded border px-3 py-1" onClick={onClose}>취소</button>
          <button className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50" disabled={!valid || busy} onClick={async () => { if (!valid) return; try { setBusy(true); await onCreate({ type, code_gg: codeGg as number, name: name.trim() }); } finally { setBusy(false); } }}>생성</button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ initial, onClose, onSave }: { initial: { id: number; name: string }; onClose: () => void; onSave: (id: number, name: string) => Promise<void> }) {
  const [name, setName] = useState(initial.name);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-sm rounded bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">그룹 수정</h2>
        <div>
          <label className="block text-xs text-gray-600">이름</label>
          <input className="mt-1 w-full rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded border px-3 py-1" onClick={onClose}>취소</button>
          <button className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50" disabled={busy || !name.trim()} onClick={async () => { try { setBusy(true); await onSave(initial.id, name.trim()); } finally { setBusy(false); } }}>저장</button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({ id, onClose, onDelete }: { id: number; onClose: () => void; onDelete: (id: number) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-sm rounded bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">그룹 삭제</h2>
        <p className="text-sm text-gray-700">해당 그룹을 삭제합니다. 그룹에 소분류가 존재하면 삭제가 거부됩니다.</p>
        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded border px-3 py-1" onClick={onClose}>취소</button>
          <button className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50" disabled={busy} onClick={async () => { try { setBusy(true); await onDelete(id); } finally { setBusy(false); } }}>삭제</button>
        </div>
      </div>
    </div>
  );
}
