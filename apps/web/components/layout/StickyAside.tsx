import { ReactNode } from "react";
import clsx from "clsx";

type StickyAsideProps = {
  children: ReactNode;
  className?: string;
  offset?: number;
  maxHeight?: string;
};

export function StickyAside({ children, className, offset = 80, maxHeight = "calc(100vh - 6rem)" }: StickyAsideProps) {
  return (
    <aside
      className={clsx(
        "sticky overflow-y-auto rounded-lg border border-gray-200 bg-white/80 p-4 shadow-sm backdrop-blur",
        className,
      )}
      style={{ top: offset, maxHeight }}
    >
      {children}
    </aside>
  );
}
