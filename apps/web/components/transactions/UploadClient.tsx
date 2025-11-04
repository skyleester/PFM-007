"use client";

import { useEffect, useState } from "react";

type ParsedTransaction = {
  date: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  memo?: string;
  category_main?: string;
  account_name?: string;
  currency?: string;
};

function parseAmount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  const s = String(value).replace(/[\,\s]/g, "").replace(/[()]/g, (m) => (m === "(" ? "-" : ""));
  const num = parseInt(s, 10);
  return Number.isFinite(num) ? num : null;
}

function toISO(dateVal: unknown): string | null {
  if (!dateVal) return null;
  try { return new Date(String(dateVal)).toISOString(); } catch { return null; }
}

export default function UploadClient() {
  const [count, setCount] = useState(0);
  const [preview, setPreview] = useState<ParsedTransaction[] | null>(null);
  const [parsed, setParsed] = useState<ParsedTransaction[] | null>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    const src = "https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js";
    if (!document.querySelector(`script[src="${src}"]`)) {
      const s = document.createElement("script");
      s.src = src; s.async = true; document.head.appendChild(s);
    }
  }, []);
  useEffect(() => {
    const src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    if (!document.querySelector(`script[src="${src}"]`)) {
      const s = document.createElement("script");
      s.src = src; s.async = true; document.head.appendChild(s);
    }
  }, []);
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">거래 업로드</h1>
      <input
        type="file"
        accept=".csv,.xlsx"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const ext = f.name.toLowerCase().split(".").pop();
          const out: ParsedTransaction[] = [];
          if (ext === "csv" || f.type.includes("csv")) {
            const text = await f.text();
            const Papa = (window as any).Papa;
            if (!Papa) { setCount(0); return; }
            const result = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: (h: string) => h.trim() });
            const rows: Record<string, any>[] = (result.data || []).filter((r: any) => Object.keys(r).length);
            for (const r of rows) {
              const iso = toISO(r.date || r["날짜"] || r["일자"]);
              const amt = parseAmount(r.amount ?? r["금액"]);
              const typeRaw = String(r.type ?? r["타입"] ?? r["거래유형"] ?? "").trim().toUpperCase();
              const type = (typeRaw === "INCOME" || typeRaw === "EXPENSE" || typeRaw === "TRANSFER") ? typeRaw : (amt && amt >= 0 ? "INCOME" : "EXPENSE");
              if (!iso || amt == null) continue;
              out.push({
                date: iso, type: type as ParsedTransaction["type"], amount: amt,
                memo: r.memo ?? r["메모"] ?? undefined,
                category_main: r.category ?? r["카테고리"] ?? undefined,
                account_name: r.account ?? r["계좌"] ?? undefined,
                currency: r.currency ?? r["통화"] ?? "KRW",
              });
            }
          } else {
            const XLSX = (window as any).XLSX;
            if (!XLSX) { setCount(0); return; }
            const buf = await f.arrayBuffer();
            const wb = XLSX.read(buf, { type: "array", cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rowsAoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
            let headers: string[] = [];
            let rows: Record<string, any>[] = [];
            if (Array.isArray(rowsAoa) && rowsAoa.length) {
              headers = (rowsAoa[0] || []).map((h: any) => String(h ?? "").trim());
              rows = (rowsAoa.slice(1) as any[][]).map((r) => {
                const o: Record<string, any> = {}; headers.forEach((h, i) => { o[h] = r[i]; }); return o;
              }).filter((o) => Object.values(o).some((v) => v != null && String(v).trim() !== ""));
            }
            for (const r of rows) {
              const iso = toISO(r.date || r["날짜"] || r["일자"]);
              const amt = parseAmount(r.amount ?? r["금액"]);
              const typeRaw = String(r.type ?? r["타입"] ?? r["거래유형"] ?? "").trim().toUpperCase();
              const type = (typeRaw === "INCOME" || typeRaw === "EXPENSE" || typeRaw === "TRANSFER") ? typeRaw : (amt && amt >= 0 ? "INCOME" : "EXPENSE");
              if (!iso || amt == null) continue;
              out.push({
                date: iso, type: type as ParsedTransaction["type"], amount: amt,
                memo: r.memo ?? r["메모"] ?? undefined,
                category_main: r.category ?? r["카테고리"] ?? undefined,
                account_name: r.account ?? r["계좌"] ?? undefined,
                currency: r.currency ?? r["통화"] ?? "KRW",
              });
            }
          }
          setPreview(out.slice(0, 20));
          setParsed(out);
          setCount(out.length);
        }}
        className="block"
      />
      <div className="text-sm text-gray-600">파싱 건수: {count}</div>
      {preview && preview.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">날짜</th>
                <th className="px-3 py-2 text-left">유형</th>
                <th className="px-3 py-2 text-right">금액</th>
                <th className="px-3 py-2 text-left">메모</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((tx, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-2">{tx.date}</td>
                  <td className="px-3 py-2">{tx.type}</td>
                  <td className="px-3 py-2 text-right">{tx.amount.toLocaleString()}</td>
                  <td className="px-3 py-2">{tx.memo || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {parsed && parsed.length > 0 && (
        <div className="flex items-center justify-end">
          <button
            onClick={async () => {
              if (!parsed?.length) return;
              // simple upload + redirect without next/navigation
              (document.activeElement as HTMLElement | null)?.blur?.();
              try {
                const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
                const res = await fetch(`${base}/api/transactions/bulk-upload?user_id=1`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(parsed),
                });
                const ok = res.ok;
                let failedCount = 0;
                let failedRows: any[] | undefined;
                try {
                  const data = await res.json();
                  failedCount = data?.failed_count ?? data?.summary?.errors ?? 0;
                  // Accept multiple shapes from backend: failed_rows | errors | summary.failed_rows
                  failedRows = data?.failed_rows ?? data?.errors ?? data?.summary?.failed_rows ?? undefined;
                } catch {}
                if (Array.isArray(failedRows) && failedRows.length) {
                  // Build a compact enriched array to avoid storing the whole payload
                  const getIdx = (item: any): number | undefined => {
                    const cands = [item?.index, item?.idx, item?.i, item?.row, item?.line].filter((v) => typeof v === "number") as number[];
                    for (const c of cands) {
                      if (c >= 0 && c < parsed.length) return c; // assume 0-based
                      if (c - 1 >= 0 && c - 1 < parsed.length) return c - 1; // row(1-based)
                      if (c - 2 >= 0 && c - 2 < parsed.length) return c - 2; // conservative fallback
                    }
                    return undefined;
                  };
                  const enriched = failedRows.map((r) => {
                    const idx = getIdx(r);
                    const src = typeof idx === "number" ? parsed[idx] : undefined;
                    return {
                      row: r?.row ?? r?.index ?? r?.idx ?? r?.i ?? r?.line,
                      error: r?.error ?? r?.message ?? r?.reason ?? "Validation error",
                      date: src?.date ?? "",
                      type: src?.type ?? "",
                      amount: src?.amount ?? "",
                    };
                  });
                  try { sessionStorage.setItem("failed_rows", JSON.stringify(enriched)); } catch {}
                }
                const failedParam = failedCount > 0 ? `&failed=${failedCount}` : "";
                if (ok) window.location.href = `/transactions?uploaded=1${failedParam}`;
              } catch (e) {
                console.error(e);
              }
            }}
            className="px-4 py-2 bg-indigo-600 text-white rounded"
          >
            {`${parsed.length}건 업로드`}
          </button>
        </div>
      )}
    </div>
  );
}
