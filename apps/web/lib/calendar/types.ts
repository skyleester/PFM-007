export type TxnType = "INCOME" | "EXPENSE" | "TRANSFER";

export type CalendarTransaction = {
  id: number;
  user_id: number;
  occurred_at: string;
  occurred_time?: string | null;
  type: TxnType;
  group_id?: number | null;
  account_id: number;
  counter_account_id?: number | null;
  category_id?: number | null;
  amount: number;
  currency: string;
  memo?: string | null;
  payee_id?: number | null;
  external_id?: string | null;
  is_balance_neutral: boolean;
  is_auto_transfer_match: boolean;
  exclude_from_reports: boolean;
  recurring_rule_id?: number | null;
  recurring_rule_name?: string | null;
};

export type RecurringFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurringRuleSummary = {
  id: number;
  user_id: number;
  name: string;
  type: TxnType;
  frequency: RecurringFrequency;
  day_of_month?: number | null;
  weekday?: number | null;
  amount: number | null;
  currency: string;
  account_id: number;
  counter_account_id?: number | null;
  category_id?: number | null;
  memo?: string | null;
  payee_id?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active: boolean;
  last_generated_at?: string | null;
};

export type RecurringOccurrence = {
  ruleId: number;
  ruleName: string;
  ruleType: TxnType;
  amount: number | null;
  currency: string;
  accountId: number;
  counterAccountId?: number | null;
  categoryId?: number | null;
  memo?: string | null;
  date: string;
};

export type CalendarEventType = "anniversary" | "memo" | "reminder";

export type CalendarEvent = {
  id: number;
  user_id: number;
  date: string;
  title: string;
  type: CalendarEventType;
  description?: string | null;
  color?: string | null;
  created_at: string;
  updated_at: string;
};

export type CalendarHoliday = {
  date: string;
  name: string;
};

export type CalendarTotals = {
  income: number;
  expense: number;
  net: number;
  transferIn: number;
  transferOut: number;
};

export type CalendarDayBucket = {
  date: string;
  transactions: CalendarTransaction[];
  recurring: RecurringOccurrence[];
  events: CalendarEvent[];
  holidays: CalendarHoliday[];
  totals: CalendarTotals;
};

export type CalendarSnapshot = {
  range: { start: string; end: string };
  transactions: CalendarTransaction[];
  recurringOccurrences: RecurringOccurrence[];
  events: CalendarEvent[];
  holidays: CalendarHoliday[];
  byDate: Record<string, CalendarDayBucket>;
  dates: string[];
  totals: CalendarTotals;
};

export type UseCalendarDataState =
  | { status: "idle" | "loading";
      data?: undefined;
      error?: undefined; }
  | { status: "success";
      data: CalendarSnapshot;
      error?: undefined; }
  | { status: "error";
      data?: undefined;
      error: Error };

export type UseCalendarDataResult = UseCalendarDataState & {
  refresh: () => void;
};

export type CalendarRangeParams = {
  userId: number;
  start: string;
  end: string;
};
