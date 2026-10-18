"""Conservative, catalogue-backed detection of conflicting preferences."""

from .models import RELATIVE_KINDS
from .solver import score

TIME_KINDS = {"earliest", "latest", "earliest_day", "latest_day"}
SECTION_KINDS = TIME_KINDS | RELATIVE_KINDS | {"dayoff"}


def time_bound(rule):
    if rule.kind.endswith("_day"):
        day, value = map(int, str(rule.value).split("@"))
        return {day}, value
    return set(range(1, 6)), int(rule.value)


def conflicts(existing, added, published, profile):
    """Return old rule IDs and factual reasons; never nominate friends or Keep settings."""
    found = {}
    for old in existing:
        for new in added:
            if (old.kind, old.value) == (new.kind, new.value):
                continue
            reason = None
            if old.kind in TIME_KINDS and new.kind in TIME_KINDS:
                old_days, old_time = time_bound(old)
                new_days, new_time = time_bound(new)
                old_start = old.kind.startswith("earliest")
                new_start = new.kind.startswith("earliest")
                if old_days == new_days and old_start == new_start:
                    reason = "These rules set different limits for the same days."
                elif old_days & new_days and old_start != new_start:
                    start, end = (old_time, new_time) if old_start else (new_time, old_time)
                    if start >= end:
                        reason = (
                            "The start limit is at or after the finish limit on overlapping days."
                        )
            # Compare alternatives only for an explicitly targeted required class.
            # Unavailable new options are a feasibility problem, not grounds to delete a rule.
            if (
                reason is None
                and old.kind in SECTION_KINDS
                and new.kind in SECTION_KINDS
                and (old.kind in RELATIVE_KINDS or new.kind in RELATIVE_KINDS)
            ):
                references = [
                    published.get(str(r.value)) for r in (old, new) if r.kind in RELATIVE_KINDS
                ]
                if not all(references) or len({s.group for s in references}) != 1:
                    continue
                options = [
                    s for s in published.values() if s.group == references[0].group and s.selectable
                ]
                new_options = [s for s in options if score(new, [s], profile, published)[0] == 1]
                old_options = [s for s in options if score(old, [s], profile, published)[0] == 1]
                if (
                    new_options
                    and old_options
                    and not any(score(old, [s], profile, published)[0] == 1 for s in new_options)
                ):
                    reason = "No available option for this class meets both preferences."
            if reason:
                found.setdefault(old.id, []).append(
                    f"“{old.label}” conflicts with “{new.label}”. {reason}"
                )
    return found
