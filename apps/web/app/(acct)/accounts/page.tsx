"use client";
import { PageHeader } from "@/components/layout/PageHeader";
import { MemberSelector } from "@/components/MemberSelector";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import dynamic from "next/dynamic";
import { SelectedAccountProvider } from "@/components/accounts/useSelectedAccount";

const AccountsList = dynamic(() => import("@/components/accounts/AccountsList").then(m => m.AccountsList), { ssr: false });
const TransactionPanel = dynamic(() => import("@/components/accounts/TransactionPanel").then(m => m.TransactionPanel), { ssr: false });
const AccountEditForm = dynamic(() => import("@/components/accounts/AccountEditForm").then(m => m.AccountEditForm), { ssr: false });
const CardPanel = dynamic(() => import("@/components/accounts/CardPanel").then(m => m.CardPanel), { ssr: false });

export default function AccountsPage() {
  const [ids,,] = usePersistentState<number[]>("pfm:members:selection:v1", [1]);
  return (
    <SelectedAccountProvider>
      <div className="p-6 space-y-4"> 
        <PageHeader title="Accounts" />
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <MemberSelector value={ids} onChange={() => {}} />
          </div>
          <AccountsList memberIds={ids} />
          <TransactionPanel memberIds={ids} />
          <AccountEditForm />
          <CardPanel memberIds={ids} />
        </div>
      </div>
    </SelectedAccountProvider>
  );
}
