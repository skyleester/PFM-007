"use client";

import { FormEvent, useCallback, useState, useEffect } from "react";
import { useSelectedAccount } from "./useSelectedAccount";

type AccountType = "BANK" | "CARD" | "POINT" | "STOCK" | "PENSION" | "LOAN" | "CASH" | "VIRTUAL";

type AccountData = {
  id: number;
  name: string;
  type: string; // backend value may differ; we map to our select loosely
  provider?: string | null;
  balance: number | string;
  currency?: string | null;
  is_active?: boolean;
};

const ACCOUNT_TYPE_OPTIONS: AccountType[] = [
  "BANK",
  "CARD",
  "POINT",
  "STOCK",
  "PENSION",
  "LOAN",
  "CASH",
  "VIRTUAL",
];

export function AccountEditForm() {
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { selectedId } = useSelectedAccount();

  // form fields
  const [id, setId] = useState<number | null>(null);
  const [name, setName] = useState<string>("");
  const [type, setType] = useState<AccountType>("BANK");
  const [provider, setProvider] = useState<string>("");
  const [balance, setBalance] = useState<string>("0");
  const [isActive, setIsActive] = useState<boolean>(true);

  const currency = "KRW"; // readonly

  const canLoad = selectedId != null && Number.isFinite(selectedId);
  const canSave = id != null && name.trim().length > 0 && status !== "loading" && status !== "saving";

  const load = useCallback(async () => {
    if (!canLoad || selectedId == null) return;
    try {
      setStatus("loading");
      setError(null);
      setMessage(null);
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      const url = new URL(`/api/accounts/${selectedId}`, base);
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as AccountData;
      // populate form fields; map type to our options if possible
      setId(data.id);
      setName(data.name || "");
      setType((() => {
        const upper = (data.type || "").toUpperCase();
        return (ACCOUNT_TYPE_OPTIONS.includes(upper as AccountType) ? (upper as AccountType) : "BANK");
      })());
      setProvider(data.provider ?? "");
      setBalance(String(typeof data.balance === "number" ? data.balance : Number(data.balance) || 0));
      setIsActive(data.is_active ?? true);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error("AccountEditForm load error:", msg);
    }
  }, [canLoad, selectedId]);

  const onSubmit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSave || id == null) return;
    try {
      setStatus("saving");
      setError(null);
      setMessage(null);
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      const url = new URL(`/api/accounts/${id}`, base);
      const payload = {
        name: name.trim(),
        type,
        provider: provider.trim() || null,
        balance: Number(balance) || 0,
        currency, // readonly on UI, still send for clarity
        is_active: !!isActive,
      };
      const res = await fetch(url.toString(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("저장 완료");
      setStatus("success");
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error("AccountEditForm save error:", msg);
    }
  }, [canSave, id, name, type, provider, balance, currency, isActive]);

  // Auto-load when selectedId changes
  useEffect(() => {
    if (selectedId != null) {
      load();
    } else {
      // Reset form when no account is selected
      setId(null);
      setName("");
      setType("BANK");
      setProvider("");
      setBalance("0");
      setIsActive(true);
      setStatus("idle");
      setError(null);
      setMessage(null);
    }
  }, [selectedId, load]);

  return (
    <div className="space-y-3">
      <div className="rounded border border-gray-200 bg-white p-3">
        <div className="text-xs uppercase text-gray-500">계정 편집</div>
        <div className="mt-2 text-sm">
          {selectedId == null ? (
            <span className="text-gray-500">계좌를 선택하세요</span>
          ) : (
            <span className="text-gray-700">Account ID: <strong>{selectedId}</strong></span>
          )}
          {status === "loading" && <span className="ml-2 text-xs text-blue-600">불러오는 중…</span>}
          {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
          {message && <span className="ml-2 text-xs text-emerald-700">{message}</span>}
        </div>
      </div>

      <div className="rounded border border-gray-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-gray-900">Account Edit Form</h2>
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-gray-500">Account ID</span>
            <input type="text" value={id ?? ""} readOnly className="rounded border border-gray-300 bg-gray-100 px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-gray-500">Currency</span>
            <input type="text" value={currency} readOnly className="rounded border border-gray-300 bg-gray-100 px-2 py-1 text-sm" />
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs uppercase text-gray-500">이름</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="계좌 이름"
              disabled={status === "loading" || status === "saving"}
              required
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-gray-500">종류</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              disabled={status === "loading" || status === "saving"}
            >
              {ACCOUNT_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-gray-500">Provider</span>
            <input
              type="text"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="은행/카드사 등"
              disabled={status === "loading" || status === "saving"}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-gray-500">Balance</span>
            <input
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              disabled={status === "loading" || status === "saving"}
            />
          </label>

          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={status === "loading" || status === "saving"}
              className="h-4 w-4"
            />
            <span className="text-sm text-gray-700">활성화</span>
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={!canSave}
              className="rounded bg-indigo-600 px-4 py-1 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "saving" ? "저장 중…" : "저장하기"}
            </button>
            {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
            {message && !error && <span className="ml-2 text-xs text-emerald-700">{message}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

export default AccountEditForm;
