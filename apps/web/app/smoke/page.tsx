"use client";

import { ping } from "@/lib/ping";
import { clsx as cx } from "clsx/lite";

export default function SmokePage() {
  return (
  <div className={cx("p-6")}>
      <h1 className="text-xl font-semibold">Smoke</h1>
      <p className="text-sm text-gray-600">ping: {ping}</p>
    </div>
  );
}
