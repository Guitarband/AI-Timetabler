import hmac
import logging
import os
import sqlite3
from pathlib import Path
from time import perf_counter
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from pydantic import ValidationError
from werkzeug.exceptions import HTTPException

from .ai import DeepSeekParser, FixtureParser
from .catalogue import Catalogue
from .errors import ApiError
from .models import (
    AdjustRequest,
    AlternativesRequest,
    ConfirmRequest,
    KeepRequest,
    ParseRequest,
    SolveRequest,
    SwapRequest,
)
from .service import Service
from .storage import Store

ROOT = Path(__file__).resolve().parents[1]


def create_app(config: dict | None = None, *, parser=None):
    load_dotenv(ROOT / ".env", override=False)
    app = Flask(__name__)
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    app.logger.setLevel(getattr(logging, log_level, logging.INFO))
    app.config.from_mapping(
        TIMETABLE_BACKEND_TOKEN=os.getenv("TIMETABLE_BACKEND_TOKEN", ""),
        AI_PROVIDER=os.getenv("AI_PROVIDER", "deepseek"),
        DEEPSEEK_API_KEY=os.getenv("DEEPSEEK_API_KEY", ""),
        DEEPSEEK_MODEL=os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
        DEEPSEEK_BASE_URL=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        DEEPSEEK_TIMEOUT_SECONDS=float(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "20")),
        CORS_ORIGINS=os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(
            ","
        ),
        CATALOGUE_PATH=os.getenv("CATALOGUE_PATH", "data/catalogue.json"),
        CATALOGUE_SOURCE=os.getenv("CATALOGUE_SOURCE", "file"),
        POSTGRES_URL=os.getenv("POSTGRES_URL", ""),
        TERM_ID=os.getenv("TERM_ID", "2026-fall"),
        DATABASE_PATH=os.getenv("DATABASE_PATH", "instance/enrolment.sqlite3"),
        SOLVER_TIMEOUT_SECONDS=float(os.getenv("SOLVER_TIMEOUT_SECONDS", "3")),
        MAX_SOLVER_NODES=int(os.getenv("MAX_SOLVER_NODES", "200000")),
        SWAP_WINDOW_DAYS=int(os.getenv("SWAP_WINDOW_DAYS", "14")),
        MAX_CONTENT_LENGTH=128 * 1024,
    )
    if config:
        app.config.update(config)
    settings = app.config
    if len(settings["TIMETABLE_BACKEND_TOKEN"]) < 32:
        raise ValueError(
            "Set TIMETABLE_BACKEND_TOKEN to a random secret of at least 32 characters."
        )
    if settings["AI_PROVIDER"] not in {"deepseek", "fixture"}:
        raise ValueError("AI_PROVIDER must be deepseek or fixture.")
    if not 0 < settings["DEEPSEEK_TIMEOUT_SECONDS"] <= 20:
        raise ValueError("DEEPSEEK_TIMEOUT_SECONDS must be between 0 and 20.")
    if not 0 < settings["SOLVER_TIMEOUT_SECONDS"] <= 3 or settings["MAX_SOLVER_NODES"] < 1:
        raise ValueError("Solver limits must be positive; its timeout must not exceed 3 seconds.")
    if not 1 <= settings["SWAP_WINDOW_DAYS"] <= 365:
        raise ValueError("SWAP_WINDOW_DAYS must be between 1 and 365.")
    if urlparse(settings["DEEPSEEK_BASE_URL"]).scheme != "https":
        raise ValueError("DEEPSEEK_BASE_URL must use HTTPS.")
    origins = [origin.strip() for origin in settings["CORS_ORIGINS"] if origin.strip()]
    if not origins or any(
        "*" in origin or urlparse(origin).scheme not in {"http", "https"} for origin in origins
    ):
        raise ValueError("Configure explicit HTTP(S) CORS origins; wildcards are not allowed.")
    CORS(
        app,
        origins=origins,
        methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-User-Id", "X-User-Name"],
        supports_credentials=False,
        max_age=600,
    )
    for name in ("DATABASE_PATH", "CATALOGUE_PATH"):
        settings[name] = str((ROOT / settings[name]).resolve())
    selected_parser = parser or (
        FixtureParser() if settings["AI_PROVIDER"] == "fixture" else DeepSeekParser(settings)
    )
    if settings["CATALOGUE_SOURCE"] not in {"file", "postgres"}:
        raise ValueError("CATALOGUE_SOURCE must be file or postgres.")
    database, service = None, None
    if settings["CATALOGUE_SOURCE"] == "postgres":
        if not settings["POSTGRES_URL"]:
            raise ValueError("POSTGRES_URL is required in database mode.")
        from .postgres import Database, PostgresStore

        database = Database(settings["POSTGRES_URL"], settings["TERM_ID"])
        app.extensions["planner_database"] = database
    else:
        catalogue = Catalogue.load(settings["CATALOGUE_PATH"])
        if settings["AI_PROVIDER"] == "fixture" and not catalogue.demo:
            raise ValueError("The fixture parser is only available with a demo catalogue.")
        service = Service(catalogue, Store(settings["DATABASE_PATH"]), selected_parser, settings)
        app.extensions["enrolment"] = service

    app.logger.info(
        "Backend ready provider=%s catalogue_source=%s cors_origins=%d",
        settings["AI_PROVIDER"],
        settings["CATALOGUE_SOURCE"],
        len(origins),
    )

    def current_service():
        if database is None:
            return service
        # Request-local catalogue: never share one student's directory data or stale capacity.
        return Service(
            database.catalogue(g.owner),
            PostgresStore(database),
            selected_parser,
            settings,
            database,
        )

    @app.before_request
    def authenticate():
        request_started = perf_counter()
        request.environ["backend.request_started"] = request_started
        if request.method == "OPTIONS" or request.path == "/health":
            return None
        expected = f"Bearer {settings['TIMETABLE_BACKEND_TOKEN']}"
        supplied = request.headers.get("Authorization", "")
        if not hmac.compare_digest(supplied.encode(), expected.encode()):
            raise ApiError(401, "A valid backend service token is required.")
        owner = request.headers.get("X-User-Id", "")
        if not owner.strip() or len(owner) > 200 or any(ord(char) < 32 for char in owner):
            raise ApiError(400, "A verified X-User-Id is required.")
        g.owner = owner
        # This metadata is set by the trusted Next.js server, never by browser input.
        try:
            name = unquote(request.headers.get("X-User-Name", "Student"), errors="strict").strip()
        except UnicodeDecodeError as error:
            raise ApiError(400, "The verified user name is invalid.") from error
        if not name or len(name) > 100 or any(ord(char) < 32 for char in name):
            raise ApiError(400, "The verified user name is invalid.")
        g.name = name
        return None

    @app.after_request
    def private(response):
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        request_started = request.environ.get("backend.request_started")
        elapsed_ms = (perf_counter() - request_started) * 1000 if request_started else 0
        app.logger.info(
            "HTTP %s %s status=%s duration_ms=%.1f",
            request.method,
            request.path,
            response.status_code,
            elapsed_ms,
        )
        return response

    def body(model):
        if not request.is_json:
            raise ApiError(415, "Send JSON with Content-Type: application/json.")
        return model.model_validate(request.get_json())

    def result(model):
        return jsonify(model.model_dump(mode="json", exclude_none=True))

    @app.get("/health")
    def health():
        return jsonify(status="ok")

    @app.get("/context")
    def context():
        return result(current_service().context(g.owner, g.name))

    @app.post("/parse")
    def parse():
        data = body(ParseRequest)
        return result(current_service().parse(g.owner, data.text, history=data.history))

    @app.post("/solve")
    def build():
        return result(current_service().build(g.owner, body(SolveRequest).rules))

    @app.post("/adjust")
    def adjust():
        data = body(AdjustRequest)
        return result(
            current_service().adjust(g.owner, data.plan_id, data.text, history=data.history)
        )

    @app.post("/confirm")
    def confirm():
        return result(current_service().confirm(g.owner, body(ConfirmRequest).plan_id))

    @app.post("/alternatives")
    def alternatives():
        data = body(AlternativesRequest)
        return result(current_service().alternatives(g.owner, data.plan_id, data.section_key))

    @app.post("/keep")
    def keep():
        data = body(KeepRequest)
        return result(current_service().keep(g.owner, data.plan_id, data.section_key, data.keep))

    @app.post("/swap")
    def swap():
        data = body(SwapRequest)
        return result(current_service().swap(g.owner, data.plan_id, data.from_key, data.to_key))

    @app.errorhandler(ApiError)
    def api_error(error):
        log = app.logger.warning if error.status < 500 else app.logger.error
        log("Request rejected status=%s", error.status)
        return jsonify(detail=error.detail), error.status

    @app.errorhandler(ValidationError)
    def validation_error(error):
        first = error.errors(include_input=False, include_url=False)[0]
        field = ".".join(map(str, first["loc"]))
        app.logger.warning("Request validation failed field=%s", field or "request")
        return jsonify(detail=f"Invalid {field or 'request'}: {first['msg']}"), 422

    @app.errorhandler(HTTPException)
    def http_error(error):
        app.logger.warning("HTTP request failed status=%s", error.code)
        return jsonify(detail=error.description), error.code

    @app.errorhandler(sqlite3.OperationalError)
    def storage_error(error):
        app.logger.exception("The plan database is unavailable")
        return jsonify(detail="Plan storage is temporarily unavailable. Please retry."), 503

    @app.errorhandler(Exception)
    def unexpected_error(error):
        app.logger.exception("Unexpected backend error")
        return jsonify(detail="The backend could not complete this request. Please try again."), 500

    return app
