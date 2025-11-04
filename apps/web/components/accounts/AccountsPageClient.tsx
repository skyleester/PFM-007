"use client";

import { format } from "date-fns";
import { PageHeader } from "@/components/layout/PageHeader";

export default function AccountsPageClient() {
  const today = format(new Date(2000, 0, 1), "yyyy-MM-dd");
  return (
    <div className="p-6 space-y-4"> 
      <PageHeader title="Accounts – Client" />
      <p className="text-sm text-gray-600">Client subcomponent using date-fns: {today}</p>
    </div>
  );
}
