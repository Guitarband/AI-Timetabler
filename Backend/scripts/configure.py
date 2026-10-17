"""Create local configuration without displaying secrets or changing auth settings."""

import argparse
import secrets
from pathlib import Path

from dotenv import dotenv_values, set_key

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connect-frontend", action="store_true")
    parser.add_argument(
        "--postgres",
        action="store_true",
        help="Use the frontend's existing database connection for the planner",
    )
    args = parser.parse_args()
    backend = ROOT / ".env"
    frontend = ROOT.parent / "Frontend" / ".env"
    if not backend.exists():
        backend.write_text((ROOT / ".env.example").read_text(encoding="utf-8"), encoding="utf-8")
    backend_values = dotenv_values(backend)
    frontend_values = dotenv_values(frontend)
    token = backend_values.get("TIMETABLE_BACKEND_TOKEN") or frontend_values.get(
        "TIMETABLE_BACKEND_TOKEN"
    )
    if not token or len(token) < 32:
        token = secrets.token_urlsafe(48)
    set_key(str(backend), "TIMETABLE_BACKEND_TOKEN", token)
    if args.connect_frontend:
        set_key(str(frontend), "TIMETABLE_BACKEND_TOKEN", token)
        set_key(str(frontend), "ENROLMENT_BACKEND_URL", "http://127.0.0.1:8000")
        set_key(str(frontend), "NEXT_PUBLIC_USE_MOCK", "false")
        print("Connected Frontend/.env to Flask on port 8000. Restart the frontend.")
    if args.postgres:
        url = frontend_values.get("DATABASE_URL")
        if not url:
            raise SystemExit("Set DATABASE_URL in Frontend/.env first.")
        set_key(str(backend), "POSTGRES_URL", url)
        set_key(str(backend), "CATALOGUE_SOURCE", "postgres")
        set_key(str(backend), "TERM_ID", backend_values.get("TERM_ID") or "2026-fall")
        print(
            "Configured PostgreSQL planner mode. Apply the Prisma migrations before starting Flask."
        )
    print("Backend/.env is ready. Set DEEPSEEK_API_KEY there; no secrets were printed.")


if __name__ == "__main__":
    main()
