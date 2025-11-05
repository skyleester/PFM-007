import { useCallback, useMemo, useState } from "react";

export interface ParsedTransaction {
  date: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  memo?: string;
  category_main?: string;
  category_sub?: string;
  description?: string;
  account_name?: string;
  currency?: string;
  counter_account_name?: string;
  transfer_flow?: "OUT" | "IN";
}

export type ColumnMapping = {
  date: string | null;
  time?: string | null;
  type: string | null;
  amount: string | null;
  memo: string | null;
  category: string | null;
  category_sub?: string | null;
  description?: string | null;
  account: string | null;
  currency: string | null;
  counter_account?: string | null;
  source_account?: string | null;
  target_account?: string | null;
  transfer_flow?: string | null;
};

export const FIXED_COLUMN_MAPPING: ColumnMapping = {
  date: "날짜",
  time: "시간",
  type: "타입",
  amount: "금액",
  memo: "메모",
  category: "대분류",
  category_sub: "소분류",
  description: "내용",
  account: "결제수단",
  currency: "화폐",
  counter_account: "상대계좌",
  source_account: "출금수단",
  target_account: "입금수단",
  transfer_flow: "입출구분",
};

const HEADER_SEQUENCE: string[] = [
  "날짜",
  "시간",
  "타입",
  "대분류",
  "소분류",
  "내용",
  "금액",
  "화폐",
  "결제수단",
  "메모",
  "출금수단",
  "입금수단",
  "상대계좌",
  "입출구분",
];

const DEFAULT_ACCOUNT_NAME = "기타 결제수단";

const SOURCE_ACCOUNT_LABELS = ["출금수단", "출금 자산", "출금자산", "보낸자산", "보낸 계좌", "보낸계좌", "송금자산", "송금수단"];
const TARGET_ACCOUNT_LABELS = ["입금수단", "입금 자산", "입금자산", "받은자산", "받은 계좌", "받은계좌", "수취자산", "수취수단"];
const COUNTER_ACCOUNT_LABELS = ["상대계좌", "상대 계좌", "상대계정", "상대 계정", "대응계좌", "받는계좌", "받는 계좌", "입금계좌"];
const FLOW_LABELS = ["입출구분", "입출금구분", "입출금", "입금/출금", "거래구분", "거래 방향", "입금구분", "출금구분"];

const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
let xlsxPromise: Promise<any> | null = null;

async function ensureXlsx(): Promise<any | null> {
  if (typeof window === "undefined") return null;
  const existing = (window as typeof window & { XLSX?: any }).XLSX;
  if (existing) return existing;

  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = XLSX_CDN;
      script.async = true;
      script.onload = () => {
        resolve((window as typeof window & { XLSX?: any }).XLSX);
      };
      script.onerror = (err) => {
        script.remove();
        xlsxPromise = null;
        reject(err);
      };
      document.head.appendChild(script);
    });
  }

  try {
    const xlsx = await xlsxPromise;
    return xlsx ?? null;
  } catch (error) {
    console.error("[useExcelParser] XLSX load failed", error);
    return null;
  }
}

type DateParts = { year: number; month: number; day: number };
type TimeParts = { hours: number; minutes: number; seconds: number };

const parseDateParts = (value: unknown): DateParts | null => {
  if (value instanceof Date) {
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const utcMillis = Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(utcMillis);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;

  const normalized = raw.replace(/[./]/g, "-");
  const segments = normalized.split("-").map((segment) => segment.trim());
  if (segments.length !== 3) return null;

  const [first, second, third] = segments;
  let year: number;
  let month: number;
  let day: number;

  if (first.length === 4) {
    year = Number(first);
    month = Number(second);
    day = Number(third);
  } else if (third.length === 4) {
    year = Number(third);
    month = Number(second);
    day = Number(first);
  } else {
    return null;
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  return { year, month, day };
};

const parseTimeParts = (value: unknown): TimeParts | null => {
  if (value instanceof Date) {
    return { hours: value.getHours(), minutes: value.getMinutes(), seconds: value.getSeconds() };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const fractional = value % 1;
    const totalSeconds = Math.round((fractional >= 0 ? fractional : fractional + 1) * 86400);
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { hours, minutes, seconds };
  }

  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;

  const match = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;

  if ([hours, minutes, seconds].some((num) => !Number.isFinite(num))) return null;

  return { hours, minutes, seconds };
};

const toIsoString = (dateValue: unknown, timeValue: unknown): string | null => {
  const dateParts = parseDateParts(dateValue);
  if (!dateParts) return null;

  const timeParts = parseTimeParts(timeValue) ?? { hours: 0, minutes: 0, seconds: 0 };

  const { year, month, day } = dateParts;
  if (!year || !month || !day) return null;

  const isoDate = new Date(Date.UTC(year, month - 1, day, timeParts.hours, timeParts.minutes, timeParts.seconds, 0));
  return Number.isNaN(isoDate.getTime()) ? null : isoDate.toISOString();
};

const normalizeAmount = (value: unknown): { amount: number; sign: number } | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { amount: Math.abs(value), sign: Math.sign(value) || 1 };
  }

  const raw = typeof value === "string" ? value.replace(/[\s,]/g, "") : "";
  if (!raw) return null;

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;

  return { amount: Math.abs(numeric), sign: Math.sign(numeric) || 1 };
};

const mapType = (value: unknown, signHint: number): ParsedTransaction["type"] => {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";

  if (raw === "INCOME" || raw === "수입") return "INCOME";
  if (raw === "EXPENSE" || raw === "지출") return "EXPENSE";
  if (raw === "TRANSFER" || raw === "이체") return "TRANSFER";

  if (signHint < 0) return "EXPENSE";
  if (signHint > 0) return "INCOME";
  return "EXPENSE";
};

const sanitizeString = (value: unknown): string | undefined => {
  const raw = typeof value === "string" ? value.trim() : value instanceof Date ? value.toISOString() : "";
  return raw.length > 0 ? raw : undefined;
};

const normalizeAccountKey = (value?: string): string | undefined => {
  if (!value) return undefined;
  return value.replace(/[\s]/g, "").replace(/[()\[\]]/g, "").toLowerCase();
};

const inferTransferFlowFromText = (value?: string): "OUT" | "IN" | undefined => {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  if (/(출금|송금|보냄|인출|상환|결제|대체|out)/.test(normalized)) {
    return "OUT";
  }
  if (/(입금|입고|받음|충전|예금|입력|in)/.test(normalized)) {
    return "IN";
  }
  return undefined;
};

const pickFirstValue = (
  getter: (label: string) => unknown,
  labels: string[],
): unknown => {
  for (const label of labels) {
    const candidate = getter(label) ?? getter(label.trim());
    if (candidate !== undefined && candidate !== null && candidate !== "") {
      return candidate;
    }
  }
  return undefined;
};

function normalizeRows(rows: Array<Record<string, unknown>>): ParsedTransaction[] {
  return rows
    .map((row) => {
      const pick = (label: string): unknown => row[label] ?? row[label.trim()];
      const pickFromLabels = (labels: string[]) => pickFirstValue(pick, labels);

      const iso = toIsoString(pick("날짜"), pick("시간"));
      const amountInfo = normalizeAmount(pick("금액"));

      if (!iso || !amountInfo) {
        return null;
      }

      if (amountInfo.amount <= 0) {
        return null;
      }

      let type = mapType(pick("타입"), amountInfo.sign);

      const baseAccount = sanitizeString(pick("결제수단"));
      const sourceAccount = sanitizeString(pickFromLabels(SOURCE_ACCOUNT_LABELS));
      const targetAccount = sanitizeString(pickFromLabels(TARGET_ACCOUNT_LABELS));
      const explicitCounter = sanitizeString(pickFromLabels(COUNTER_ACCOUNT_LABELS));
      const flowHintText = sanitizeString(pickFromLabels(FLOW_LABELS));

      let accountName = baseAccount ?? sourceAccount ?? targetAccount;
      let counterAccountName = explicitCounter ?? undefined;
      let transferFlow = inferTransferFlowFromText(flowHintText);

      if (type === "TRANSFER") {
        let accountKey = normalizeAccountKey(accountName);
        const sourceKey = normalizeAccountKey(sourceAccount);
        const targetKey = normalizeAccountKey(targetAccount);

        if (!accountName && sourceAccount) {
          accountName = sourceAccount;
          accountKey = normalizeAccountKey(accountName);
        }
        if (!accountName && targetAccount) {
          accountName = targetAccount;
          accountKey = normalizeAccountKey(accountName);
        }

        if (!transferFlow) {
          if (accountKey && sourceKey && accountKey === sourceKey) {
            transferFlow = "OUT";
          } else if (accountKey && targetKey && accountKey === targetKey) {
            transferFlow = "IN";
          }
        }

        if (!counterAccountName) {
          if (transferFlow === "OUT" && targetAccount) {
            counterAccountName = targetAccount;
          } else if (transferFlow === "IN" && sourceAccount) {
            counterAccountName = sourceAccount;
          }
        }

        if (!counterAccountName) {
          if (accountKey && sourceKey && accountKey === sourceKey && targetAccount) {
            counterAccountName = targetAccount;
            transferFlow = transferFlow ?? "OUT";
          } else if (accountKey && targetKey && accountKey === targetKey && sourceAccount) {
            counterAccountName = sourceAccount;
            transferFlow = transferFlow ?? "IN";
          }
        }

        if (!counterAccountName && sourceAccount && targetAccount) {
          const preferOutgoing = transferFlow !== "IN";
          if (preferOutgoing) {
            accountName = sourceAccount;
            counterAccountName = targetAccount;
            transferFlow = "OUT";
          } else {
            accountName = targetAccount;
            counterAccountName = sourceAccount;
            transferFlow = "IN";
          }
          accountKey = normalizeAccountKey(accountName);
        }

        if (!transferFlow && amountInfo.sign !== 0) {
          transferFlow = amountInfo.sign < 0 ? "OUT" : "IN";
          if (!counterAccountName) {
            if (transferFlow === "OUT" && targetAccount) {
              counterAccountName = targetAccount;
            } else if (transferFlow === "IN" && sourceAccount) {
              counterAccountName = sourceAccount;
            }
          }
        }

        if (counterAccountName && accountName && normalizeAccountKey(counterAccountName) === normalizeAccountKey(accountName)) {
          counterAccountName = undefined;
        }

        if (!counterAccountName && !explicitCounter) {
          type = transferFlow === "IN" ? "INCOME" : "EXPENSE";
          transferFlow = undefined;
        }
      }

      if (!accountName) {
        accountName = DEFAULT_ACCOUNT_NAME;
      }

      const result: ParsedTransaction = {
        date: iso,
        type,
        amount: amountInfo.amount,
        memo: sanitizeString(pick("메모")),
        category_main: sanitizeString(pick("대분류")),
        category_sub: sanitizeString(pick("소분류")),
        description: sanitizeString(pick("내용")),
        account_name: accountName,
        currency: sanitizeString(pick("화폐")) ?? "KRW",
      };

      if (type === "TRANSFER" && counterAccountName) {
        result.counter_account_name = counterAccountName;
      }

      if (type === "TRANSFER" && transferFlow) {
        result.transfer_flow = transferFlow;
      }

      return result;
    })
    .filter((item): item is ParsedTransaction => item !== null);
}

function useExcelParser() {
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({ ...FIXED_COLUMN_MAPPING });
  const [headers, setHeaders] = useState<string[]>([...HEADER_SEQUENCE]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewData, setPreviewData] = useState<ParsedTransaction[]>([]);
  const [parsedData, setParsedData] = useState<ParsedTransaction[]>([]);

  const parseFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    setPreviewData([]);
    setParsedData([]);

    try {
      const XLSX = await ensureXlsx();
      if (!XLSX) {
        throw new Error("파일을 처리할 도구를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      }

      const lowerName = file.name.toLowerCase();
      const isCsv = lowerName.endsWith(".csv") || file.type.includes("csv");

      const workbook = isCsv
        ? XLSX.read(await file.text(), { type: "string", raw: false, cellDates: true })
        : XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });

      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error("유효한 시트를 찾지 못했습니다.");
      }

      const sheet = workbook.Sheets[sheetName];
      const rows: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
        raw: false,
        blankrows: false,
        strip: true,
      });

      const transactions = normalizeRows(rows);

      setParsedData(transactions);
      setPreviewData(transactions.slice(0, 20));
      setHeaders([...HEADER_SEQUENCE]);

      if (transactions.length === 0) {
        setError("업로드한 파일에서 유효한 거래를 찾지 못했습니다.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "파일을 분석하는 중 오류가 발생했습니다.";
      setError(message);
      setParsedData([]);
      setPreviewData([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateColumnMapping = useCallback((update: Partial<ColumnMapping>) => {
    setColumnMapping((prev) => ({
      ...prev,
      ...Object.fromEntries(
        Object.entries(update).map(([key, value]) => [key, value ?? ""]),
      ),
    }));
  }, []);

  const reset = useCallback(() => {
    setColumnMapping({ ...FIXED_COLUMN_MAPPING });
    setHeaders([...HEADER_SEQUENCE]);
    setError(null);
    setPreviewData([]);
    setParsedData([]);
  }, []);

  return useMemo(
    () => ({
      parseFile,
      headers,
      error,
      isLoading,
      columnMapping,
      previewData,
      parsedData,
      updateColumnMapping,
      reset,
    }),
    [columnMapping, error, headers, isLoading, parseFile, parsedData, previewData, reset, updateColumnMapping],
  );
}

export default useExcelParser;