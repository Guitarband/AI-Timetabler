"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ClassAlternatives as Alternatives } from "@/lib/enrolment-contract";
import { DAY_LONG } from "@/lib/time";
import type { Message, Plan, Section } from "@/lib/types";

export function ClassAlternatives({
  plan,
  section,
  busy,
  onKeep,
  onSwap,
  onClose,
  notice,
}: {
  plan: Plan;
  section: Section;
  busy: boolean;
  onKeep: (keep: boolean) => Promise<void>;
  onSwap: (key: string) => Promise<void>;
  onClose: () => void;
  notice?: Message | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<Alternatives | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      if (previous?.isConnected) previous.focus();
      else document.getElementById("timetable")?.focus();
    };
  }, []);
  useEffect(() => {
    // A retry deliberately reruns the same request after availability changes.
    void refresh;
    let active = true;
    setResult(null);
    setError("");
    void api.alternatives(plan.plan_id, section.key).then(
      (data) => {
        if (active) setResult(data);
      },
      (reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load alternatives.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, [plan.plan_id, section.key, refresh]);
  const kept = plan.kept_sections?.includes(section.key) ?? false;
  const loaded =
    result?.plan_id === plan.plan_id && result.current.key === section.key;
  const button =
    "border border-divider px-3 py-2 text-sm font-medium hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent-700 disabled:opacity-50";
  return (
    <dialog
      ref={dialog}
      aria-labelledby="class-alternatives-title"
      className="m-auto max-h-[85dvh] w-[min(640px,calc(100%-32px))] overflow-y-auto border border-divider bg-bg p-0 text-text backdrop:bg-black/30"
      onCancel={onClose}
    >
      <div className="flex items-start justify-between gap-4 border-b border-divider p-5">
        <div>
          <h2
            id="class-alternatives-title"
            className="font-display text-xl font-semibold"
          >
            {section.code} · {section.kind}
          </h2>
          <p className="mt-1 text-sm">{section.title}</p>
        </div>
        <button
          type="button"
          className={button}
          onClick={onClose}
          aria-label="Close class alternatives"
        >
          Close ×
        </button>
      </div>
      <div className="p-5">
        {notice && (
          <output className="mb-4 block border-l-2 border-accent-600 pl-3 text-sm">
            <p>{notice.text}</p>
            {notice.steps.map((line) => (
              <p key={line} className="mt-1">
                {line}
              </p>
            ))}
            {notice.note && <p className="mt-2">{notice.note}</p>}
          </output>
        )}
        <h3 className="text-sm font-semibold">
          Current class · {section.section}
        </h3>
        <p className="mt-1 text-sm">
          {DAY_LONG[section.day - 1]} {section.start}–{section.end} ·{" "}
          {section.room}
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={kept}
            disabled={busy}
            onChange={(event) => {
              void onKeep(event.target.checked);
            }}
          />
          Keep this class
        </label>
        <p className="mt-1 text-sm ink-62">
          Kept classes stay fixed during AI adjustments and undo. Turn this off
          to move this class.
        </p>
        <h3 className="mt-6 border-t border-divider pt-4 text-sm font-semibold">
          Other times
        </h3>
        <p className="mt-1 text-sm ink-62">
          A swap changes only this class. Seats are checked again when you swap;
          they are not reserved yet.
        </p>
        <div aria-live="polite">
          {error ? (
            <div className="mt-4">
              <p role="alert" className="text-sm">
                {error}
              </p>
              <button
                type="button"
                className={`${button} mt-2`}
                disabled={busy}
                onClick={() => setRefresh((n) => n + 1)}
              >
                Retry alternatives
              </button>
            </div>
          ) : !loaded ? (
            <p className="py-5 text-sm">Checking times, seats and clashes…</p>
          ) : result.options.length === 0 ? (
            <p className="py-5 text-sm">
              This required class has no other published times.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-divider">
              {result.options.map((option) => (
                <li key={option.section.key} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {DAY_LONG[option.section.day - 1]}{" "}
                        {option.section.start}–{option.section.end}
                      </p>
                      <p className="mt-1 text-sm ink-62">
                        {option.section.section} · {option.section.room}
                      </p>
                      <p className="mt-1 text-sm">
                        {option.remaining_seats == null
                          ? "Seat count unavailable"
                          : `${option.remaining_seats} ${option.remaining_seats === 1 ? "seat" : "seats"} available`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`${button} border-accent-600 text-accent-800`}
                      disabled={busy || !option.can_swap}
                      aria-label={`Swap to ${option.section.section}`}
                      onClick={async () => {
                        await onSwap(option.section.key);
                        setRefresh((n) => n + 1);
                      }}
                    >
                      Swap to {option.section.section}
                    </button>
                  </div>
                  {option.reasons.map((reason) => (
                    <p key={reason} className="mt-2 text-sm text-red-800">
                      {reason}
                    </p>
                  ))}
                  {option.preference_notes.map((note) => (
                    <p key={note} className="mt-2 text-sm text-amber-800">
                      {note}
                    </p>
                  ))}
                  {option.can_swap && (
                    <p className="mt-2 text-sm text-accent-700">
                      No clashes. Other classes stay in place.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </dialog>
  );
}
