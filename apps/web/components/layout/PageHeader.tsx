import { ReactNode } from "react";
import clsx from "clsx";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  align?: "start" | "center" | "between";
  className?: string;
};

export function PageHeader({ title, subtitle, actions, align = "between", className }: PageHeaderProps) {
  const alignment = {
    start: "flex-col items-start gap-2",
    center: "flex-col items-center gap-2 text-center",
    between: "flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
  }[align];

  return (
    <div className={clsx("mb-6 flex", alignment, className)}>
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-gray-600 sm:text-base">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
