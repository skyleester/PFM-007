// @ts-nocheck
"use client";

import { useState, useRef } from "react";
import useExcelParser, { ColumnMapping, ParsedTransaction } from "@/hooks/useExcelParser";

// Backend response (assumed contract)
interface TransactionImportResult {
  success_count: number;
  failed_count: number;
  total_count: number;
  errors?: { row: number; reason: string }[];
  duplicates?: number;
}

type UploadModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete?: (result: unknown) => void;
};

export function UploadModal({ isOpen, onClose, onUploadComplete }: UploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "mapping" | "preview" | "importing" | "result">("upload");
  const [uploadResult, setUploadResult] = useState<TransactionImportResult | null>(null);
  
  const {
    isLoading,
    error,
    headers,
    columnMapping,
    previewData,
    parsedData,
    parseFile,
    updateColumnMapping,
    reset,
  } = useExcelParser();

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await parseFile(file);
      setStep("mapping");
    } catch (error) {
      console.error("File parsing failed:", error);
    }
  };

  const handleColumnMappingUpdate = (field: keyof ColumnMapping, header: string | null) => {
    updateColumnMapping({ [field]: header });
  };

  const handlePreview = () => {
    setStep("preview");
  };

  const handleImport = async () => {
    if (!parsedData || parsedData.length === 0) {
      alert("데이터가 없습니다.");
      return;
    }
    setStep("importing");
    try {
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      const res = await fetch(`${base}/api/transactions/bulk-upload?user_id=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedData),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // Normalize any loose backend shape into the assumed TransactionImportResult shape
      const normalized: TransactionImportResult = {
        success_count: data.success_count ?? data.summary?.created ?? 0,
        failed_count: data.failed_count ?? data.summary?.errors ?? 0,
        total_count: data.total_count ?? data.summary?.total ?? parsedData.length,
        errors: data.errors ?? data.details?.error_rows ?? [],
        duplicates: data.duplicates ?? data.summary?.duplicates ?? 0,
      };
  setUploadResult(normalized);
      setStep("result");
  onUploadComplete?.(data);
    } catch (error) {
      console.error(error);
      const fallback: TransactionImportResult = {
        success_count: 0,
        failed_count: parsedData.length,
        total_count: parsedData.length,
        errors: [{ row: 0, reason: error instanceof Error ? error.message : "업로드 중 오류 발생" }],
        duplicates: 0,
      };
      setUploadResult(fallback);
      setStep("result");
    }
  };

  const handleClose = () => {
    reset();
    setStep("upload");
    setUploadResult(null);
    onClose();
  };

  const handleResultClose = () => {
    setUploadResult(null);
    setStep("upload");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">거래 데이터 업로드</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center mb-6">
          {["upload", "mapping", "preview", "importing", "result"].map((stepName, index) => (
            <div key={stepName} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === stepName
                    ? "bg-indigo-600 text-white"
                    : index < ["upload", "mapping", "preview", "importing", "result"].indexOf(step)
                    ? "bg-green-600 text-white"
                    : "bg-gray-200 text-gray-600"
                }`}
              >
                {index + 1}
              </div>
              {index < 4 && (
                <div
                  className={`w-12 h-0.5 ${
                    index < ["upload", "mapping", "preview", "importing", "result"].indexOf(step)
                      ? "bg-green-600"
                      : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Excel/CSV 파일 선택
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                onChange={handleFileSelect}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
            </div>
            
            {isLoading && (
              <div className="text-center py-8">
                <div className="text-gray-600">파일을 분석하고 있습니다...</div>
              </div>
            )}
            
            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <p className="text-red-800">{error}</p>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded p-4">
              <h3 className="text-sm font-medium text-blue-800 mb-2">파일 형식 안내</h3>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• 첫 번째 행은 헤더(컬럼명)여야 합니다</li>
                <li>• 날짜, 유형, 금액은 필수 컬럼입니다</li>
                <li>• 날짜 형식: YYYY-MM-DD, MM/DD/YYYY, DD-MM-YYYY 지원</li>
                <li>• 유형: INCOME(수입), EXPENSE(지출), TRANSFER(이체)</li>
                <li>• 최대 파일 크기: 10MB</li>
              </ul>
            </div>
          </div>
        )}

        {/* Step: Column Mapping */}
        {step === "mapping" && headers && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">컬럼 매핑</h3>
            <p className="text-sm text-gray-600">
              CSV 파일의 컬럼을 거래 데이터 필드에 매핑해주세요.
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              {Object.entries({
                date: "날짜 (필수)",
                type: "유형 (필수)",
                amount: "금액 (필수)",
                memo: "메모",
                category: "카테고리",
                account: "계좌",
                currency: "통화",
              }).map(([field, label]) => (
                <div key={field}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {label}
                  </label>
                  <select
                    value={columnMapping[field as keyof ColumnMapping] || ""}
                    onChange={(e) => handleColumnMappingUpdate(
                      field as keyof ColumnMapping,
                      e.target.value || null
                    )}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  >
                    <option value="">선택 안함</option>
                    {headers.map(header => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep("upload")}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              >
                이전
              </button>
              <button
                onClick={handlePreview}
                disabled={!columnMapping.date || !columnMapping.type || !columnMapping.amount}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                미리보기
              </button>
            </div>
          </div>
        )}

        {/* Step: Preview */}
        {step === "preview" && previewData && previewData.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">
              데이터 미리보기 (처음 20건)
            </h3>
            
            <div className="overflow-x-auto border border-gray-200 rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">날짜</th>
                    <th className="px-3 py-2 text-left">유형</th>
                    <th className="px-3 py-2 text-right">금액</th>
                    <th className="px-3 py-2 text-left">카테고리(대)</th>
                    <th className="px-3 py-2 text-left">카테고리(소)</th>
                    <th className="px-3 py-2 text-left">결제수단</th>
                    <th className="px-3 py-2 text-left">메모</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.map((tx, index) => (
                    <tr key={index} className="border-t border-gray-100">
                      <td className="px-3 py-2">{tx.date || "-"}</td>
                      <td className="px-3 py-2">{tx.type}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {tx.amount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2">{tx.category_main || "-"}</td>
                      <td className="px-3 py-2">{tx.category_sub || "-"}</td>
                      <td className="px-3 py-2">{tx.account_name || "-"}</td>
                      <td className="px-3 py-2">{tx.memo || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep("mapping")}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              >
                이전
              </button>
              <button onClick={handleImport} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                {parsedData?.length || 0}건 업로드
              </button>
            </div>
          </div>
        )}

        {/* Step: Importing */}
        {step === "importing" && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4"></div>
            <div className="text-gray-600">거래 데이터를 업로드하고 있습니다...</div>
          </div>
        )}

        {/* Step: Result */}
        {step === "result" && uploadResult && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">업로드 결과 요약</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded p-4">
                <div className="text-sm text-emerald-700">성공</div>
                <div className="text-2xl font-semibold text-emerald-800">{uploadResult.success_count.toLocaleString()}</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded p-4">
                <div className="text-sm text-amber-700">중복</div>
                <div className="text-2xl font-semibold text-amber-800">{(uploadResult.duplicates ?? 0).toLocaleString()}</div>
              </div>
              <div className="bg-rose-50 border border-rose-200 rounded p-4">
                <div className="text-sm text-rose-700">실패</div>
                <div className="text-2xl font-semibold text-rose-800">{uploadResult.failed_count.toLocaleString()}</div>
              </div>
            </div>

            <div className="text-sm text-gray-600">
              총 {uploadResult.total_count.toLocaleString()}건 중 {uploadResult.success_count.toLocaleString()}건 처리 완료
            </div>

            {(uploadResult.errors && uploadResult.errors.length > 0) && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2">실패 상세</h4>
                <div className="overflow-x-auto border border-gray-200 rounded">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left">행</th>
                        <th className="px-3 py-2 text-left">사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.errors.map((e, idx) => (
                        <tr key={`${e.row}-${idx}`} className="border-t border-gray-100">
                          <td className="px-3 py-2">{e.row}</td>
                          <td className="px-3 py-2">{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={handleResultClose}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              >
                닫기
              </button>
              <button
                onClick={() => { reset(); setStep("upload"); setUploadResult(null); }}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                새 업로드
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadModal;