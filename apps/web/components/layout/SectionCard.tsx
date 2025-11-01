import { ReactNode } from "react";
import clsx from "clsx";

type SectionCardProps = {
  title?: string;
  description?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  padding?: "sm" | "md" | "lg" | "none";
  tone?: "default" | "muted" | "brand";
};

const paddingMap: Record<NonNullable<SectionCardProps["padding"]>, string> = {
  none: "p-0",
  sm: "p-3 sm:p-4",
  md: "p-4 sm:p-6",
  lg: "p-6 sm:p-8",
};

const toneMap: Record<NonNullable<SectionCardProps["tone"]>, string> = {
  default: "bg-white border-gray-200",
  muted: "bg-gray-50 border-gray-200",
  brand: "bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-200",
};

export function SectionCard({
  title,
  description,
  headerAction,
  children,
  footer,
  className,
  padding = "md",
  tone = "default",
}: SectionCardProps) {
  return (
    <section className={clsx("rounded-lg border shadow-sm transition-shadow hover:shadow-md", toneMap[tone], className)}>
      <div className={paddingMap[padding]}>
        {(title || description || headerAction) && (
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              {title ? <h2 className="text-base font-semibold text-gray-900">{title}</h2> : null}
              {description ? <p className="mt-1 text-sm text-gray-600">{description}</p> : null}
            </div>
            {headerAction ? <div className="flex items-center gap-2">{headerAction}</div> : null}
          </div>
        )}
        <div className={clsx(title || description ? "space-y-4" : "space-y-3")}>{children}</div>
      </div>
      {footer ? <div className="border-t border-gray-100 px-4 py-3 sm:px-6">{footer}</div> : null}
    </section>
  );
}
