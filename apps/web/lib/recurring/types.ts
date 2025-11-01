import type { TxnType } from "../calendar/types";

export type RecurringFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurringRule = {
  id: number;
  user_id: number;
  name: string;
  type: TxnType;
  frequency: RecurringFrequency;
  day_of_month: number | null;
  weekday: number | null;
  amount: number | null;
  currency: string;
  account_id: number;
  counter_account_id: number | null;
  category_id: number | null;
  memo: string | null;
  payee_id: number | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  last_generated_at: string | null;
  is_variable_amount: boolean;
  pending_occurrences: string[];
};

export type RecurringSummaryCurrency = {
  currency: string;
  income: number;
  expense: number;
  transfer: number;
  net: number;
};

export type RecurringSummary = {
  totalRules: number;
  activeRules: number;
  inactiveRules: number;
  currencyTotals: RecurringSummaryCurrency[];
};

export type RecurringRuleCreateInput = {
  userId: number;
  name: string;
  type: TxnType;
  frequency: RecurringFrequency;
  dayOfMonth?: number | null;
  weekday?: number | null;
  amount?: number | null;
  currency: string;
  accountId: number;
  counterAccountId?: number | null;
  categoryId?: number | null;
  memo?: string | null;
  payeeId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean;
  isVariableAmount?: boolean;
};

export type RecurringRuleUpdateInput = {
  id: number;
  userId: number;
  name?: string;
  frequency?: RecurringFrequency;
  dayOfMonth?: number | null;
  weekday?: number | null;
  amount?: number | null;
  currency?: string;
  accountId?: number;
  counterAccountId?: number | null;
  categoryId?: number | null;
  memo?: string | null;
  payeeId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean;
  isVariableAmount?: boolean;
};

export type RecurringRuleDeleteInput = {
  id: number;
  userId: number;
};

export type RecurringRuleDetailParams = {
  id: number;
  userId: number;
};

export type RecurringRulePreviewParams = {
  ruleId: number;
  start: string;
  end: string;
  page?: number;
  pageSize?: number;
};

export type RecurringRuleConfirmInput = {
  ruleId: number;
  occurredAt: string;
  amount: number;
  memo?: string | null;
};

export type RecurringRulePreviewItem = {
  occurred_at: string;
  is_future: boolean;
  is_pending: boolean;
  draft_amount: number | null;
  draft_memo: string | null;
  draft_updated_at: string | null;
};

export type RecurringRulePreviewResponse = {
  items: RecurringRulePreviewItem[];
  total_count: number;
  page: number;
  page_size: number;
};

export type RecurringOccurrenceDraft = {
  occurred_at: string;
  amount: number | null;
  memo: string | null;
  updated_at: string;
};

export type RecurringOccurrenceDraftUpsertInput = {
  ruleId: number;
  occurredAt: string;
  amount?: number | null;
  memo?: string | null;
};

export type RecurringRuleBulkConfirmItem = {
  occurredAt: string;
  amount: number;
  memo?: string | null;
};

export type RecurringRuleBulkConfirmInput = {
  ruleId: number;
  items: RecurringRuleBulkConfirmItem[];
};

export type RecurringRuleBulkConfirmError = {
  occurred_at: string;
  detail: string;
};

export type RecurringRuleBulkConfirmResult = {
  confirmed: unknown[];
  errors: RecurringRuleBulkConfirmError[];
};

export type RecurringTransactionUpdateInput = {
  transactionId: number;
  amount: number;
  memo?: string | null;
};

export type AttachToOccurrenceInput = {
  ruleId: number;
  userId: number;
  transactionId: number;
  occurredAt: string; // yyyy-MM-dd
};

export type RecurringRuleHistoryEntry = {
  transaction_id: number;
  occurred_at: string;
  amount: number;
  memo: string | null;
  delta_from_rule: number | null;
};

export type RecurringRuleHistory = {
  rule_id: number;
  user_id: number;
  currency: string;
  base_amount: number | null;
  count: number;
  min_amount: number | null;
  max_amount: number | null;
  average_amount: number | null;
  min_delta: number | null;
  max_delta: number | null;
  average_delta: number | null;
  transactions: RecurringRuleHistoryEntry[];
};

export type RecurringRuleHistoryParams = {
  ruleId: number;
  userId: number;
  limit?: number;
};

export type RecurringScanParams = {
  userId: number;
  horizonDays?: number; // default 180
  minOccurrences?: number; // default 3
  includeTransfers?: boolean; // default false
  ignoreCategory?: boolean; // default false
};

export type RecurringScanCandidate = {
  user_id: number;
  name: string;
  type: TxnType;
  frequency: RecurringFrequency;
  day_of_month: number | null;
  weekday: number | null;
  amount: number | null;
  is_variable_amount: boolean;
  currency: string;
  account_id: number;
  counter_account_id: number | null;
  category_id: number | null;
  memo: string | null;
  payee_id: number | null;
  occurrences: number;
  first_date: string;
  last_date: string;
  average_interval_days: number | null;
  amount_min: number | null;
  amount_max: number | null;
  amount_avg: number | null;
  history: { transaction_id: number; occurred_at: string; amount: number; memo: string | null }[];
  signature_hash: string;
};

export type RecurringCandidateExclusion = {
  id: number;
  user_id: number;
  signature_hash: string;
  snapshot: RecurringScanCandidate;
  created_at: string;
  updated_at: string;
};

export type RecurringCandidateExclusionCreateInput = {
  userId: number;
  signatureHash: string;
  snapshot: RecurringScanCandidate;
};
