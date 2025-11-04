"use client";

import dynamic from "next/dynamic";

const TransactionsPanel = dynamic(() => import("@/components/transactions/TransactionsPanel"), { 
  ssr: false 
});

export default function TransactionsPage() {
  return <TransactionsPanel />;
}