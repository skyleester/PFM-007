import { ReactNode } from "react";
import clsx from "clsx";

type SplitLayoutProps = {
  sidebar?: ReactNode;
  main: ReactNode;
  gap?: string;
  sidebarWidth?: string;
  stackedBreakpoint?: "sm" | "md" | "lg";
  className?: string;
};

/**
 * Provides a responsive two-column grid. On smaller screens the sidebar stacks above the main content.
 */
export function SplitLayout({
  sidebar,
  main,
  gap = "gap-6",
  sidebarWidth = "lg:grid-cols-[360px_1fr] xl:grid-cols-[400px_1fr]",
  stackedBreakpoint = "lg",
  className,
}: SplitLayoutProps) {
  const breakpointClass = {
    sm: "sm:grid-cols-[280px_1fr]",
    md: "md:grid-cols-[320px_1fr]",
    lg: sidebarWidth,
  }[stackedBreakpoint];

  return (
    <div className={clsx("grid grid-cols-1", gap, breakpointClass, className)}>
      {sidebar ? <div className="space-y-6">{sidebar}</div> : null}
      <div className="space-y-6">{main}</div>
    </div>
  );
}
