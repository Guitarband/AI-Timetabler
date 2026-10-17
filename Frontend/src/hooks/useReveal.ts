"use client";
import { useEffect, useState } from "react";
import { config, PACING, speedMult } from "@/lib/config";

/**
 * Drives the thought log rhythm (brief section 7), Normal speed:
 *   wait 260ms, then one line every 430ms (dot -> check), then 320ms before the main text.
 * Multiplied by 1.6 (Cinematic) or 0.12 (Instant).
 * Lines only ever come from `message.steps` sent by the backend.
 */
export function useReveal(stepCount: number, animate: boolean) {
  const n = config.showThoughtLog ? stepCount : 0;
  const [shown, setShown] = useState(animate ? 0 : n);
  const [checked, setChecked] = useState(animate ? 0 : n);
  const [textVisible, setTextVisible] = useState(!animate);

  useEffect(() => {
    if (!animate) return;
    const m = speedMult();
    const t0 = n > 0 ? PACING.beforeFirstStep * m : 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < n; i++) {
      timers.push(
        setTimeout(() => setShown(i + 1), t0 + i * PACING.perStep * m),
      );
      timers.push(
        setTimeout(() => setChecked(i + 1), t0 + (i + 1) * PACING.perStep * m),
      );
    }
    timers.push(
      setTimeout(
        () => setTextVisible(true),
        t0 + n * PACING.perStep * m + PACING.beforeText * m,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [animate, n]);

  return { shown, checked, textVisible, stepCount: n };
}
