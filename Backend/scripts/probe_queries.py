"""Live read-only query regression using the existing fictional test account.

Run both services first. Makes paid DeepSeek calls; never confirms enrolment.
Credentials remain in ignored instance/friend-test-account.json.
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
            assert response.status_code == 200, f"{method}: HTTP {response.status_code}"
            return response.json()["result"]["data"]

        call("auth.signIn", {k: account[k] for k in ["email", "password"]})
        try:
            parsed = call(
                "enrolment.parse",
                {
                    "text": "No classes before 10, keep Fridays free, and match my timetable with Maya Okafor."
                },
            )
            plan = call("enrolment.solve", {"rules": parsed["rules"]})
            for question, expected in [
                (
                    "Which of my classes currently match with Maya?",
                    ["Maya Okafor: 2 matching classes", "PSYC 1010", "STAT 2010"],
                ),
                (
                    "Do I share anything with Maya on Wednesday?",
                    ["0 matching classes on Wednesday"],
                ),
                (
                    "What classes do I have on Wednesday and where?",
                    ["WRIT 1000", "Studio 2", "Wednesday"],
                ),
                ("Why is my preference match below 100%?", ["89%", "Maya"]),
                (
                    "What other sections are available for my PHIL 1100 seminar? Don't change anything yet.",
                    ["Friday 09:00", "draft has not changed"],
                ),
                ("Which days do I have no classes?", ["Days without classes: Friday"]),
                (
                    "Which of my classes match with both Maya and Leo?",
                    ["Maya Okafor: 2", "Leo Chen: 2"],
                ),
                ("What can you help me with?", ["answer questions"]),
            ]:
                result = call("enrolment.adjust", {"plan_id": plan["plan_id"], "text": question})
                for field in [
                    "plan_id",
                    "version",
                    "sections",
                    "rules",
                    "scores",
                    "match_pct",
                    "friends",
                ]:
                    assert result[field] == plan[field], (question, field)
                assert result["changed"] is False
                text = result["message"]["text"] + "\n" + "\n".join(result["message"]["steps"])
                assert all(fragment in text for fragment in expected), (question, text)
                records.append({"question": question, "answer": text, "unchanged": True})
                print(f"PASS: {question}", flush=True)
            # A real adjustment still works after all questions on the same draft.
            result = call(
                "enrolment.adjust",
                {
                    "plan_id": plan["plan_id"],
                    "text": "Move my Wednesday workshop earlier. I start work at 15:00.",
                },
            )
            assert result["changed"] and result["version"] == plan["version"] + 1
            assert any(s["key"] == "writ-w03" for s in result["sections"])
            print("PASS: subsequent adjustment still changes the timetable.", flush=True)
        finally:
            call("auth.signOut", {})
            (ROOT / "instance/queries-probe.json").write_text(
                json.dumps(records, indent=2), encoding="utf-8"
            )


if __name__ == "__main__":
    main()
