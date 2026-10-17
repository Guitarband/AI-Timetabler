"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { PortalNav } from "@/components/PortalNav";
import { StepRail } from "@/components/StepRail";
import { SessionGuard } from "@/components/session-guard";
import { ClassAlternatives } from "@/components/timetable/ClassAlternatives";
import { SavedTimetables } from "@/components/timetable/SavedTimetables";
import { TimetablePanel } from "@/components/timetable/TimetablePanel";
import { Tag } from "@/components/ui/Tag";
import { DevPanel } from "@/dev/DevPanel"; // DEV-ONLY: delete when removing src/dev/
import { useSavedTimetables } from "@/hooks/useSavedTimetables";
import { api, restorePlanner } from "@/lib/api";
import { setMockCourses } from "@/lib/api.mock";
import { PACING, revealDuration } from "@/lib/config";
import { conversationContext } from "@/lib/conversation-context";
import { COPY } from "@/lib/copy";
import { courseOnboardingMessage, sameCourses } from "@/lib/courses";
import { coursesApi } from "@/lib/courses-api";
import { fmtDate } from "@/lib/format";
import { type Action, initialState, isBusy, reducer } from "@/lib/reducer";
import { personalizeContext } from "@/lib/session-profile";
import type { Message, Phase, Plan, Section } from "@/lib/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The authenticated planner, preserving the original desktop timetable layout.
 * Holds the reducer and runs the flow: each user action calls the API module, then
 * plays the AI reply (thought log, then text) before moving to the next phase.
 */
export function EnrolmentPage({
  user,
}: {
  user: { id: string; name: string; email: string };
}) {
  return <AccountPlanner key={user.id} user={user} />;
}

function AccountPlanner({
  user,
}: {
  user: { id: string; name: string; email: string };
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  // Update the ref synchronously so checkpoints include every action in this turn.
  const dispatch = useCallback((action: Action) => {
    stateRef.current = reducer(stateRef.current, action);
    setState(stateRef.current);
  }, []);
  const saved = useSavedTimetables(user.id);
  const { load: loadSaved, save, autosave } = saved;
  const [libraryReady, setLibraryReady] = useState(false);
  const readyRef = useRef(false);
  const [switching, setSwitching] = useState(false);
  const [operationError, setOperationError] = useState("");
  const flowRef = useRef(false);
  const [flowBusy, setFlowBusy] = useState(false);
  const runFlow = async (action: () => Promise<void>) => {
    if (flowRef.current || switching || !libraryReady) return;
    flowRef.current = true;
    setFlowBusy(true);
    try {
      await action();
    } finally {
      flowRef.current = false;
      setFlowBusy(false);
    }
  };
  /** true while a request is in flight: shows the working dots, disables every API button. */
  const [waiting, setWaiting] = useState(false);
  const [selectedClass, setSelectedClass] = useState<Section | null>(null);
  const [classNotice, setClassNotice] = useState<Message | null>(null);

  /** Post an AI message and wait until it has fully revealed. */
  const say = useCallback(
    async (message: Message, error = false, action?: Action) => {
      dispatch({ type: "AI_SAID", message, error });
      if (action) dispatch(action);
      if (readyRef.current) await save(stateRef.current);
      await sleep(revealDuration(message.steps.length));
    },
    [dispatch, save],
  );

  /** Run an API call with the working indicator. Returns null on failure after showing the error in the chat. */
  const call = useCallback(
    async <T,>(
      fn: () => Promise<T>,
      onError: { backTo: Phase; restoreDraft?: string; text?: string },
    ): Promise<T | null> => {
      setWaiting(true);
      try {
        return await fn();
      } catch (err) {
        setWaiting(false);
        // API error or timeout: show it as an AI message with a note, go back one phase,
        // and put the user's text back in the box so they can resend (brief section 9).
        await say(
          {
            steps: [],
            text: onError.text ?? COPY.errorText,
            note: (err as Error)?.message || undefined,
          },
          true,
        );
        dispatch({ type: "SET_PHASE", phase: onError.backTo });
        if (onError.restoreDraft !== undefined)
          dispatch({ type: "SET_DRAFT", text: onError.restoreDraft });
        return null;
      } finally {
        setWaiting(false);
      }
    },
    [say, dispatch],
  );

  // ---- Page load: GET /context ----
  const initialize = useCallback(async () => {
    setSwitching(true);
    try {
      const previous = await loadSaved();
      const catalogue = await coursesApi.catalogue(user.id);
      if (catalogue.demo) setMockCourses(catalogue.selected);
      const ctx = catalogue.completed
        ? await call(() => api.getContext(), {
            backTo: "intake",
            text: COPY.loadErrorText,
          })
        : {
            student_name: user.name,
            term: catalogue.term,
            approved_courses: 0,
            published_sections: catalogue.courses.reduce(
              (count, course) => count + course.timings.length,
              0,
            ),
            friends: [],
            greeting: {
              steps: [],
              text: "Tell me how you would like your week to look. Choose your courses before building your timetable.",
            },
          };
      const context = ctx ? personalizeContext(ctx, user.name) : null;
      readyRef.current = true;
      if (previous) {
        restorePlanner(previous.snapshot.plan);
        dispatch({ type: "OPEN_TIMETABLE", snapshot: previous.snapshot });
      } else if (context) {
        dispatch({ type: "CONTEXT_LOADED", context });
        await say(context.greeting);
      }
      if (catalogue.completed) {
        try {
          const key = `course-onboarding-query:${user.id}`;
          const query = sessionStorage.getItem(key);
          if (query) {
            dispatch({ type: "SET_DRAFT", text: query });
            sessionStorage.removeItem(key);
          }
        } catch {
          /* The saved conversation still retains the question if browser storage is unavailable. */
        }
      }
      setLibraryReady(!!previous || !!context);
    } catch (error) {
      // The library hook exposes the connection error and Retry action.
      setOperationError(
        error instanceof Error
          ? error.message
          : "Could not load courses. Retry to continue.",
      );
    } finally {
      setSwitching(false);
    }
  }, [call, say, user.name, user.id, loadSaved, dispatch]);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (libraryReady) autosave(state);
  }, [state, libraryReady, autosave]);

  // ---- intake / adjust: Send ----
  const checkCourses = useCallback(async () => {
    const catalogue = await call(() => coursesApi.catalogue(user.id), {
      backTo: stateRef.current.plan ? "adjust" : "intake",
      text: "Could not check your course selection. Try again.",
    });
    if (!catalogue) return false;
    if (!catalogue.completed) {
      await say(courseOnboardingMessage);
      return false;
    }
    if (catalogue.demo) setMockCourses(catalogue.selected);
    const plan = stateRef.current.plan;
    if (
      plan &&
      !sameCourses(
        [...new Set(plan.sections.map((section) => section.code))],
        catalogue.selected,
      )
    ) {
      await say({
        steps: [],
        text: "This saved timetable uses a different course selection. Start a new timetable to plan your current courses. This timetable stays in your library.",
        action: "new_timetable",
      });
      return false;
    }
    return true;
  }, [call, say, user.id]);

  const onSend = useCallback(
    async (text: string) => {
      const { phase, plan } = stateRef.current;
      if (!text.trim() || waiting || !libraryReady) return;
      const history = conversationContext(stateRef.current.items);
      dispatch({ type: "USER_SAID", text });
      if (!(await checkCourses())) {
        dispatch({ type: "SET_DRAFT", text });
        return;
      }

      if (phase === "intake") {
        dispatch({ type: "SET_PHASE", phase: "thinking" });
        if (!(await save(stateRef.current))) {
          dispatch({ type: "SET_PHASE", phase: "intake" });
          dispatch({ type: "SET_DRAFT", text });
          return;
        }
        const res = await call(() => api.parse(text, history), {
          backTo: "intake",
          restoreDraft: text,
        });
        if (!res) return;
        await say(res.message, false, {
          type: "RULES_PARSED",
          rules: res.rules,
          readyToBuild: res.ready_to_build,
        });
        if (res.rules.length === 0 && !res.ready_to_build) {
          dispatch({ type: "SET_DRAFT", text });
        }
        return;
      }

      if (phase === "adjust" && plan) {
        dispatch({ type: "SET_PHASE", phase: "adjusting" });
        if (!(await save(stateRef.current))) {
          dispatch({ type: "SET_PHASE", phase: "adjust" });
          dispatch({ type: "SET_DRAFT", text });
          return;
        }
        const next = await call(() => api.adjust(plan.plan_id, text, history), {
          backTo: "adjust",
          restoreDraft: text,
        });
        if (!next) return;
        // changed === false: the reducer keeps the current plan, version and match % as they are.
        dispatch({ type: "PLAN_RECEIVED", plan: next });
        await say(next.message, false, { type: "SET_PHASE", phase: "adjust" });
        if (next.changed) {
          await sleep(PACING.beforeText);
          await say({ steps: [], text: COPY.afterAdjust });
        }
        dispatch({ type: "SET_PHASE", phase: "adjust" });
      }
    },
    [call, say, waiting, libraryReady, save, dispatch, checkCourses],
  );

  // ---- confirm: build ----
  const onBuild = useCallback(async () => {
    const { phase, rules } = stateRef.current;
    if (phase !== "confirm" || waiting) return;
    if (!(await checkCourses())) return;
    dispatch({ type: "SET_PHASE", phase: "generating" });
    if (!(await save(stateRef.current))) {
      dispatch({ type: "SET_PHASE", phase: "confirm" });
      return;
    }
    const plan = await call(() => api.solve(rules), { backTo: "confirm" });
    if (!plan) return;
    dispatch({ type: "PLAN_RECEIVED", plan });
    await say(plan.message, false, { type: "SET_PHASE", phase: "timetable" });
    await sleep(PACING.timetableToAdjust); // timetable -> adjust automatically after 900ms
    dispatch({ type: "SET_PHASE", phase: "adjust" });
    await say({ steps: [], text: COPY.afterBuild });
  }, [call, say, waiting, dispatch, save, checkCourses]);

  // ---- adjust: Confirm enrolment ----
  const onConfirm = useCallback(async () => {
    const { phase, plan } = stateRef.current;
    if (phase !== "adjust" || !plan || waiting) return;
    if (!(await checkCourses())) return;
    dispatch({ type: "SET_PHASE", phase: "confirming" });
    if (!(await save(stateRef.current))) {
      dispatch({ type: "SET_PHASE", phase: "adjust" });
      return;
    }
    const conf = await call(() => api.confirm(plan.plan_id), {
      backTo: "adjust",
    });
    if (!conf) return;
    dispatch({ type: "CONFIRMED", confirmation: conf });
    await say(conf.message, false, { type: "SET_PHASE", phase: "confirmed" });
  }, [call, say, waiting, dispatch, save, checkCourses]);

  const { phase, context, confirmation } = state;
  const changeClass = async (
    operation: (plan: Plan) => Promise<Plan>,
    close: boolean,
  ) => {
    const current = stateRef.current;
    if (current.phase !== "adjust" || !current.plan || waiting) return;
    if (!(await checkCourses()) || !(await save(stateRef.current))) return;
    dispatch({ type: "SET_PHASE", phase: "adjusting" });
    const next = await call(() => operation(current.plan as Plan), {
      backTo: "adjust",
    });
    if (!next) {
      setSelectedClass(null);
      return;
    }
    dispatch({ type: "PLAN_RECEIVED", plan: next });
    if (close && next.changed) setSelectedClass(null);
    setClassNotice(next.changed ? null : next.message);
    await say(next.message, false, { type: "SET_PHASE", phase: "adjust" });
  };
  const busy = waiting || flowBusy || isBusy(phase);
  const libraryBusy =
    !libraryReady || busy || switching || phase === "timetable";

  const onNew = async () => {
    if (libraryBusy) return;
    setSwitching(true);
    setOperationError("");
    try {
      if (!(await save(stateRef.current))) return;
      const catalogue = await coursesApi.catalogue(user.id);
      if (!catalogue.completed) {
        router.push("/courses");
        return;
      }
      if (catalogue.demo) setMockCourses(catalogue.selected);
      const freshContext = personalizeContext(
        await api.getContext(),
        user.name,
      );
      await saved.startNew();
      restorePlanner(null);
      dispatch({ type: "NEW_TIMETABLE", context: freshContext });
      await save(stateRef.current);
    } catch {
      setOperationError(
        "Could not start a new timetable. Retry saving before switching.",
      );
    } finally {
      setSwitching(false);
    }
  };

  const onOpen = async () => {
    if (libraryBusy) return;
    const entry = saved.library.entries.find(
      (item) => item.id === saved.selectedId,
    );
    if (!entry) return;
    setSwitching(true);
    setOperationError("");
    try {
      if (!(await save(stateRef.current))) return;
      const fresh = await saved.open(entry.id);
      restorePlanner(fresh.snapshot.plan);
      dispatch({ type: "OPEN_TIMETABLE", snapshot: fresh.snapshot });
    } catch {
      setOperationError(
        "Could not open that timetable. Your current work is still on this page.",
      );
    } finally {
      setSwitching(false);
    }
  };

  return (
    <SessionGuard userId={user.id}>
      <div className="planner-shell flex h-screen flex-col overflow-hidden">
        <PortalNav
          term={context?.term}
          studentName={user.name}
          busy={busy || switching}
          beforeLeave={() =>
            libraryReady ? save(stateRef.current) : Promise.resolve(true)
          }
        />
        <div className="planner-heading flex items-center justify-between px-[22px] pb-[14px] pt-[13px]">
          <div className="flex items-center gap-[12px]">
            <h3 className="font-display text-[25px] font-semibold leading-none">
              {COPY.title}
            </h3>
            <Tag tone="outline" className="border-accent-400 text-accent-700">
              {COPY.addonTag}
            </Tag>
          </div>
          <StepRail phase={phase} />
          <a className="planner-preview-link" href="#timetable">
            View timetable
          </a>
        </div>
        <SavedTimetables
          entries={saved.library.entries}
          name={saved.name}
          selectedId={saved.selectedId}
          notice={operationError || saved.notice}
          disabled={libraryBusy || !context}
          canSave={!!context}
          retry={saved.loadError || !libraryReady || saved.status === "error"}
          retryDisabled={switching || waiting}
          conflict={saved.status === "conflict"}
          onRetry={() => {
            setOperationError("");
            if (libraryReady) void save(stateRef.current);
            else void initialize();
          }}
          onSaveCopy={() => {
            void runFlow(async () => {
              await saved.saveCopy(stateRef.current);
            });
          }}
          onName={saved.setName}
          onSelect={saved.setSelectedId}
          onNew={onNew}
          onOpen={onOpen}
          onSave={() => {
            if (!libraryBusy && context) void save(stateRef.current);
          }}
        />
        <main className="planner-panels grid min-h-0 flex-1 gap-[20px] px-[22px] pb-[22px]">
          <AssistantPanel
            phase={phase}
            items={state.items}
            rules={state.rules}
            friends={context?.friends ?? []}
            waiting={waiting || flowBusy || !libraryReady || switching}
            draft={state.draft}
            focusTick={state.focusTick}
            lockedText={
              confirmation
                ? COPY.composer.locked(fmtDate(confirmation.swap_deadline))
                : undefined
            }
            onDraft={(text) => dispatch({ type: "SET_DRAFT", text })}
            onSend={(text) => {
              void runFlow(() => onSend(text));
            }}
            onRulesChange={(rules) => dispatch({ type: "RULES_EDITED", rules })}
            onBuild={() => {
              void runFlow(onBuild);
            }}
            onAction={(action) => {
              if (action === "new_timetable") {
                void onNew();
                return;
              }
              void runFlow(async () => {
                if (await save(stateRef.current)) {
                  try {
                    if (stateRef.current.draft)
                      sessionStorage.setItem(
                        `course-onboarding-query:${user.id}`,
                        stateRef.current.draft,
                      );
                  } catch {
                    /* Navigation still works without browser storage. */
                  }
                  router.push("/courses");
                }
              });
            }}
          />
          <TimetablePanel
            phase={phase}
            plan={state.plan}
            prevMatch={state.prevMatch}
            rules={state.rules}
            context={context}
            confirmation={confirmation}
            busy={busy || switching || !libraryReady}
            onSectionSelect={(section) => {
              setClassNotice(null);
              setSelectedClass(section);
            }}
            onAsk={() => dispatch({ type: "FOCUS_COMPOSER" })}
            onConfirm={() => {
              void runFlow(onConfirm);
            }}
          />
        </main>
        {selectedClass && state.plan && (
          <ClassAlternatives
            plan={state.plan}
            section={selectedClass}
            notice={classNotice}
            busy={busy || switching || !libraryReady}
            onClose={() => setSelectedClass(null)}
            onKeep={(keep) =>
              runFlow(() =>
                changeClass(
                  (plan) => api.keep(plan.plan_id, selectedClass.key, keep),
                  false,
                ),
              )
            }
            onSwap={(key) =>
              runFlow(() =>
                changeClass(
                  (plan) => api.swap(plan.plan_id, selectedClass.key, key),
                  true,
                ),
              )
            }
          />
        )}
        <DevPanel /> {/* DEV-ONLY: delete when removing src/dev/ */}
      </div>
    </SessionGuard>
  );
}
