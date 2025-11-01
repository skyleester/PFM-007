"use client";

import dynamic from "next/dynamic";

// SSR disabled dynamic import to mitigate bundler JSON issues.
const TransactionsTable = dynamic(() => import("./TransactionsTable"), { ssr: false });

export default TransactionsTable;
