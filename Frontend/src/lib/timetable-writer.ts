import type {
  PlannerSnapshot,
  SavedTimetable,
  SaveTimetableInput,
} from "./saved-timetables";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";
type Draft = { name: string; snapshot: PlannerSnapshot };
const keyOf = (value: Draft) => JSON.stringify([value.name, value.snapshot]);

/** Serialize writes and retry an unacknowledged mutation with its original ID. */
export class TimetableWriter {
  private id: string = crypto.randomUUID();
  private revision = 0;
  private acknowledged = "";
  private desired: Draft | null = null;
  private pending: SaveTimetableInput | null = null;
  private running: Promise<void> | null = null;
  status: SaveStatus = "saved";

  constructor(
    private write: (input: SaveTimetableInput) => Promise<SavedTimetable>,
    private onSaved: (entry: SavedTimetable) => void,
    private onStatus: (status: SaveStatus) => void,
  ) {}

  private report(status: SaveStatus) {
    this.status = status;
    this.onStatus(status);
  }

  reset(entry: SavedTimetable | null) {
    if (this.running)
      throw new Error("Finish saving before opening another timetable.");
    this.id = entry?.id ?? crypto.randomUUID();
    this.revision = entry?.revision ?? 0;
    this.desired = entry
      ? { name: entry.name, snapshot: entry.snapshot }
      : null;
    this.acknowledged = this.desired ? keyOf(this.desired) : "";
    this.pending = null;
    this.report("saved");
  }

  update(name: string, snapshot: PlannerSnapshot) {
    this.desired = { name, snapshot };
    if (this.status === "error" || this.status === "conflict" || this.running)
      return;
    this.report(keyOf(this.desired) === this.acknowledged ? "saved" : "dirty");
  }

  get dirty() {
    return (
      !!this.pending ||
      (!!this.desired && keyOf(this.desired) !== this.acknowledged)
    );
  }

  get activeId() {
    return this.id;
  }

  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain() {
    try {
      while (this.desired && this.dirty) {
        this.pending ??= {
          id: this.id,
          revision: this.revision,
          mutationId: crypto.randomUUID(),
          ...this.desired,
        };
        const pending = this.pending;
        this.report("saving");
        const saved = await this.write(pending);
        this.revision = saved.revision;
        this.acknowledged = keyOf(pending);
        this.pending = null;
        this.onSaved(saved);
      }
      this.report("saved");
    } catch (error) {
      const code = (error as { data?: { code?: string } })?.data?.code;
      this.report(code === "CONFLICT" ? "conflict" : "error");
      throw error;
    }
  }

  async saveCopy() {
    if (this.running) await this.running.catch(() => {});
    if (!this.desired) return;
    this.id = crypto.randomUUID();
    this.revision = 0;
    this.pending = null;
    this.acknowledged = "";
    this.desired = {
      ...this.desired,
      name: `${this.desired.name.slice(0, 73)} (copy)`,
    };
    await this.flush();
  }
}
