"use client";
/**
 * DEV-ONLY: floating "Mock scenarios" panel (bottom-right, in the page gutter).
 * Only renders in mock mode. Picking a scenario reloads the page with `?scenario=<id>`.
 * Remove with the rest of `src/dev/` (see scenarios.ts header).
 */
import { useEffect, useState } from "react";
import { config } from "@/lib/config";
import { currentScenarioId, SCENARIOS } from "./scenarios";

export function DevPanel() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("happy");
  useEffect(() => setActive(currentScenarioId()), []);

  if (!config.useMock) return null;
  const current = SCENARIOS.find((s) => s.id === active) ?? SCENARIOS[0];

  const go = (id: string) => {
    const url = new URL(window.location.href);
    if (id === "happy") url.searchParams.delete("scenario");
    else url.searchParams.set("scenario", id);
    window.location.href = url.toString();
  };

  return (
    <div className="fixed bottom-[2px] right-[22px] z-50 flex flex-col items-end font-sans">
      {open && (
        <div className="mb-[4px] max-h-[80vh] w-[380px] overflow-y-auto border border-accent-700 bg-bg text-[12px] leading-[1.45]">
          <div className="flex items-center justify-between bg-accent-700 px-[10px] py-[6px] text-white">
            <span className="eyebrow">Mock scenarios · dev only</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="px-[4px] text-[14px] leading-none"
            >
              ×
            </button>
          </div>

          <div className="border-b border-divider px-[10px] py-[9px]">
            <p className="font-display text-[15px] font-semibold">
              {current.title}
            </p>
            <p className="eyebrow mt-[6px] ink-55">Try</p>
            <ol className="ml-[16px] list-decimal">
              {current.try.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
            <p className="eyebrow mt-[6px] ink-55">You should see</p>
            <p>{current.expect}</p>
            <p className="eyebrow mt-[6px] ink-55">Backend contract</p>
            <p className="bg-accent-100 px-[6px] py-[4px] text-accent-900">
              {current.backend}
            </p>
            <button
              type="button"
              onClick={() => go(current.id)}
              className="mt-[8px] border border-divider px-[8px] py-[2px] hover:bg-surface"
            >
              ↻ Restart this scenario
            </button>
          </div>

          <ul>
            {SCENARIOS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => go(s.id)}
                  className={`block w-full border-b border-divider px-[10px] py-[6px] text-left hover:bg-accent-100 ${
                    s.id === active
                      ? "bg-accent-100 font-medium text-accent-900"
                      : ""
                  }`}
                >
                  {s.id === active ? "● " : ""}
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="border border-accent-700 bg-accent-700 px-[8px] py-[1px] text-[10.5px] uppercase tracking-[0.08em] text-white hover:bg-accent-600"
      >
        Mock · {current.title.replace(" (default)", "")} {open ? "▾" : "▴"}
      </button>
    </div>
  );
}
