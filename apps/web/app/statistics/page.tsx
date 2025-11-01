import { format, startOfMonth, subMonths } from "date-fns";

import type { StatisticsFilters } from "@/lib/statistics/types";
import StatisticsClient from "./StatisticsClient";

export default function StatisticsPage() {
  const today = new Date();
  const rangeStart = startOfMonth(subMonths(today, 5));
  const initialFilters: StatisticsFilters = {
    start: format(rangeStart, "yyyy-MM-dd"),
    end: format(today, "yyyy-MM-dd"),
    accountId: null,
    includeTransfers: true,
    includeSettlements: false,
    excludedCategoryIds: [],
  };

  return <StatisticsClient initialFilters={initialFilters} />;
}
