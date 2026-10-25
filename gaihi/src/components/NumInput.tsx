"use client";

import { useEffect, useState } from "react";

/** 入力途中（"0." など）を壊さない数値入力 */
export function NumInput({
  value,
  onChange,
  step = "any",
  className = "w-num",
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      className={className}
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => {
        if (text.trim() === "" || !Number.isFinite(Number(text))) {
          setText("0");
          onChange(0);
        }
      }}
    />
  );
}
