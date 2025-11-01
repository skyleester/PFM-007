export type StatisticsFilters = {
  start: string;
  end: string;
  accountId?: number | null;
  includeTransfers: boolean;
  includeSettlements: boolean;
  excludedCategoryIds: number[];
};

export type MonthlyFlowDatum = {
  month: string;
  income: number;
  expense: number;
  net: number;
};

export type CategoryShareDatum = {
  categoryGroupId: number | null;
  categoryGroupName: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  percentage: number;
};

export type AccountVolatilityItem = {
  accountId: number;
  accountName: string;
  currency: string | null;
  averageDailyChange: number;
    dailyStddev: number;
  
  totalChange: number;
};

export type AdvancedKpis = {
  savingsRate: number | null;
  savingsToExpenseRatio: number | null;
  averageDailyNet: number;
  projectedRunwayDays: number | null;
  projectedRunoutDate: string | null;
  totalLiquidBalance: number;
  expenseConcentrationIndex: number;
  expenseConcentrationLevel: "low" | "moderate" | "high";
  accountVolatility: AccountVolatilityItem[];
};

export type CategoryTrendItem = {
  categoryGroupId: number | null;
  categoryGroupName: string;
  type: "INCOME" | "EXPENSE";
  month: string;
  amount: number;
  previousMonthAmount: number | null;
  momChange: number | null;
  qoqChange: number | null;
  yoyChange: number | null;
};

export type CategoryMomentum = {
  topRising: CategoryTrendItem[];
  topFalling: CategoryTrendItem[];
};

export type HeatmapBucket = {
  dayOfWeek: number;
  hour: number;
  amount: number;
};

export type WeeklyHeatmap = {
  buckets: HeatmapBucket[];
  maxValue: number;
};

export type ExpenseAnomaly = {
  transactionId: number;
  occurredAt: string;
  accountId: number;
  accountName: string;
  categoryGroupName: string;
  amount: number;
  zScore: number;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  memo?: string | null;
};

export type IncomeAlert = {
  ruleId: number;
  ruleName: string;
  expectedDate: string;
  lastSeenDate: string | null;
  delayDays: number;
  accountName: string;
  amountHint: number | null;
};

export type RecurringCoverageItem = {
  ruleId: number;
  ruleName: string;
  type: "INCOME" | "EXPENSE";
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  expectedOccurrences: number;
  actualOccurrences: number;
  coverageRate: number;
};

export type RecurringCoverage = {
  totalRules: number;
  rulesInWindow: number;
  overallCoverageRate: number | null;
  incomeCoverageRate: number | null;
  expenseCoverageRate: number | null;
  uncoveredRules: RecurringCoverageItem[];
};

export type Forecast = {
  nextMonthIncome: number;
  nextMonthExpense: number;
  nextMonthNet: number;
  methodology: string;
};

export type AccountTimelinePoint = {
  occurredAt: string;
  netChange: number;
  runningTotal: number;
};

export type AccountTimelineSeries = {
  accountId: number;
  accountName: string;
  currency: string;
  points: AccountTimelinePoint[];
};

export type StatisticsKPIs = {
  totalIncome: number;
  totalExpense: number;
  net: number;
  averageDailyExpense: number;
  transactionCount: number;
  topExpenseCategory?: CategoryShareDatum | null;
};

export type StatisticsInsight = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "positive";
};

export type StatisticsOverview = {
  filters: StatisticsFilters;
  kpis: StatisticsKPIs;
  monthlyFlow: MonthlyFlowDatum[];
  categoryShare: CategoryShareDatum[];
  accountTimeline: AccountTimelineSeries[];
  insights: StatisticsInsight[];
  accounts: Array<{ id: number; name: string; currency: string }>;
  advanced: AdvancedKpis;
  categoryTrends: CategoryTrendItem[];
  categoryMomentum: CategoryMomentum;
  weeklyHeatmap: WeeklyHeatmap;
  expenseAnomalies: ExpenseAnomaly[];
  incomeAlerts: IncomeAlert[];
  recurringCoverage: RecurringCoverage;
  forecast: Forecast;
};

export type StatisticsSettings = {
  userId: number;
  excludedCategoryIds: number[];
};

export type StatisticsPreset = {
  id: number;
  userId: number;
  name: string;
  memo: string | null;
  selectedCategoryIds: number[];
  createdAt: string;
  updatedAt: string;
};
