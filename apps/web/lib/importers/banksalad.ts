import * as XLSX from "xlsx";

export type TxnType = "INCOME" | "EXPENSE" | "TRANSFER";

export type BulkTransactionInput = {
  user_id: number;
  occurred_at: string;
  occurred_time?: string;
  type: TxnType;
  amount: number;
  currency: string;
  account_name: string;
  counter_account_name?: string;
  category_group_name?: string;
  category_name?: string;
  memo?: string;
  external_id?: string;
  transfer_flow?: "OUT" | "IN";
};

export type BankSaladParseSummary = {
  total: number;
  byType: Record<TxnType, number>;
};

export type MatchConfidenceLevel = "CERTAIN" | "SUSPECTED" | "UNLIKELY";

export type MatchConfidence = {
  score: number; // 0-100
  level: MatchConfidenceLevel;
  reasons: string[];
};

export type SuspectedPair = {
  id: string;
  confidence: MatchConfidence;
  outgoing: BulkTransactionInput;
  incoming: BulkTransactionInput;
};

export type BankSaladParseResult = {
  items: BulkTransactionInput[];
  issues: string[];
  summary: BankSaladParseSummary;
  suspectedPairs: SuspectedPair[]; // 사용자 확인이 필요한 의심 매칭
};

export type PendingTransfer = {
  rowIndex: number;
  occurred_at: string;
  occurred_time: string;
  currency: string;
  amount: number;
  account_name: string;
  groupText: string;
  categoryText: string;
  contentText: string;
  memoCombined?: string;
  originalExternalIdBase: string;
};

export type BankSaladParseOptions = {
  existingAccounts?: string[];
  // 단일 계좌 원장 모드: 모든 전표의 account_name을 특정 계좌로 고정하고,
  // 이체에서 상대 계좌를 찾지 못하면 지출/수입으로 강등하여 단일 전표로 저장합니다.
  rawSingleAccountMode?: boolean;
  // rawSingleAccountMode일 때 명시적으로 고정할 계좌명 (없으면 시트에서 자동 검출)
  primaryAccountName?: string;
  // 특정 패턴의 이체를 잔액중립(내부/정산)으로 간주하여 단일 모드에서도 TRANSFER로 유지
  neutralTransferPatterns?: {
    group?: string[];
    category?: string[];
    memo?: string[];
    content?: string[];
  };
};

const SHEET_NAME = "가계부 내역";
const DEFAULT_TIME = "09:00:00";
const DEFAULT_ACCOUNT = "기타 결제수단";
const DEFAULT_GROUP: Record<TxnType, string> = {
  INCOME: "기타 수입",
  EXPENSE: "기타 지출",
  TRANSFER: "이체",
};
const DEFAULT_CATEGORY: Record<Exclude<TxnType, "TRANSFER">, string> = {
  INCOME: "미분류 수입",
  EXPENSE: "미분류 지출",
};
const DEFAULT_TRANSFER_CATEGORY = "미분류 이체";

const TYPE_MAP: Record<string, TxnType> = {
  INCOME: "INCOME",
  EXPENSE: "EXPENSE",
  TRANSFER: "TRANSFER",
  수입: "INCOME",
  지출: "EXPENSE",
  이체: "TRANSFER",
  입금: "INCOME",
  출금: "EXPENSE",
  account: "TRANSFER",
};

const CURRENCY_MAP: Record<string, string> = {
  원: "KRW",
  "\u20a9": "KRW", // ₩
  krw: "KRW",
  usd: "USD",
  jpy: "JPY",
  cny: "CNY",
};

type ColumnKey =
  | "date"
  | "time"
  | "type"
  | "group"
  | "category"
  | "content"
  | "amount"
  | "currency"
  | "account"
  | "memo"
  | "income"
  | "expense"
  | "sourceAccount"
  | "targetAccount";

const COLUMN_ALIASES: Record<ColumnKey, string[]> = {
  date: ["날짜", "date", "거래일", "일자"],
  time: ["시간", "time"],
  type: ["분류", "type", "유형", "거래유형", "거래분류", "타입"],
  group: ["대분류", "카테고리대분류", "거래대분류", "중분류", "그룹"],
  category: [
    "소분류",
    "카테고리",
    "카테고리소분류",
    "상세분류",
    "세부분류",
    "거래소분류",
    "상세카테고리",
    "항목",
    "소카테고리",
    "하위분류",
  ],
  content: ["내용", "내역", "상세내용", "거래처", "거래내역", "상세", "적요"],
  amount: ["금액", "거래금액", "금액원", "amount", "합계", "총금액"],
  currency: ["통화", "currency", "화폐"],
  account: ["결제수단", "계좌", "계좌명", "자산", "사용자산", "수단"],
  memo: ["메모", "비고", "설명", "노트"],
  income: ["입금", "입금금액", "입금액", "수입", "income"],
  expense: ["출금", "출금금액", "출금액", "지출", "expense"],
  sourceAccount: ["출금자산", "출금계좌", "출금수단", "보낸자산", "보낸계좌"],
  targetAccount: ["입금자산", "입금계좌", "입금수단", "받은자산", "받은계좌"],
};

const FALLBACK_COLUMN_INDEX: Partial<Record<ColumnKey, number>> = {
  date: 0,
  time: 1,
  type: 2,
  group: 3,
  category: 4,
  content: 5,
  amount: 6,
  currency: 7,
  account: 8,
  memo: 9,
};

function normalizeHeaderName(value: unknown): string {
  const raw = toText(value);
  if (!raw) return "";
  return raw.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "").toLowerCase();
}

function buildColumnMap(headerRow: unknown[]): Partial<Record<ColumnKey, number>> {
  const map: Partial<Record<ColumnKey, number>> = {};
  headerRow.forEach((cell, idx) => {
    const normalized = normalizeHeaderName(cell);
    if (!normalized) return;
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES) as Array<[ColumnKey, string[]]>) {
      if (aliases.includes(normalized) && map[key] == null) {
        map[key] = idx;
      }
    }
  });
  return map;
}

function getCell(row: unknown[], map: Partial<Record<ColumnKey, number>>, key: ColumnKey): unknown {
  const idx = map[key];
  const fallback = FALLBACK_COLUMN_INDEX[key];
  const finalIndex = idx ?? fallback;
  if (finalIndex == null) return undefined;
  return finalIndex < row.length ? row[finalIndex] : undefined;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseExcelDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed
      .replace(/[년]/g, "-")
      .replace(/[월]/g, "-")
      .replace(/[일]/g, "")
      .replace(/[./]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    const tokens = normalized.split(/[\s-]/).filter(Boolean);
    if (tokens.length >= 3 && tokens[0].length === 4) {
      const year = Number(tokens[0]);
      const month = Number(tokens[1]);
      const day = Number(tokens[2]);
      if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        Number.isFinite(day) &&
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= 31
      ) {
        return new Date(Date.UTC(year, month - 1, day));
      }
    }
    const fallback = new Date(trimmed);
    if (!Number.isNaN(fallback.getTime())) {
      return new Date(Date.UTC(fallback.getFullYear(), fallback.getMonth(), fallback.getDate()));
    }
  }
  return null;
}

function formatTime(h: number, m: number, s: number): string {
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function parseExcelTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatTime(value.getHours(), value.getMinutes(), value.getSeconds());
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const hours = parsed.H ?? parsed.h ?? 0;
    const minutes = parsed.M ?? parsed.m ?? 0;
    const seconds = Math.round(parsed.S ?? parsed.s ?? 0);
    return formatTime(hours, minutes, seconds);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(오전|오후)?\s*(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*(AM|PM)?$/i);
    if (match) {
      let hours = Number(match[2]);
      const minutes = Number(match[3] ?? "0");
      const seconds = Number(match[4] ?? "0");
      const meridiem = (match[1] ?? match[5] ?? "").toUpperCase();
      if (meridiem === "오후" || meridiem === "PM") {
        if (hours < 12) hours += 12;
      } else if ((meridiem === "오전" || meridiem === "AM") && hours === 12) {
        hours = 0;
      }
      return formatTime(hours % 24, minutes % 60, seconds % 60);
    }
    const withDate = new Date(`1970-01-01T${trimmed}`);
    if (!Number.isNaN(withDate.getTime())) {
      return formatTime(withDate.getHours(), withDate.getMinutes(), withDate.getSeconds());
    }
  }
  return null;
}

function parseType(value: unknown): TxnType | null {
  if (value == null) return null;
  const key = String(value).trim();
  if (!key) return null;
  const mapped = TYPE_MAP[key] ?? TYPE_MAP[key.toUpperCase()];
  return mapped ?? null;
}

function parseAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "string") {
    const sanitized = value.replace(/[ ,\s]/g, "").replace(/[원₩]/g, "");
    if (!sanitized) return null;
    const num = Number(sanitized);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function normalizeCurrency(value: unknown): string {
  if (value == null) return "KRW";
  const key = String(value).trim();
  if (!key) return "KRW";
  const mapped = CURRENCY_MAP[key] ?? CURRENCY_MAP[key.toLowerCase()];
  if (mapped) return mapped;
  if (key.length === 3) return key.toUpperCase();
  return "KRW";
}

function toText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function ensureDifferentAccount(base: string, candidate: string, fallbackIndex: number): string {
  const cleaned = candidate.trim();
  if (!cleaned) return `${DEFAULT_GROUP.TRANSFER} 대상 ${fallbackIndex}`;
  if (cleaned === base) return `${cleaned} (상대)`;
  return cleaned;
}

function deriveCounterAccount(accountName: string, rowIndex: number, ...sources: (unknown)[]): string {
  for (const source of sources) {
    const text = toText(source);
    if (!text) continue;
    const arrowMatch = text.match(/[\-\u2192\u2190\u2194>→↔]\s*([^\-→↔>]+)$/);
    if (arrowMatch && arrowMatch[1]) {
      return ensureDifferentAccount(accountName, arrowMatch[1], rowIndex);
    }
    const slashParts = text.split(/[\/|]/).map((p) => p.trim()).filter(Boolean);
    if (slashParts.length >= 2) {
      return ensureDifferentAccount(accountName, slashParts[slashParts.length - 1], rowIndex);
    }
    if (text.length <= 20) {
      return ensureDifferentAccount(accountName, text, rowIndex);
    }
  }
  return `${DEFAULT_GROUP.TRANSFER} 대상 ${rowIndex}`;
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

const INTERNAL_TRANSFER_KEYWORDS = ["내계좌", "내통장", "내카드", "myaccount", "mywallet"];

function isInternalTransfer(label: string): boolean {
  if (!label) return false;
  const normalized = normalizeLabel(label);
  return INTERNAL_TRANSFER_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

// 카드대금/정산 등 잔액중립 이체 판별 (기본 패턴 포함)
const DEFAULT_NEUTRAL_PATTERNS = {
  group: ["내계좌이체", "이체"],
  category: ["카드대금", "카드 결제", "신용카드대금", "카드대금결제"],
  memo: ["카드대금", "카드 결제", "결제대금", "신용카드"],
  content: ["카드대금", "카드 결제", "결제대금", "신용카드"],
};

function includesAny(hay: string, needles?: string[]): boolean {
  if (!hay || !needles || needles.length === 0) return false;
  const h = normalizeLabel(hay);
  return needles.some((n) => h.includes(normalizeLabel(n)));
}

function isNeutralTransferByPatterns(
  groupText: string,
  categoryText: string,
  memoText: string,
  contentText: string,
  options: BankSaladParseOptions
): boolean {
  const patterns = options.neutralTransferPatterns ?? DEFAULT_NEUTRAL_PATTERNS;
  // 그룹/카테고리/메모/내용 어느 하나라도 패턴에 매칭되면 잔액중립으로 간주
  if (includesAny(groupText, patterns.group)) return true;
  if (includesAny(categoryText, patterns.category)) return true;
  if (includesAny(memoText, patterns.memo)) return true;
  if (includesAny(contentText, patterns.content)) return true;
  return false;
}

type AccountMatcher = {
  match: (candidate: string) => string | undefined;
};

function normalizeAccountKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase();
}

/**
 * 두 문자열의 유사도를 계산 (Levenshtein distance 기반)
 * @returns 0.0 (완전 다름) ~ 1.0 (완전 동일)
 */
function calculateSimilarity(a: string | undefined, b: string | undefined): number {
  if (!a && !b) return 1.0;
  if (!a || !b) return 0.0;
  
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  
  if (s1 === s2) return 1.0;
  
  const len1 = s1.length;
  const len2 = s2.length;
  
  if (len1 === 0) return len2 === 0 ? 1.0 : 0.0;
  if (len2 === 0) return 0.0;
  
  // Levenshtein distance
  const matrix: number[][] = [];
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return 1.0 - distance / maxLen;
}

/**
 * 두 거래의 내부 이체 매칭 신뢰도를 계산
 */
function calculateMatchConfidence(
  out: PendingTransfer,
  inn: PendingTransfer
): MatchConfidence {
  let score = 0;
  const reasons: string[] = [];

  // 시간 차이 계산 헬퍼
  const parseTime = (t: string) => {
    if (!t) return 0;
    const parts = t.split(":");
    const h = parseInt(parts[0] || "0", 10);
    const m = parseInt(parts[1] || "0", 10);
    const s = parseInt(parts[2] || "0", 10);
    return h * 3600 + m * 60 + s;
  };
  
  const timeDiffSeconds = Math.abs(parseTime(out.occurred_time) - parseTime(inn.occurred_time));

  // 필수 조건: 날짜 일치 + 금액 절대값 일치 + 시간 근접 (60초 이내)
  const dateMatch = out.occurred_at === inn.occurred_at;
  const amountMatch = Math.abs(out.amount) === Math.abs(inn.amount) && out.currency === inn.currency;
  const timeClose = timeDiffSeconds <= 60;
  
  if (!dateMatch || !amountMatch || !timeClose) {
    const failReasons = [];
    if (!dateMatch) failReasons.push("날짜 불일치");
    if (!amountMatch) failReasons.push("금액 불일치");
    if (!timeClose) failReasons.push(`시간 차이 ${timeDiffSeconds}초 (60초 초과)`);
    return {
      score: 0,
      level: "UNLIKELY",
      reasons: failReasons,
    };
  }
  
  // 기본 점수: 날짜+금액 일치 (50점)
  score += 50;
  if (timeDiffSeconds === 0) {
    reasons.push("시간 정확히 일치");
  } else if (timeDiffSeconds <= 5) {
    score -= 5;
    reasons.push(`시간 거의 일치 (${timeDiffSeconds}초 차이, -5점)`);
  } else {
    score -= 10;
    reasons.push(`시간 근접 (${timeDiffSeconds}초 차이, -10점)`);
  }


  // 분류명 확인 (+30점)
  const internalKeywords = ["내계좌이체", "계좌이체", "이체", "transfer"];
  const outKeywords = [
    out.groupText,
    out.categoryText,
    out.contentText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const innKeywords = [
    inn.groupText,
    inn.categoryText,
    inn.contentText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const outHasKeyword = internalKeywords.some((kw) => outKeywords.includes(kw));
  const innHasKeyword = internalKeywords.some((kw) => innKeywords.includes(kw));

  if (outHasKeyword && innHasKeyword) {
    score += 30;
    reasons.push("분류명이 내부 이체 패턴과 일치");
    
    // "내계좌이체" 명시된 경우 보너스 (+10점)
    if (
      outKeywords.includes("내계좌이체") &&
      innKeywords.includes("내계좌이체")
    ) {
      score += 10;
      reasons.push("'내계좌이체' 명시");
    }
  } else if (outHasKeyword || innHasKeyword) {
    score += 15;
    reasons.push("일부 이체 키워드 포함");
  }

  // 계좌 정보 확인 (+10점 or -20점)
  const outAccountKey = normalizeAccountKey(out.account_name);
  const innAccountKey = normalizeAccountKey(inn.account_name);
  
  if (outAccountKey !== innAccountKey) {
    score += 10;
    reasons.push("서로 다른 계좌");
  } else {
    score -= 20;
    reasons.push("⚠️ 동일 계좌 (A→A)");
  }

  // Memo 유사도 (+10점 or -10점)
  const memoSimilarity = calculateSimilarity(out.memoCombined, inn.memoCombined);
  if (memoSimilarity > 0.7) {
    score += 10;
    reasons.push(`내용 유사 (${Math.round(memoSimilarity * 100)}%)`);
  } else if (memoSimilarity < 0.3) {
    score -= 10;
    reasons.push(`⚠️ 내용 불일치 (${Math.round(memoSimilarity * 100)}%)`);
  }

  // 신뢰도 레벨 결정
  let level: MatchConfidenceLevel;
  if (score >= 80) {
    level = "CERTAIN"; // 자동 처리
  } else if (score >= 50) {
    level = "SUSPECTED"; // 사용자 확인 필요
  } else {
    level = "UNLIKELY"; // 외부 이체로 간주
  }

  return { score, level, reasons };
}

function createAccountMatcher(names: string[] | undefined): AccountMatcher {
  const map = new Map<string, string>();
  if (names) {
    for (const raw of names) {
      const trimmed = raw?.trim();
      if (!trimmed) continue;
      const key = normalizeAccountKey(trimmed);
      if (key) {
        map.set(key, trimmed);
      }
    }
  }

  const match = (candidate: string): string | undefined => {
    const text = candidate.trim();
    if (!text) return undefined;
    const clean = normalizeAccountKey(text);
    if (!clean) return undefined;
    return map.get(clean);
  };

  return { match };
}

function pickAccountName(
  candidates: Array<string | undefined>,
  matcher: AccountMatcher,
  fallback: string
): { name: string; matched: boolean } {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const matched = matcher.match(candidate);
    if (matched) {
      return { name: matched, matched: true };
    }
  }
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return { name: candidate.trim(), matched: false };
    }
  }
  return { name: fallback, matched: false };
}

export function parseBankSaladWorkbook(
  buffer: ArrayBuffer,
  userId: number,
  options: BankSaladParseOptions = {}
): BankSaladParseResult {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[SHEET_NAME] ?? (workbook.SheetNames[1] ? workbook.Sheets[workbook.SheetNames[1]] : undefined);
  if (!sheet) {
    return {
      items: [],
      issues: ["시트 '가계부 내역'을 찾지 못했습니다."],
      summary: { total: 0, byType: { INCOME: 0, EXPENSE: 0, TRANSFER: 0 } },
      suspectedPairs: [],
    };
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
  const items: BulkTransactionInput[] = [];
  const issues: string[] = [];
  const accountMatcher = createAccountMatcher(options.existingAccounts);
  const transferDedupKeys = new Set<string>();

  // 헤더/데이터 시작 위치 계산

  let headerRowIndex = 0;
  while (headerRowIndex < rows.length && isRowEmpty(rows[headerRowIndex])) headerRowIndex += 1;
  const hasHeader = headerRowIndex < rows.length;
  const headerRow = hasHeader ? rows[headerRowIndex] ?? [] : [];
  const columnMap = buildColumnMap(headerRow);
  let dataStart = hasHeader ? headerRowIndex + 1 : headerRowIndex;
  while (dataStart < rows.length && isRowEmpty(rows[dataStart])) dataStart += 1;

  // 단일 계좌 원장 모드 자동 검출: 결제수단 컬럼이 사실상 하나로 고정되어 있으면 사용
  const normalize = (v: string) => normalizeAccountKey(v);
  let primaryAccountName: string | undefined = options.primaryAccountName?.trim() || undefined;
  let rawSingleAccountMode = !!options.rawSingleAccountMode;
  // 단일 계좌 모드 자동 감지 제거: 사용자 명시적 선택만 허용
  // (이체 타입 보존을 위해 자동 활성화 비활성화)
  /*
  if (!primaryAccountName) {
    const counts = new Map<string, { raw: string; n: number }>();
    for (let i = dataStart; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      if (isRowEmpty(row)) continue;
      const rawAccount = toText(getCell(row, columnMap, "account"));
      if (!rawAccount) continue;
      const key = normalize(rawAccount);
      if (!key) continue;
      const prev = counts.get(key);
      if (prev) prev.n += 1; else counts.set(key, { raw: rawAccount.trim(), n: 1 });
    }
    let total = 0; let bestKey: string | undefined; let best = 0; let bestRaw = "";
    for (const [, v] of counts) total += v.n;
    for (const [k, v] of counts) { if (v.n > best) { best = v.n; bestKey = k; bestRaw = v.raw; } }
    if (bestKey && total > 0 && best / total >= 0.8) {
      // 기존 계좌와 정확 일치 시 그 이름으로, 아니면 원본 유지
      const matched = accountMatcher.match(bestRaw);
      primaryAccountName = matched ?? bestRaw;
      rawSingleAccountMode = true; // 자동 활성화
    }
  }
  */
  const primaryKey = primaryAccountName ? normalizeAccountKey(primaryAccountName) : undefined;

  // 내부 이체 후보(명시적 상대 계좌를 매칭하지 못했지만 동일 시각/금액 절대값 짝 가능성) 임시 저장.
  const pendingTransfers: PendingTransfer[] = [];
  for (let i = dataStart; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    if (isRowEmpty(row)) continue;

    const rawAccount = getCell(row, columnMap, "account");
    const rowAccountText = toText(rawAccount);
    const normalizedRowKey = normalizeAccountKey(rowAccountText);
    const matchesPrimary = !!primaryKey && !!normalizedRowKey && normalizedRowKey === primaryKey;
    const singleModeForRow = rawSingleAccountMode && (!primaryKey || matchesPrimary || !rowAccountText);

    const rawDate = getCell(row, columnMap, "date");
    const rawTime = getCell(row, columnMap, "time");
    const rawType = getCell(row, columnMap, "type");
    const rawGroup = getCell(row, columnMap, "group");
    const rawCategory = getCell(row, columnMap, "category");
    const rawContent = getCell(row, columnMap, "content");
    const rawAmount = getCell(row, columnMap, "amount");
    const rawCurrency = getCell(row, columnMap, "currency");
    const rawMemo = getCell(row, columnMap, "memo");
    const rawIncome = getCell(row, columnMap, "income");
    const rawExpense = getCell(row, columnMap, "expense");
    const rawSourceAccount = getCell(row, columnMap, "sourceAccount");
    const rawTargetAccount = getCell(row, columnMap, "targetAccount");

    const date = parseExcelDate(rawDate);
    if (!date) {
      issues.push(`R${i + 1}: 날짜를 해석할 수 없습니다.`);
      continue;
    }
    const occurred_at = toISODate(date);

    const parsedType = parseType(rawType);
    if (!parsedType) {
      issues.push(`R${i + 1}: 유형을 해석할 수 없습니다.`);
      continue;
    }

    const originalAmountNum = parseAmount(rawAmount);
    let amountRaw = originalAmountNum;
    const incomeAmount = parseAmount(rawIncome);
    const expenseAmount = parseAmount(rawExpense);
    if (amountRaw == null) {
      if (parsedType === "INCOME" && incomeAmount != null) {
        amountRaw = incomeAmount;
      } else if (parsedType === "EXPENSE" && expenseAmount != null) {
        amountRaw = expenseAmount;
      } else if (parsedType === "TRANSFER") {
        amountRaw = incomeAmount ?? expenseAmount;
      } else if (incomeAmount != null && expenseAmount == null) {
        amountRaw = incomeAmount;
      } else if (expenseAmount != null && incomeAmount == null) {
        amountRaw = expenseAmount;
      }
    }
    if (amountRaw == null) {
      issues.push(`R${i + 1}: 금액을 해석할 수 없습니다.`);
      continue;
    }

    const hasSeparateIncomeExpense =
      (incomeAmount != null && incomeAmount !== 0) || (expenseAmount != null && expenseAmount !== 0);

    let amount = parsedType === "TRANSFER" ? Math.abs(amountRaw) : amountRaw;
    if (parsedType === "EXPENSE") {
      if (hasSeparateIncomeExpense) {
        if (expenseAmount != null && expenseAmount !== 0) {
          amount = -Math.abs(expenseAmount);
        } else if (incomeAmount != null && incomeAmount !== 0) {
          amount = Math.abs(incomeAmount);
        }
      }
    } else if (parsedType === "INCOME") {
      if (hasSeparateIncomeExpense) {
        if (incomeAmount != null && incomeAmount !== 0) {
          amount = Math.abs(incomeAmount);
        } else if (expenseAmount != null && expenseAmount !== 0) {
          amount = -Math.abs(expenseAmount);
        }
      }
    }
    if (Math.abs(amount) === 0) {
      amount = 0;
    }

    const time = parseExcelTime(rawTime) ?? DEFAULT_TIME;
    const currency = normalizeCurrency(rawCurrency);

    const groupText = toText(rawGroup);
    const categoryText = toText(rawCategory);
    const contentText = toText(rawContent);
    const memoText = toText(rawMemo);
    const memoCombined = [contentText, memoText].filter(Boolean).join(" / ").trim() || undefined;

    const sourceAccountText = toText(rawSourceAccount);
    const targetAccountText = toText(rawTargetAccount);

    if (parsedType === "TRANSFER") {
      // 단일 계좌 모드에서는 지정된 계좌 행만 단일 전표(수입/지출)로 강등하거나 단일 TRANSFER로 유지한다.
      if (singleModeForRow) {
        const neutral = isNeutralTransferByPatterns(groupText, toText(rawCategory), memoText, contentText, options);
        if (neutral) {
          const paymentMethod = rowAccountText;
          let { name: accountName } = pickAccountName([
            paymentMethod,
            toText(rawSourceAccount),
          ], accountMatcher, DEFAULT_ACCOUNT);
          if (primaryAccountName) accountName = primaryAccountName;
          const categoryGroupName = groupText || DEFAULT_GROUP.TRANSFER;
          const categoryName = toText(rawCategory) || contentText || memoText || DEFAULT_TRANSFER_CATEGORY;
          items.push({
            user_id: userId,
            occurred_at,
            occurred_time: time,
            type: "TRANSFER",
            amount: Math.abs(amount),
            currency,
            account_name: accountName,
            // 단일 모드에서는 상대 계좌를 지정하지 않음 (순수 원장 전표)
            category_group_name: categoryGroupName,
            category_name: categoryName,
            memo: memoCombined,
            external_id: `banksalad-${occurred_at.replace(/-/g, "")}-${String(i + 1)}-${Math.abs(Math.round(amount))}`,
          });
          continue;
        }
        // 방향 판정: expenseAmount > 0 이면 출금(지출), incomeAmount > 0 이면 입금(수입), 아니면 원본 부호로 판단
        // 원본 전표의 흐름을 추가로 기록하여, 단일 모드에서 강등되더라도 사용자가 나중에 방향성을 추적 가능하도록 transfer_flow 메타 유지
        const direction: "OUT" | "IN" = (expenseAmount != null && expenseAmount !== 0)
          ? "OUT"
          : (incomeAmount != null && incomeAmount !== 0)
            ? "IN"
            : (originalAmountNum != null
              ? (originalAmountNum < 0 ? "OUT" : "IN")
              : "OUT");
        const paymentMethod = rowAccountText;
        let { name: accountName } = pickAccountName([
          paymentMethod,
          toText(rawSourceAccount),
        ], accountMatcher, DEFAULT_ACCOUNT);
        if (primaryAccountName) accountName = primaryAccountName;

        const downgradedType: TxnType = direction === "OUT" ? "EXPENSE" : "INCOME";
        const magnitude = Math.abs(
          incomeAmount ?? expenseAmount ?? originalAmountNum ?? 0
        );
        const signed = downgradedType === "EXPENSE" ? -Math.abs(magnitude) : Math.abs(magnitude);
        const dgGroup = DEFAULT_GROUP[downgradedType];
        const dgCategory = DEFAULT_CATEGORY[downgradedType as Exclude<TxnType, "TRANSFER">];
        
        // 강등 시 카테고리 처리: "이체" 카테고리를 사용하지 않고 기본값 사용
        // (TRANSFER → INCOME/EXPENSE 변환 시 통계 오염 방지)
        const shouldUseOriginalCategory = 
          groupText && 
          categoryText && 
          !["이체", "내계좌이체", "계좌이체", "transfer"].includes(categoryText.toLowerCase().replace(/\s+/g, ""));
        
        items.push({
          user_id: userId,
          occurred_at,
          occurred_time: time,
          type: downgradedType,
          amount: signed,
          currency,
          account_name: accountName,
          category_group_name: shouldUseOriginalCategory ? groupText : dgGroup,
          category_name: shouldUseOriginalCategory ? categoryText : dgCategory,
          memo: [toText(rawContent), toText(rawMemo)].filter(Boolean).join(" / ") || undefined,
          external_id: `banksalad-${occurred_at.replace(/-/g, "")}-${String(i + 1)}-${Math.abs(Math.round(signed))}`,
          // 단일 모드 강등 전 'TRANSFER'였던 행의 방향성 기록
          transfer_flow: direction,
        });
        continue;
      }
    const paymentMethod = rowAccountText;
      const accountPick = pickAccountName([
        paymentMethod,
        sourceAccountText,
      ], accountMatcher, DEFAULT_ACCOUNT);
      let accountName = accountPick.name;
      if (singleModeForRow && primaryAccountName) {
        accountName = primaryAccountName;
      }
      const primaryAccountKey = normalizeAccountKey(accountName);

      const categoryGroupName = groupText || DEFAULT_GROUP.TRANSFER;
      const categoryName = categoryText || contentText || memoText || DEFAULT_TRANSFER_CATEGORY;

      // 방향성 판정 (원본 금액의 부호와 입출금 컬럼 기준)
      const sourceKey = sourceAccountText ? normalizeAccountKey(sourceAccountText) : "";
      const targetKey = targetAccountText ? normalizeAccountKey(targetAccountText) : "";
      let transferFlow: "OUT" | "IN" | undefined;
      if (sourceKey && sourceKey === primaryAccountKey) {
        transferFlow = "OUT";
      } else if (targetKey && targetKey === primaryAccountKey) {
        transferFlow = "IN";
      } else if (expenseAmount != null && expenseAmount !== 0) {
        transferFlow = "OUT";
      } else if (incomeAmount != null && incomeAmount !== 0) {
        transferFlow = "IN";
      } else if (originalAmountNum != null) {
        transferFlow = originalAmountNum < 0 ? "OUT" : "IN";
      }

      // 명시된 계좌 컬럼(targetAccountText / sourceAccountText) 기준 매칭 시도
      let counterAccount: string | undefined;
      let counterMatched = false;
      
      // 1순위: targetAccountText 매칭 시도
      if (targetAccountText) {
        const matched = accountMatcher.match(targetAccountText);
        if (matched && normalizeAccountKey(matched) !== primaryAccountKey) {
          counterAccount = matched;
          counterMatched = true;
        }
      }
      // 2순위: sourceAccountText 매칭 시도 (위에서 실패한 경우)
      if (!counterMatched && sourceAccountText) {
        const matched = accountMatcher.match(sourceAccountText);
        if (matched && normalizeAccountKey(matched) !== primaryAccountKey) {
          counterAccount = matched;
          counterMatched = true;
        }
      }

      // 상대 계좌 명시적으로 확정 못한 경우: 내부 이체 짝 후보로 보관 (후처리 페어링)
      if (!counterMatched) {
        const magnitudeSource =
          originalAmountNum != null && originalAmountNum !== 0
            ? originalAmountNum
            : expenseAmount != null && expenseAmount !== 0
              ? expenseAmount
              : incomeAmount != null && incomeAmount !== 0
                ? incomeAmount
                : amount;
        const magnitude = Math.abs(magnitudeSource ?? 0);
        let signedAmount: number;
        if (transferFlow === "OUT") {
          signedAmount = -magnitude;
        } else if (transferFlow === "IN") {
          signedAmount = magnitude;
        } else if (originalAmountNum != null && originalAmountNum !== 0) {
          signedAmount = originalAmountNum;
        } else if (expenseAmount != null && expenseAmount !== 0) {
          signedAmount = -Math.abs(expenseAmount);
        } else if (incomeAmount != null && incomeAmount !== 0) {
          signedAmount = Math.abs(incomeAmount);
        } else {
          signedAmount = magnitude;
        }
        pendingTransfers.push({
          rowIndex: i + 1,
          occurred_at,
          occurred_time: time,
          currency,
          amount: signedAmount,
          account_name: accountName,
          groupText,
          categoryText,
          contentText,
          memoCombined,
          originalExternalIdBase: `banksalad-${occurred_at.replace(/-/g, "")}-${String(i + 1)}`,
        });
        continue;
      }

      // 명시 매칭 성공 → 즉시 TRANSFER 확정 (중복 방지 dedupKey 등록)
      if (counterMatched && counterAccount) {
        const counterKey = normalizeAccountKey(counterAccount);
        if (counterKey) {
          const pairKey = [primaryAccountKey, counterKey].sort().join("::");
          const dedupKey = `${occurred_at}::${time}::${Math.abs(amount)}::${pairKey}`;
          if (transferDedupKeys.has(dedupKey)) {
            issues.push(`R${i + 1}: 중복으로 판단된 이체 전표를 건너뜁니다.`);
            continue;
          }
          transferDedupKeys.add(dedupKey);
        }
        // 명시적 확정된 TRANSFER: 원본 금액 부호 그대로 사용 (바꾸지 않음)
        const finalAmount = (originalAmountNum != null && originalAmountNum !== 0)
          ? originalAmountNum
          : (expenseAmount != null && expenseAmount !== 0)
            ? -Math.abs(expenseAmount)
            : (incomeAmount != null && incomeAmount !== 0)
              ? Math.abs(incomeAmount)
              : 0;
        items.push({
          user_id: userId,
          occurred_at,
          occurred_time: time,
          type: parsedType,
          amount: finalAmount,
          currency,
          account_name: accountName,
          counter_account_name: counterAccount,
          category_group_name: categoryGroupName,
          category_name: categoryName,
          memo: memoCombined,
          external_id: `banksalad-${occurred_at.replace(/-/g, "")}-${String(i + 1)}-${Math.abs(Math.round(finalAmount))}`,
          transfer_flow: transferFlow,
        });
        continue;
      }
    }

    const paymentMethod = rowAccountText;
    const fallbackCandidates: Array<string | undefined> = [paymentMethod];
    if (parsedType === "EXPENSE") {
      fallbackCandidates.push(sourceAccountText);
    } else if (parsedType === "INCOME") {
      fallbackCandidates.push(targetAccountText);
    } else {
      fallbackCandidates.push(sourceAccountText, targetAccountText);
    }
    let { name: accountName } = pickAccountName(fallbackCandidates, accountMatcher, DEFAULT_ACCOUNT);
    if (singleModeForRow && primaryAccountName) {
      accountName = primaryAccountName;
    }

    const categoryGroupName = groupText || DEFAULT_GROUP[parsedType];
    const categoryName = parsedType !== "TRANSFER" 
      ? (categoryText || contentText || memoText || DEFAULT_CATEGORY[parsedType])
      : (categoryText || contentText || memoText || "미분류");

    const external_id = `banksalad-${occurred_at.replace(/-/g, "")}-${String(i + 1)}-${Math.abs(Math.round(amount))}`;

    items.push({
      user_id: userId,
      occurred_at,
      occurred_time: time,
      type: parsedType,
      amount,
      currency,
      account_name: accountName,
      counter_account_name: undefined,
      category_group_name: categoryGroupName,
      category_name: categoryName,
      memo: memoCombined,
      external_id,
    });
  }

  // 2차 처리: pendingTransfers를 날짜+시간+절대금액+통화 기준으로 OUT/IN 페어링하여 단일 TRANSFER로 축약.
  const suspectedPairs: SuspectedPair[] = [];
  let suspectedPairId = 0;
  
  console.log('[DEBUG] pendingTransfers:', pendingTransfers.length, pendingTransfers);
  
  // 시간을 분 단위로 반올림하는 헬퍼 (60초 tolerance를 위해)
  const roundTimeToMinute = (timeStr: string): string => {
    if (!timeStr) return "00:00";
    const parts = timeStr.split(":");
    const hours = parts[0] || "00";
    const minutes = parts[1] || "00";
    return `${hours}:${minutes}`;
  };
  
  // 두 시간의 차이가 60초 이내인지 확인
  const isWithin60Seconds = (time1: string, time2: string): boolean => {
    if (!time1 || !time2) return true;
    const parse = (t: string) => {
      const parts = t.split(":");
      const h = parseInt(parts[0] || "0", 10);
      const m = parseInt(parts[1] || "0", 10);
      const s = parseInt(parts[2] || "0", 10);
      return h * 3600 + m * 60 + s;
    };
    const sec1 = parse(time1);
    const sec2 = parse(time2);
    return Math.abs(sec1 - sec2) <= 60;
  };
  
  if (pendingTransfers.length > 0) {
    // 날짜 + 금액 + 통화로만 1차 그룹핑 (시간은 나중에 체크)
    const groups = new Map<string, PendingTransfer[]>();
    for (const p of pendingTransfers) {
      const key = `${p.occurred_at}::${Math.abs(p.amount)}::${p.currency}`;
      const arr = groups.get(key) || [];
      arr.push(p);
      groups.set(key, arr);
    }
    console.log('[DEBUG] groups (by date+amount):', groups.size, Array.from(groups.entries()));
    for (const [key, arr] of groups) {
      const outs = arr.filter((r) => r.amount < 0);
      const ins = arr.filter((r) => r.amount > 0);
      const distinctAccountCount = new Set(arr.map((r) => normalizeAccountKey(r.account_name))).size;
      
      // 페어링 가능 여부 판단: OUT과 IN이 모두 있어야 함
      const pairCount = Math.min(outs.length, ins.length);
      
      if (pairCount === 0) {
        // 짝이 없는 단독 항목 → 외부 이체로 간주하여 INCOME/EXPENSE로 변환
        // (예: 급여 입금, 외부 송금 등)
        for (const single of arr) {
          const externalType: TxnType = single.amount < 0 ? "EXPENSE" : "INCOME";
          const fallbackGroup = single.groupText || DEFAULT_GROUP[externalType];
          const fallbackCategory = single.categoryText || single.contentText || single.memoCombined || DEFAULT_CATEGORY[externalType as Exclude<TxnType, "TRANSFER">];
          
          items.push({
            user_id: userId,
            occurred_at: single.occurred_at,
            occurred_time: single.occurred_time,
            type: externalType, // 외부 이체 → INCOME/EXPENSE
            amount: single.amount,
            currency: single.currency,
            account_name: single.account_name,
            category_group_name: fallbackGroup,
            category_name: fallbackCategory,
            memo: single.memoCombined,
            external_id: `${single.originalExternalIdBase}-${Math.abs(Math.round(single.amount))}`,
            transfer_flow: single.amount < 0 ? "OUT" : "IN",
          });
        }
        continue;
      }
      // 페어링: 시간이 60초 이내인 OUT-IN 쌍을 찾아 매칭
      const matchedInsIdx = new Set<number>();
      
      for (const o of outs) {
        // 시간이 60초 이내인 IN 찾기
        let bestMatch: { inn: PendingTransfer; idx: number } | null = null;
        let bestTimeDiff = Infinity;
        
        for (let j = 0; j < ins.length; j++) {
          if (matchedInsIdx.has(j)) continue;
          const inn = ins[j];
          if (!isWithin60Seconds(o.occurred_time, inn.occurred_time)) continue;
          
          // 시간 차이 계산
          const parse = (t: string) => {
            const parts = t.split(":");
            const h = parseInt(parts[0] || "0", 10);
            const m = parseInt(parts[1] || "0", 10);
            const s = parseInt(parts[2] || "0", 10);
            return h * 3600 + m * 60 + s;
          };
          const timeDiff = Math.abs(parse(o.occurred_time) - parse(inn.occurred_time));
          
          if (timeDiff < bestTimeDiff) {
            bestTimeDiff = timeDiff;
            bestMatch = { inn, idx: j };
          }
        }
        
        if (!bestMatch) {
          // 매칭 실패 → 외부 이체로 처리
          const externalType: TxnType = "EXPENSE";
          const fallbackGroup = o.groupText || DEFAULT_GROUP.EXPENSE;
          const fallbackCategory = o.categoryText || o.contentText || o.memoCombined || DEFAULT_CATEGORY.EXPENSE;
          
          items.push({
            user_id: userId,
            occurred_at: o.occurred_at,
            occurred_time: o.occurred_time,
            type: externalType,
            amount: o.amount,
            currency: o.currency,
            account_name: o.account_name,
            category_group_name: fallbackGroup,
            category_name: fallbackCategory,
            memo: o.memoCombined,
            external_id: `${o.originalExternalIdBase}-${Math.abs(Math.round(o.amount))}`,
            transfer_flow: "OUT",
          });
          continue;
        }
        
        matchedInsIdx.add(bestMatch.idx);
        const inn = bestMatch.inn;
        
        // 신뢰도 점수 계산
        const confidence = calculateMatchConfidence(o, inn);
        console.log('[DEBUG] Pair confidence:', { 
          out: o, 
          in: inn, 
          timeDiff: bestTimeDiff, 
          confidence 
        });
        
        // 동일 계좌 (A→A) 또는 신뢰도 낮음 → 외부 이체로 간주
        if (normalizeAccountKey(o.account_name) === normalizeAccountKey(inn.account_name) || confidence.level === "UNLIKELY") {
          for (const single of [o, inn]) {
            const externalType: TxnType = single.amount < 0 ? "EXPENSE" : "INCOME";
            const fallbackGroup = single.groupText || DEFAULT_GROUP[externalType];
            const fallbackCategory = single.categoryText || single.contentText || single.memoCombined || DEFAULT_CATEGORY[externalType as Exclude<TxnType, "TRANSFER">];
            
            items.push({
              user_id: userId,
              occurred_at: single.occurred_at,
              occurred_time: single.occurred_time,
              type: externalType,
              amount: single.amount,
              currency: single.currency,
              account_name: single.account_name,
              category_group_name: fallbackGroup,
              category_name: fallbackCategory,
              memo: single.memoCombined,
              external_id: `${single.originalExternalIdBase}-${Math.abs(Math.round(single.amount))}`,
              transfer_flow: single.amount < 0 ? "OUT" : "IN",
            });
          }
          continue;
        }
        
        // 신뢰도 의심 (SUSPECTED) → 사용자 확인 필요
        if (confidence.level === "SUSPECTED") {
          const outItem: BulkTransactionInput = {
            user_id: userId,
            occurred_at: o.occurred_at,
            occurred_time: o.occurred_time,
            type: "EXPENSE",
            amount: o.amount,
            currency: o.currency,
            account_name: o.account_name,
            category_group_name: o.groupText || DEFAULT_GROUP.EXPENSE,
            category_name: o.categoryText || o.contentText || o.memoCombined || DEFAULT_CATEGORY.EXPENSE,
            memo: o.memoCombined,
            external_id: `${o.originalExternalIdBase}-suspected-${Math.abs(Math.round(o.amount))}`,
            transfer_flow: "OUT",
          };
          
          const innItem: BulkTransactionInput = {
            user_id: userId,
            occurred_at: inn.occurred_at,
            occurred_time: inn.occurred_time,
            type: "INCOME",
            amount: inn.amount,
            currency: inn.currency,
            account_name: inn.account_name,
            category_group_name: inn.groupText || DEFAULT_GROUP.INCOME,
            category_name: inn.categoryText || inn.contentText || inn.memoCombined || DEFAULT_CATEGORY.INCOME,
            memo: inn.memoCombined,
            external_id: `${inn.originalExternalIdBase}-suspected-${Math.abs(Math.round(inn.amount))}`,
            transfer_flow: "IN",
          };
          
          suspectedPairs.push({
            id: `suspected-${suspectedPairId++}`,
            confidence,
            outgoing: outItem,
            incoming: innItem,
          });
          
          // 사용자 확인 대기 중이므로 items에는 추가하지 않음
          continue;
        }
        
        // 신뢰도 확실 (CERTAIN) → 자동으로 내부 이체로 등록
        const categoryGroupName = o.groupText || DEFAULT_GROUP.TRANSFER;
        const categoryName = o.categoryText || o.contentText || o.memoCombined || DEFAULT_TRANSFER_CATEGORY;
        const counterMemo = inn.account_name ? `상대:${inn.account_name}` : undefined;
        const combinedMemo = [o.memoCombined, counterMemo].filter(Boolean).join(" | ") || undefined;
        items.push({
          user_id: userId,
          occurred_at: o.occurred_at,
          occurred_time: o.occurred_time,
          type: "TRANSFER",
          amount: o.amount,
          currency: o.currency,
          account_name: o.account_name,
          counter_account_name: inn.account_name,
          category_group_name: categoryGroupName,
          category_name: categoryName,
          memo: combinedMemo,
          external_id: `${o.originalExternalIdBase}-pair-${Math.abs(Math.round(o.amount))}`,
          transfer_flow: "OUT",
        });
      }
      
      // 매칭되지 않은 IN들 처리
      for (let j = 0; j < ins.length; j++) {
        if (matchedInsIdx.has(j)) continue;
        const single = ins[j];
        const externalType: TxnType = "INCOME";
        const fallbackGroup = single.groupText || DEFAULT_GROUP.INCOME;
        const fallbackCategory = single.categoryText || single.contentText || single.memoCombined || DEFAULT_CATEGORY.INCOME;
        
        items.push({
          user_id: userId,
          occurred_at: single.occurred_at,
          occurred_time: single.occurred_time,
          type: externalType,
          amount: single.amount,
          currency: single.currency,
          account_name: single.account_name,
          category_group_name: fallbackGroup,
          category_name: fallbackCategory,
          memo: single.memoCombined,
          external_id: `${single.originalExternalIdBase}-${Math.abs(Math.round(single.amount))}`,
          transfer_flow: "IN",
        });
      }
    }
  }

  const summary: BankSaladParseSummary = {
    total: items.length,
    byType: { INCOME: 0, EXPENSE: 0, TRANSFER: 0 },
  };
  for (const item of items) {
    summary.byType[item.type] += 1;
  }

  return { items, issues, summary, suspectedPairs };
}

function isRowEmpty(row: unknown[]): boolean {
  return row.every((cell) => cell == null || (typeof cell === "string" && cell.trim() === ""));
}
