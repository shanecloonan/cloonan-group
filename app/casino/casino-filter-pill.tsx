"use client";

import { filterPillActive, filterPillIdle } from "./casino-ui";

export function CasinoFilterPill({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "min-h-9 touch-manipulation px-3 rounded-full text-[11px] font-semibold border transition-all cursor-pointer " +
        (active ? filterPillActive : filterPillIdle) +
        (disabled ? " opacity-40 cursor-not-allowed" : "")
      }
    >
      {label}
    </button>
  );
}
