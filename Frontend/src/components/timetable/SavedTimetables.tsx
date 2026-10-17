import type { TimetableSummary } from "@/lib/saved-timetables";
import { Button } from "../ui/Button";

export function SavedTimetables(props: {
  entries: TimetableSummary[];
  name: string;
  selectedId: string;
  notice: string;
  disabled: boolean;
  canSave: boolean;
  retry: boolean;
  retryDisabled: boolean;
  conflict: boolean;
  onRetry: () => void;
  onSaveCopy: () => void;
  onName: (name: string) => void;
  onSelect: (id: string) => void;
  onSave: () => void;
  onNew: () => void;
  onOpen: () => void;
}) {
  return (
    <section className="saved-timetables" aria-label="Saved timetables">
      <div className="saved-timetables-controls">
        <label>
          Timetable name
          <input
            value={props.name}
            maxLength={80}
            placeholder="My timetable"
            disabled={props.disabled}
            onChange={(event) => props.onName(event.target.value)}
          />
        </label>
        <Button
          disabled={props.disabled || !props.canSave}
          onClick={props.onSave}
        >
          Save
        </Button>
        <Button disabled={props.disabled} onClick={props.onNew}>
          New timetable
        </Button>
        <label className="saved-timetables-picker">
          Saved timetables
          <select
            value={props.selectedId}
            disabled={props.disabled || !props.entries.length}
            onChange={(event) => props.onSelect(event.target.value)}
          >
            <option value="">Choose a timetable</option>
            {[...props.entries]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · {entry.term} ·{" "}
                  {entry.confirmed
                    ? "Confirmed"
                    : entry.planVersion
                      ? `Draft v${entry.planVersion}`
                      : "Conversation"}
                </option>
              ))}
          </select>
        </label>
        <Button
          disabled={props.disabled || !props.selectedId}
          onClick={props.onOpen}
        >
          Open
        </Button>
        {props.retry && (
          <Button disabled={props.retryDisabled} onClick={props.onRetry}>
            Retry
          </Button>
        )}
        {props.conflict && (
          <Button disabled={props.disabled} onClick={props.onSaveCopy}>
            Save a copy
          </Button>
        )}
      </div>
      <p>
        <output>{props.notice}</output>
      </p>
    </section>
  );
}
