"""Paid live-provider probes using fictional data; results stay in ignored instance storage."""

import json
import os
import time
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]


def verify(records):
    failures = []

    def check(condition, message):
        if not condition:
            failures.append(message)

    for record in records:
        check(
            record["status"] == 200, f"HTTP failure: {record['input'].get('text', record['path'])}"
        )
        body = record["response"]
        if "sections" not in body:
            continue
        sections = body["sections"]
        check(
            len(sections) == len({s["key"] for s in sections}) == 8,
            "Missing or duplicated required sections",
        )
        check(len(body["rules"]) == len(body["scores"]), "Missing rule scores")
        check(
            all(
                not (a["day"] == b["day"] and a["start"] < b["end"] and b["start"] < a["end"])
                for i, a in enumerate(sections)
                for b in sections[i + 1 :]
            ),
            "Timetable clash",
        )

    def reply(prefix):
        return next(
            (r["response"] for r in records if r["input"].get("text", "").startswith(prefix)), {}
        )

    first = reply("No classes before 10:30")
    check(
        {(r["kind"], r["value"]) for r in first.get("rules", [])}
        == {("earliest", 630), ("latest", 930), ("dayoff", 5), ("lunch", 60)},
        "Precise preferences were not parsed as four distinct rules",
    )
    moved = reply("Move only my WRIT")
    check(
        moved.get("version") == 2
        and any(s["key"] == "writ-w03" and s["changed"] for s in moved.get("sections", [])),
        "Exact workshop move failed",
    )
    for prefix in ["I now need ALL", "Move all my classes"]:
        body = reply(prefix)
        check(
            body.get("changed") is False
            and body.get("plan_id") == moved.get("plan_id")
            and body.get("sections") == moved.get("sections"),
            f"Impossible request changed the plan: {prefix}",
        )
    undo = reply("Undo the last change")
    check(
        undo.get("version") == 3 and any(s["key"] == "writ-w01" for s in undo.get("sections", [])),
        "Undo failed",
    )
    replacement = reply("Replace my")
    check(
        [r["value"] for r in replacement.get("rules", []) if r["kind"] == "earliest"] == [540],
        "Replacement retained the old time rule",
    )
    check(
        reply("Put me in Maya").get("friend", {}).get("shared") == 3, "Friend section did not match"
    )
    check(reply("Move WRIT 1000").get("changed") is False, "Invented section was accepted")
    scoped = reply("Only on Thursday")
    check(
        any(r["kind"] == "earliest_day" and r["value"] == "4@660" for r in scoped.get("rules", [])),
        "Thursday constraint lost its weekday",
    )
    check(
        not any(r["kind"] == "earliest" and r["value"] == 660 for r in scoped.get("rules", [])),
        "Thursday constraint became global",
    )
    check(reply("purple elephants").get("rules") == [], "Nonsense produced rules")
    if failures:
        raise SystemExit("Probe failures:\n" + "\n".join(failures))
    print("PASS all live probe assertions", flush=True)


def main():
    load_dotenv(ROOT / ".env")
    records = []
    with httpx.Client(
        base_url="http://127.0.0.1:8000",
        timeout=35,
        headers={
            "Authorization": f"Bearer {os.environ['TIMETABLE_BACKEND_TOKEN']}",
            "X-User-Id": f"probe-{uuid4().hex}",
            "X-User-Name": "AI%20Probe",
        },
    ) as client:

        def call(path, payload):
            start = time.monotonic()
            response = client.post(path, json=payload)
            body = response.json()
            record = {
                "path": path,
                "input": payload,
                "status": response.status_code,
                "seconds": round(time.monotonic() - start, 2),
                "response": body,
            }
            records.append(record)
            concise = {
                k: body[k] for k in ["detail", "version", "changed", "match_pct"] if k in body
            }
            if "rules" in body:
                concise["rules"] = [{"kind": r["kind"], "value": r["value"]} for r in body["rules"]]
            if "sections" in body:
                concise["sections"] = [s["key"] for s in body["sections"]]
            print(
                json.dumps(
                    {
                        "path": path,
                        "text": payload.get("text"),
                        "status": response.status_code,
                        "seconds": record["seconds"],
                        **concise,
                    }
                ),
                flush=True,
            )
            return body if response.is_success else None

        try:
            precise = call(
                "/parse",
                {
                    "text": "No classes before 10:30. Finish by 15:30 every day. Keep Fridays free. Leave a 60-minute lunch break between 11:00 and 14:00."
                },
            )
            if precise:
                call("/solve", {"rules": precise["rules"]})
            base = call(
                "/parse",
                {
                    "text": "No classes before 10, keep Fridays free, and match my timetable with Maya Okafor."
                },
            )
            if base:
                plan = call("/solve", {"rules": base["rules"]})
                for text in [
                    "Move only my WRIT 1000 Wednesday workshop to W-03, 11:30 to 13:00. I must finish on Wednesday by 15:00. Keep my other preferences.",
                    "I now need ALL Wednesday classes to finish by 12:45. Do not drop any required classes.",
                    "Move all my classes to Saturday.",
                    "Undo the last change.",
                ]:
                    if plan:
                        next_plan = call("/adjust", {"plan_id": plan["plan_id"], "text": text})
                        if next_plan:
                            plan = next_plan
                for text in [
                    "Replace my no-classes-before-10 rule with no classes before 09:00. Keep Fridays free and keep matching Maya.",
                    "Put me in Maya's PHIL 1100 seminar S-01 on Friday at 09:00. I accept losing my Friday off for this change.",
                    "Move WRIT 1000 to section W-99 on Wednesday at 12:00. Do not invent any new sections.",
                ]:
                    draft = call("/solve", {"rules": base["rules"]})
                    if draft:
                        call("/adjust", {"plan_id": draft["plan_id"], "text": text})
            call(
                "/parse",
                {
                    "text": "Only on Thursday, no classes before 11:00. Other days can start at 09:00."
                },
            )
            call("/parse", {"text": "purple elephants sing on tuesdays"})
        finally:
            output = ROOT / "instance" / "live-probe.json"
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(records, indent=2), encoding="utf-8")
            print("Detailed results saved to Backend/instance/live-probe.json", flush=True)
    verify(records)


if __name__ == "__main__":
    main()
