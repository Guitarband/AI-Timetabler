"""Live identity questions through auth, Next.js, Flask, DeepSeek and PostgreSQL.

Uses the existing fictional test account. Saves one draft; never confirms enrolment.
"""

import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]


def main():
    account = json.loads((ROOT / "instance/friend-test-account.json").read_text())
    with httpx.Client(
        base_url="http://localhost:3000", timeout=60, headers={"Origin": "http://localhost:3000"}
    ) as client:

        def call(method, value):
            response = client.post(f"/api/trpc/{method}", json=value)
            assert response.status_code == 200, f"{method}: HTTP {response.status_code}"
            return response.json()["result"]["data"]

        call("auth.signIn", {k: account[k] for k in ["email", "password"]})
        try:
            for question, expected in [
                ("Who is student 32000001", "Student 32000001 is Maya Okafor."),
                ("Whose student ID is 32000002?", "Student 32000002 is Leo Chen."),
                ("What is Maya Okafor's student ID?", "Student 32000001 is Maya Okafor."),
            ]:
                result = call("enrolment.parse", {"text": question})
                assert result["rules"] == [] and result["message"]["text"] == expected, result
                print(f"PASS: {question} -> {expected}", flush=True)
            parsed = call("enrolment.parse", {"text": "Match my timetable with student 32000002"})
            assert len(parsed["rules"]) == 1 and parsed["rules"][0]["kind"] == "friend"
            plan = call("enrolment.solve", {"rules": parsed["rules"]})
            reply = call(
                "enrolment.adjust", {"plan_id": plan["plan_id"], "text": "Who is student 32000001"}
            )
            for field in ["plan_id", "version", "sections", "rules", "scores", "match_pct"]:
                assert reply[field] == plan[field], field
            assert not reply["changed"]
            assert reply["message"]["text"] == "Student 32000001 is Maya Okafor."
            print("PASS: identity lookup leaves the existing draft unchanged.", flush=True)
            matches = call(
                "enrolment.adjust",
                {
                    "plan_id": plan["plan_id"],
                    "text": "Which classes currently match with student 32000002?",
                },
            )
            assert "Leo Chen [32000002]: 8 matching classes" in matches["message"]["text"]
            assert not matches["changed"]
            print("PASS: matching requests and class-match questions still work.", flush=True)
            missing = client.post(
                "/api/trpc/enrolment.parse", json={"text": "Who is student 99999999?"}
            )
            assert missing.status_code == 400
            assert "No student matches" in missing.json()["error"]["message"]
            print("PASS: unknown student gets a lookup explanation.", flush=True)
        finally:
            call("auth.signOut", {})


if __name__ == "__main__":
    main()
