"use client";

import { BulkUploadResponse } from "@/lib/BulkUploadAPI";

type TransactionImportResultProps = {
  result: BulkUploadResponse | null;
  onClose: () => void;
};

export function TransactionImportResult({ result, onClose }: TransactionImportResultProps) {
  if (!result) return null;

  const { success, summary, details, message } = result;

  return (
    <div className="rounded border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          {success ? "업로드 완료" : "업로드 실패"}
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-50 rounded p-3 text-center">
          <div className="text-2xl font-bold text-gray-900">{summary.total}</div>
          <div className="text-sm text-gray-600">총 건수</div>
        </div>
        <div className="bg-green-50 rounded p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{summary.created}</div>
          <div className="text-sm text-green-600">성공</div>
        </div>
        <div className="bg-yellow-50 rounded p-3 text-center">
          <div className="text-2xl font-bold text-yellow-600">{summary.duplicates}</div>
          <div className="text-sm text-yellow-600">중복</div>
        </div>
        <div className="bg-red-50 rounded p-3 text-center">
          <div className="text-2xl font-bold text-red-600">{summary.errors}</div>
          <div className="text-sm text-red-600">오류</div>
        </div>
      </div>

      {/* Success Message */}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded p-3 mb-4">
          <p className="text-green-800">
            {summary.created}건의 거래가 성공적으로 등록되었습니다.
            {summary.duplicates > 0 && ` ${summary.duplicates}건은 중복으로 제외되었습니다.`}
          </p>
        </div>
      )}

      {/* Error Message */}
      {!success && message && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
          <p className="text-red-800">{message}</p>
        </div>
      )}

      {/* Detailed Results */}
      {details && (
        <div className="space-y-4">
          {/* Duplicate Details */}
          {details.duplicate_rows && details.duplicate_rows.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-yellow-800 mb-2">
                중복된 항목 ({details.duplicate_rows.length}건)
              </h4>
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 max-h-32 overflow-y-auto">
                {details.duplicate_rows.map((item, index) => (
                  <div key={index} className="text-sm text-yellow-700">
                    행 {item.row}: {item.reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error Details */}
          {details.error_rows && details.error_rows.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-red-800 mb-2">
                오류 항목 ({details.error_rows.length}건)
              </h4>
              <div className="bg-red-50 border border-red-200 rounded p-3 max-h-32 overflow-y-auto">
                {details.error_rows.map((item, index) => (
                  <div key={index} className="text-sm text-red-700">
                    행 {item.row}: {item.error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end mt-6">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
        >
          확인
        </button>
      </div>
    </div>
  );
}

export default TransactionImportResult;