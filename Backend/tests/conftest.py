import pytest

from enrolment import create_app

TOKEN = "test-service-token-that-is-long-enough-12345"
PREFERENCES = "No classes before 10, keep Fridays free, and match my timetable with Maya Okafor."
CHANGE = "Can you move my Wednesday workshop earlier? I start work at 15:00."


@pytest.fixture
def settings(tmp_path):
    return {
        "TESTING": True,
        "CATALOGUE_SOURCE": "file",
        "AI_PROVIDER": "fixture",
        "TIMETABLE_BACKEND_TOKEN": TOKEN,
        "DATABASE_PATH": str(tmp_path / "plans.sqlite3"),
        "DEEPSEEK_API_KEY": "",
        "CATALOGUE_PATH": "data/catalogue.json",
    }


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def headers():
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-User-Id": "student-a",
        "X-User-Name": "Priya%20Shah",
    }


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def draft(client, headers):
    parsed = client.post("/parse", json={"text": PREFERENCES}, headers=headers)
    assert parsed.status_code == 200
    built = client.post("/solve", json={"rules": parsed.json["rules"]}, headers=headers)
    assert built.status_code == 200
    return built.json
