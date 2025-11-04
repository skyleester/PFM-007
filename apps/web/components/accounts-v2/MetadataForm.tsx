import React from "react";

export type AccountKind =
  | "BANK"
  | "CARD"
  | "POINT"
  | "STOCK"
  | "PENSION"
  | "LOAN"
  | "CASH"
  | "VIRTUAL";

export type MetadataFormProps = {
  kind: AccountKind;
  value: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
};

// Small input helpers
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 items-center gap-2">
      <label className="col-span-1 text-xs text-gray-600">{label}</label>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

export function MetadataForm({ kind, value, onChange }: MetadataFormProps) {
  const set = (k: string, v: any) => onChange({ ...(value || {}), [k]: v });

  return (
    <div className="space-y-3">
      {/* Common fields */}
      <Row label="색상(color)">
        <input
          type="text"
          value={String(value?.color ?? "")}
          onChange={(e) => set("color", e.target.value)}
          placeholder="#10b981 또는 색상명"
          className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </Row>
      <Row label="외부 ID 목록(external_ids)">
        <textarea
          value={(Array.isArray(value?.external_ids) ? value.external_ids : []).join("\n")}
          onChange={(e) => set("external_ids", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
          placeholder="한 줄에 하나씩 입력"
          rows={3}
          className="w-full rounded-md border border-gray-300 p-2 text-xs focus:border-emerald-500 focus:outline-none"
        />
      </Row>

      {/* Kind-specific fields */}
      {kind === "CARD" ? (
        <>
          <Row label="명세 마감일(billing_cutoff_day)">
            <input
              type="number"
              min={1}
              max={31}
              value={String(value?.billing_cutoff_day ?? "")}
              onChange={(e) => set("billing_cutoff_day", e.target.value === "" ? null : Number(e.target.value))}
              className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </Row>
          <Row label="결제일(payment_day)">
            <input
              type="number"
              min={1}
              max={31}
              value={String(value?.payment_day ?? "")}
              onChange={(e) => set("payment_day", e.target.value === "" ? null : Number(e.target.value))}
              className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </Row>
          <Row label="자동이체(auto_deduct)">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={Boolean(value?.auto_deduct)}
                onChange={(e) => set("auto_deduct", e.target.checked)}
              />
              자동이체 사용
            </label>
          </Row>
        </>
      ) : null}
    </div>
  );
}
