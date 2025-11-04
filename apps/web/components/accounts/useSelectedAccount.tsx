"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type SelectedAccountContextType = {
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
};

const SelectedAccountContext = createContext<SelectedAccountContextType | null>(null);

export function SelectedAccountProvider({ children }: { children: ReactNode }): JSX.Element {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  return (
    <SelectedAccountContext.Provider value={{ selectedId, setSelectedId }}>
      {children}
    </SelectedAccountContext.Provider>
  );
}

export function useSelectedAccount(): SelectedAccountContextType {
  const context = useContext(SelectedAccountContext);
  if (!context) {
    throw new Error("useSelectedAccount must be used within a SelectedAccountProvider");
  }
  return context;
}