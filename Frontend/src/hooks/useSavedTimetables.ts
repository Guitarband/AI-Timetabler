"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { State } from "@/lib/reducer";
import {
  emptyLibrary,
  readLegacyTimetables,
  type SavedTimetable,
  snapshotOf,
} from "@/lib/saved-timetables";
import { savedTimetablesApi } from "@/lib/saved-timetables-api";
import { type SaveStatus, TimetableWriter } from "@/lib/timetable-writer";

export function useSavedTimetables(userId: string) {
  const [library, setLibrary] = useState(emptyLibrary);
  const [name, updateName] = useState("");
  const nameRef = useRef("");
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [warning, setWarning] = useState("");
  const [lastDeleted, setLastDeleted] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentState = useRef<State | null>(null);
  const mounted = useRef(true);
  const [writer] = useState(
    () =>
      new TimetableWriter(
        (input) =>
          savedTimetablesApi.save.mutate({ ...input, accountId: userId }),
        (entry) => {
          if (!mounted.current) return;
          setLibrary((previous) => ({
            ...previous,
            activeId: entry.id,
            entries: [
              ...previous.entries.filter((item) => item.id !== entry.id),
              entry,
            ],
          }));
          setSelectedId((previous) => previous || entry.id);
        },
        (next) => {
          if (mounted.current) setStatus(next);
        },
      ),
  );

  const cancelTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const adopt = useCallback(
    (entry: SavedTimetable | null) => {
      cancelTimer();
      writer.reset(entry);
      nameRef.current = entry?.name ?? "";
      updateName(nameRef.current);
      setSelectedId(entry?.id ?? "");
      currentState.current = null;
    },
    [writer, cancelTimer],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      let legacy: ReturnType<typeof readLegacyTimetables> = {
        activeId: null,
        entries: [],
      };
      try {
        legacy = readLegacyTimetables(userId);
      } catch {
        setWarning(
          "Old browser copies could not be imported. Your database saves are available.",
        );
      }
      const existing = await savedTimetablesApi.list.query({
        accountId: userId,
      });
      const known = new Set(existing.entries.map((entry) => entry.id));
      const missing = legacy.entries.filter((entry) => !known.has(entry.id));
      for (let offset = 0; offset < missing.length; offset += 10) {
        await savedTimetablesApi.importLegacy.mutate({
          accountId: userId,
          activeId: legacy.activeId,
          entries: missing.slice(offset, offset + 10),
        });
      }
      const value = missing.length
        ? await savedTimetablesApi.list.query({ accountId: userId })
        : existing;
      setLibrary(value);
      const entry = value.activeId
        ? await savedTimetablesApi.open.mutate({
            id: value.activeId,
            accountId: userId,
          })
        : null;
      adopt(entry);
      if (entry)
        setLibrary({
          ...value,
          entries: value.entries.map((item) =>
            item.id === entry.id ? entry : item,
          ),
        });
      return entry;
    } catch (error) {
      setLoadError(true);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [userId, adopt]);

  const stage = useCallback(
    (state: State) => {
      currentState.current = state;
      const snapshot = snapshotOf(state);
      if (snapshot)
        writer.update(nameRef.current.trim() || "My timetable", snapshot);
    },
    [writer],
  );

  const autosave = useCallback(
    (state: State) => {
      stage(state);
      cancelTimer();
      if (writer.status === "error" || writer.status === "conflict") return;
      timer.current = setTimeout(() => {
        void writer.flush().catch(() => {});
      }, 400);
    },
    [writer, stage, cancelTimer],
  );

  const save = useCallback(
    async (state: State) => {
      stage(state);
      cancelTimer();
      try {
        await writer.flush();
        return true;
      } catch {
        return false;
      }
    },
    [writer, stage, cancelTimer],
  );

  const setName = useCallback(
    (value: string) => {
      nameRef.current = value;
      updateName(value);
      if (currentState.current) autosave(currentState.current);
    },
    [autosave],
  );

  const open = useCallback(
    async (id: string) => {
      cancelTimer();
      await writer.flush();
      const entry = await savedTimetablesApi.open.mutate({
        id,
        accountId: userId,
      });
      adopt(entry);
      setLibrary((previous) => ({
        ...previous,
        activeId: entry.id,
        entries: [
          ...previous.entries.filter((item) => item.id !== entry.id),
          entry,
        ],
      }));
      return entry;
    },
    [writer, adopt, cancelTimer, userId],
  );

  const remove = useCallback(
    async (id: string) => {
      cancelTimer();
      await writer.flush();
      const active = id === writer.activeId;
      const revision = active
        ? writer.savedRevision
        : library.entries.find((entry) => entry.id === id)?.revision;
      if (!revision)
        throw new Error("Reload the library before deleting this timetable.");
      const removed = await savedTimetablesApi.remove.mutate({
        accountId: userId,
        id,
        revision,
      });
      if (active) adopt(null);
      setLastDeleted(removed);
      setSelectedId((selected) => (selected === id ? "" : selected));
      setLibrary((previous) => ({
        ...previous,
        activeId: previous.activeId === id ? null : previous.activeId,
        entries: previous.entries.filter((entry) => entry.id !== id),
      }));
      return active;
    },
    [writer, cancelTimer, adopt, library.entries, userId],
  );

  const undoDelete = useCallback(async () => {
    if (!lastDeleted) return;
    const entry = await savedTimetablesApi.restore.mutate({
      accountId: userId,
      ...lastDeleted,
    });
    setLibrary((previous) => ({
      ...previous,
      entries: [
        ...previous.entries.filter((item) => item.id !== entry.id),
        entry,
      ],
    }));
    setSelectedId(entry.id);
    setLastDeleted(null);
  }, [lastDeleted, userId]);

  const startNew = useCallback(async () => {
    cancelTimer();
    await writer.flush();
    adopt(null);
    setLibrary((previous) => ({ ...previous, activeId: null }));
  }, [writer, adopt, cancelTimer]);

  const saveCopy = useCallback(
    async (state: State) => {
      stage(state);
      cancelTimer();
      nameRef.current = `${(nameRef.current.trim() || "My timetable").slice(0, 73)} (copy)`;
      updateName(nameRef.current);
      try {
        await writer.saveCopy();
        setSelectedId(writer.activeId);
        return true;
      } catch {
        return false;
      }
    },
    [writer, stage, cancelTimer],
  );

  useEffect(() => {
    mounted.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!writer.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const flush = () => {
      if (writer.status !== "conflict") void writer.flush().catch(() => {});
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      cancelTimer();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [writer, cancelTimer]);

  const notices: Record<SaveStatus, string> = {
    saved: library.entries.length
      ? "Timetable and chat saved to your account."
      : "Your timetable and chat will save to your account as you work.",
    dirty: "Unsaved changes…",
    saving: "Saving timetable and chat…",
    error:
      "Save failed. Your changes are still on this page. Retry before leaving.",
    conflict:
      "This timetable changed in another tab or device. Save a copy to keep your changes.",
  };
  const notice = loading
    ? "Loading saved timetables and chat…"
    : loadError
      ? "Could not load your saved timetables. Retry to reconnect."
      : `${warning ? `${warning} ` : ""}${notices[status]}`;

  return {
    library,
    name,
    setName,
    selectedId,
    setSelectedId,
    notice,
    status,
    loading,
    loadError,
    load,
    save,
    autosave,
    open,
    startNew,
    saveCopy,
    remove,
    undoDelete,
    lastDeleted,
  };
}
