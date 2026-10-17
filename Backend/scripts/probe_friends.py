"""Live Next.js -> Better Auth/PostgreSQL -> Flask -> DeepSeek integration check.

First run: --create-test-account creates one fictional local-development account.
Later runs reuse its credentials in ignored instance storage. No emails are sent
when the development verification bypass is enabled. Makes five paid AI calls.
"""

import argparse
import json
import secrets
import time
from pathlib import Path
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[1]
MAYA, LEO = "Maya Okafor", "Leo Chen"


def verify(plan, expected):
    sections = plan["sections"]
    keys = {s["key"] for s in sections}
    assert len(sections) == len(keys) == 8
    assert not {"phil-s01", "phil-s02"} <= keys
    assert not {"writ-w01", "writ-w03"} <= keys
    assert all(
        not (a["day"] == b["day"] and a["start"] < b["end"] and b["start"] < a["end"])
        for i, a in enumerate(sections)
        for b in sections[i + 1 :]
    )
    assert {f["name"]: f["shared"] for f in plan["friends"]} == expected
    assert all(f["total"] == 3 for f in plan["friends"])
    assert plan["match_pct"] == (100 if len(expected) == 1 else 83)
    shared = {MAYA: {"psyc-l02", "stat-l01", "phil-s01"}, LEO: {"psyc-l02", "writ-w03", "phil-s02"}}
    for section in sections:
        names = {name for name in expected if section["key"] in shared[name]}
        assert set(section["shared_with"]) == names
        assert section["with_friend"] == bool(names)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create-test-account", action="store_true")
    args = parser.parse_args()
    account_path = ROOT / "instance" / "friend-test-account.json"
    account_path.parent.mkdir(parents=True, exist_ok=True)
    if not account_path.exists() and not args.create_test_account:
        raise SystemExit("First run needs --create-test-account (local development only).")
    records = []
    with httpx.Client(
        base_url="http://localhost:3000", timeout=60, headers={"Origin": "http://localhost:3000"}
    ) as client:

        def call(method, value=None, *, query=False):
            started = time.monotonic()
            path = f"/api/trpc/{method}"
            response = client.get(path) if query else client.post(path, json=value or {})
            if response.status_code != 200:
                # Avoid logging request credentials, cookies or whole auth responses.
                raise AssertionError(f"{method} returned HTTP {response.status_code}")
            result = response.json()["result"]["data"]
            records.append(
                {
                    "operation": method,
                    "seconds": round(time.monotonic() - started, 2),
                    **(
                        {"input": value, "response": result}
                        if method.startswith("enrolment.")
                        else {}
                    ),
                }
            )
            return result

        if account_path.exists():
            account = json.loads(account_path.read_text(encoding="utf-8"))
        else:
            account = {
                "name": "Sample Friend Matching Test",
                "email": f"friend-test-{uuid4().hex[:12]}@monash.edu",
                "password": secrets.token_urlsafe(32),
            }
            result = call("auth.signUp", account)
            assert result["verificationRequired"] is False, "Enable the local development bypass."
            account_path.write_text(json.dumps(account), encoding="utf-8")
            print(
                "Created one fictional test account; credentials retained in ignored local storage.",
                flush=True,
            )
        call("auth.signIn", {k: account[k] for k in ["email", "password"]})
        try:
            session = call("auth.session", query=True)
            assert session["signedIn"] and session["user"]["name"] == account["name"]
            home = client.get("/")
            assert home.status_code == 200 and account["name"] in home.text
            context = call("enrolment.context", query=True)
            assert context["student_name"] == account["name"]
            assert {MAYA, LEO} <= set(context["friends"])
            first = None
            for text, expected in [
                ("Match my timetable with Maya Okafor.", {MAYA: 3}),
                ("Match my timetable with Leo Chen.", {LEO: 3}),
                (
                    "Match my timetable with both Maya Okafor and Leo Chen equally. Keep every required class.",
                    {MAYA: 2, LEO: 3},
                ),
            ]:
                parsed = call("enrolment.parse", {"text": text})
                assert {r["value"] for r in parsed["rules"] if r["kind"] == "friend"} == set(
                    expected
                )
                assert all(r["source"] in text for r in parsed["rules"])
                plan = call("enrolment.solve", {"rules": parsed["rules"]})
                verify(plan, expected)
                if first is None:
                    first = plan
                print(
                    json.dumps({"text": text, "matches": expected, "score": plan["match_pct"]}),
                    flush=True,
                )
            adjusted = call(
                "enrolment.adjust",
                {
                    "plan_id": first["plan_id"],
                    "text": "Also match my timetable with Leo Chen. Keep matching Maya Okafor as well; match both as much as possible.",
                },
            )
            verify(adjusted, {MAYA: 3, LEO: 2})
            assert adjusted["version"] == 2 and adjusted["changed"]
            print(
                "Adding Leo to Maya's plan: Maya 3/3, Leo 2/3, 83%; previous seminar preserved on tie.",
                flush=True,
            )
            undone = call(
                "enrolment.adjust",
                {"plan_id": adjusted["plan_id"], "text": "Undo the last change."},
            )
            verify(undone, {MAYA: 3})
            assert undone["version"] == 3
            print("Undo restored Maya-only matching and the original sections.", flush=True)
        finally:
            call("auth.signOut")
            assert not call("auth.session", query=True)["signedIn"]
            (ROOT / "instance" / "friends-probe.json").write_text(
                json.dumps(records, indent=2), encoding="utf-8"
            )
    print(
        "PASS: local signup/login, session name, three matching scenarios, adjustment, undo and signout."
    )


if __name__ == "__main__":
    main()
