import os

from waitress import serve

from enrolment import create_app

if __name__ == "__main__":
    app = create_app()
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    app.logger.info("Starting timetable backend host=%s port=%s", host, port)
    serve(app, host=host, port=port, threads=8)
