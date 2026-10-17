"""Exercise all five endpoints. Uses the running server's AI provider (may incur API cost)."""

import argparse
import os
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
PREFERENCES = "No classes before 10, keep Fridays free, and match my timetable with Maya Okafor."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument(
        "--user-id",
        default=f"smoke-{uuid4().hex}",
        help="Use a configured profile ID for a non-demo catalogue.",
    )
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")
    token = os.getenv("TIMETABLE_BACKEND_TOKEN")
    if not token:
        raise SystemExit("Set TIMETABLE_BACKEND_TOKEN in Backend/.env first.")
    with httpx.Client(
        base_url=args.url,
        timeout=30,
        headers={
            "Authorization": f"Bearer {token}",
            "X-User-Id": args.user_id,
            "X-User-Name": "Smoke%20Test",
        },
    ) as client:

        def call(path, body=None):
            response = client.get(path) if body is None else client.post(path, json=body)
            if not response.is_success:
                raise SystemExit(
                    f"{path}: HTTP {response.status_code}: {response.json().get('detail', 'Request failed')}"
                )
            print(f"PASS {path}")
            return response.json()

        call("/context")
        parsed = call("/parse", {"text": PREFERENCES})
        if not parsed["rules"]:
            raise SystemExit("Parsing returned no rules for the sample preferences.")
        plan = call("/solve", {"rules": parsed["rules"]})
        plan = call(
            "/adjust",
            {
                "plan_id": plan["plan_id"],
                "text": "Can you move my Wednesday workshop earlier? I start work at 15:00.",
            },
        )
        confirmation = call("/confirm", {"plan_id": plan["plan_id"]})
        again = call("/confirm", {"plan_id": plan["plan_id"]})
        if again != confirmation:
            raise SystemExit("Confirmation retries returned different results.")
        print(
            "PASS confirmation retry. This created a local test confirmation; no university submission."
        )


if __name__ == "__main__":
    main()
