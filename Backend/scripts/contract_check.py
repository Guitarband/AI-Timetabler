"""Run the original UI contract suite against an isolated, offline Flask HTTP server."""

import os
import secrets
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from uuid import uuid4

from werkzeug.serving import WSGIRequestHandler, make_server

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from enrolment import create_app  # noqa: E402


class QuietHandler(WSGIRequestHandler):
    def log_request(self, code="-", size="-"):
        pass


def main():
    token = secrets.token_urlsafe(48)
    app = create_app(
        {
            "AI_PROVIDER": "fixture",
            "CATALOGUE_SOURCE": "file",
            "TIMETABLE_BACKEND_TOKEN": token,
            "CATALOGUE_PATH": "data/catalogue.json",
            "DATABASE_PATH": f"instance/contract-{uuid4().hex}.sqlite3",
        }
    )
    server = make_server("127.0.0.1", 0, app, threaded=True, request_handler=QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = dict(
        os.environ,
        CONTRACT_BASE_URL=f"http://127.0.0.1:{server.server_port}",
        CONTRACT_SERVICE_TOKEN=token,
        CONTRACT_USER_ID="contract-student",
    )
    project = (
        ROOT.parent / "Full Frontend Verion V.1" / "Enrolment_Assistant" / "Enrolment_Assistant"
    )
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise SystemExit("Install Node.js/npm before running the UI contract suite.")
    try:
        result = subprocess.run(
            [npm, "run", "test:contract", "-w", "@earth/web"], cwd=project, env=env, check=False
        )
        return result.returncode
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
