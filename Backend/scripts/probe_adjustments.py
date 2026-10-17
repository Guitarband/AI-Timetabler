"""Paid live AI checks through Next.js, using the existing fictional test account.

Requires both services running and instance/friend-test-account.json from probe_friends.py.
Creates separate test drafts; never changes the user's open browser draft.
"""

import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    ("The friday is too early for me. Can you check other options on this?", "phil-s02"),
    ("Remove my friday seminar", "phil-s02"),
    ("I can't make that early Friday start. Is there anything later?", "phil-s02"),
    ("Get my philosophy class off Friday, please.", "phil-s02"),
    ("Move my Wednesday workshop earlier — I start work at 15:00", "writ-w03"),
    ("My writing workshop finishes too late. Can you find an earlier option?", "writ-w03"),
    ("Find a later PHIL seminar, but keep it on Friday.", "unchanged"),
    ("Remove my Monday psychology lecture from Monday.", "unchanged"),
    ("Drop PHIL 1100 entirely from my approved courses.", "unchanged"),
    ("Move it please.", "unchanged"),
]


def main():
    account = json.loads((ROOT / "instance/friend-test-account.json").read_text(encoding="utf-8"))
    records, failures = [], []
    with httpx.Client(
        base_url="http://localhost:3000", timeout=60, headers={"Origin": "http://localhost:3000"}
    ) as client:

        def call(method, body):
            response = client.post(f"/api/trpc/{method}", json=body)
            if response.status_code != 200:
                message = response.json().get("error", {}).get("message", "Request failed")
                raise AssertionError(f"{method}: HTTP {response.status_code}: {message}")
            return response.json()["result"]["data"]

        call("auth.signIn", {k: account[k] for k in ["email", "password"]})
        try:
            for text, expected in CASES:
                first = call(
                    "enrolment.solve",
                    {
                        "rules": [
                            {
                                "id": "maya",
                                "kind": "friend",
                                "value": "Maya Okafor",
                                "label": "Match Maya",
                                "source": "Maya",
                            }
                        ]
                    },
                )
                result = call("enrolment.adjust", {"plan_id": first["plan_id"], "text": text})
                keys = {s["key"] for s in result["sections"]}
                if expected == "unchanged":
                    passed = not result["changed"] and result["sections"] == first["sections"]
                else:
                    passed = result["changed"] and expected in keys and result["version"] == 2
                passed = passed and len(keys) == len(result["sections"]) == 8
                passed = passed and all(
                    not (a["day"] == b["day"] and a["start"] < b["end"] and b["start"] < a["end"])
                    for i, a in enumerate(result["sections"])
                    for b in result["sections"][i + 1 :]
                )
                if expected == "phil-s02":
                    passed = passed and "phil-s01" not in keys and result["friend"]["shared"] == 2
                expected_explanation = {
                    "Find a later PHIL seminar, but keep it on Friday.": "Published alternative",
                    "Remove my Monday psychology lecture from Monday.": "no other published section",
                    "Drop PHIL 1100 entirely from my approved courses.": "cannot drop a course",
                    "Move it please.": "Which class",
                }.get(text)
                if expected_explanation:
                    passed = passed and expected_explanation in result["message"]["text"]
                if not passed:
                    failures.append(text)
                records.append({"text": text, "passed": passed, "plan": result})
                print(
                    json.dumps(
                        {
                            "input": text,
                            "passed": passed,
                            "changed": result["changed"],
                            "message": result["message"]["text"],
                        }
                    ),
                    flush=True,
                )
        finally:
            call("auth.signOut", {})
            (ROOT / "instance/adjustments-probe.json").write_text(
                json.dumps(records, indent=2), encoding="utf-8"
            )
    if failures:
        raise SystemExit(f"Failed {len(failures)} live cases: {failures}")
    print(f"PASS: {len(records)} conversational adjustment cases.")


if __name__ == "__main__":
    main()
