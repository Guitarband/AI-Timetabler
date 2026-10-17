from enrolment import create_app
from enrolment.ai import rule_identity
from enrolment.models import Rule


def test_postgres_startup_does_not_load_json_or_create_sqlite(settings, tmp_path):
    catalogue = tmp_path / "absent.json"
    sqlite = tmp_path / "should-not-exist.sqlite3"
    settings.update(
        CATALOGUE_SOURCE="postgres",
        POSTGRES_URL="postgresql://unused/unused",
        CATALOGUE_PATH=str(catalogue),
        DATABASE_PATH=str(sqlite),
    )
    app = create_app(settings)
    assert app.test_client().get("/health").status_code == 200
    assert not sqlite.exists() and not catalogue.exists()
    assert "planner_database" in app.extensions


def test_resolved_friend_identity_survives_name_change():
    def rule(name):
        return Rule(id="friend", kind="friend", value=name, label="Match", source="friend")

    assert rule_identity(rule("Maya Okafor [32000001]")) == rule_identity(
        rule("Maya Newname [32000001]")
    )
    assert rule_identity(rule("Maya Okafor [32000001]")) != rule_identity(
        rule("Maya Okafor [32000002]")
    )
