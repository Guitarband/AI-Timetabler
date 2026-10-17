"""Live name/ID matching through Next.js and DeepSeek. Does not confirm enrolment.

Uses the existing fictional test login; seed and assign its courses first.
"""

import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]


def main():
    account = json.loads((ROOT / "instance/friend-test-account.json").read_text())
    records = []
    with httpx.Client(
        base_url="http://localhost:3000", timeout=60, headers={"Origin": "http://localhost:3000"}
    ) as client:

        def call(method, value):
            response = client.post(f"/api/trpc/{method}", json=value)
            if response.status_code != 200:
                raise AssertionError(
                    f"{method}: HTTP {response.status_code}: {response.json().get('error', {}).get('message', 'Failed')}"
                )
            return response.json()["result"]["data"]

        call("auth.signIn", {k: account[k] for k in ["email", "password"]})
        try:
            for question, ids in [
                ("Match my timetable with student ID 32000001", ["32000001"]),
                ("Match my timetable with Maya Okafor", ["32000001"]),
                ("Match my timetable with student 32000002", ["32000002"]),
                ("Match my timetable with Maya and Leo equally", ["32000001", "32000002"]),
            ]:
                parsed = call("enrolment.parse", {"text": question})
                values = [r["value"] for r in parsed["rules"] if r["kind"] == "friend"]
                assert len(values) == len(ids) and all(
                    any(sid in value for value in values) for sid in ids
                ), parsed
                plan = call("enrolment.solve", {"rules": parsed["rules"]})
                assert len(plan["sections"]) == 8 and all(
                    s["key"] != "writ-w99-full" for s in plan["sections"]
                )
                assert all(f["total"] == 8 for f in plan["friends"])
                assert sum(f["shared"] for f in plan["friends"]) == (8 if len(ids) == 1 else 14)
                records.append(
                    {"prompt": question, "friends": plan["friends"], "full_section_excluded": True}
                )
                print(f"PASS: {question}", flush=True)
            reply = call(
                "enrolment.adjust",
                {
                    "plan_id": plan["plan_id"],
                    "text": "Which of my classes currently match with student ID 32000001?",
                },
            )
            assert reply["changed"] is False and reply["version"] == plan["version"]
            assert "Maya Okafor [32000001]" in reply["message"]["text"]
            print("PASS: read-only question resolves student ID from PostgreSQL.", flush=True)
            response = client.post(
                "/api/trpc/enrolment.parse",
                json={"text": "Match my timetable with student ID 99999999"},
            )
            assert (
                response.status_code == 400
                and "No student matches" in response.json()["error"]["message"]
            )
            print("PASS: unknown student gets a helpful lookup error.", flush=True)
        finally:
            call("auth.signOut", {})
            (ROOT / "instance/database-probe.json").write_text(
                json.dumps(records, indent=2), encoding="utf-8"
            )


if __name__ == "__main__":
    main()
