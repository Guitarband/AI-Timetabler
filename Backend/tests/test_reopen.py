from tests.test_class_choices import post


def test_reopen_preserves_confirmed_original_rules_pins_and_editable_copy(client, headers, draft):
    pinned = post(client, headers, "/keep", draft, section_key="psyc-l02", keep=True)
    confirmation = post(client, headers, "/confirm", pinned)
    copy = post(client, headers, "/reopen", pinned)
    assert copy["plan_id"] != pinned["plan_id"] and copy["version"] == 1
    assert copy["rules"] == pinned["rules"] and copy["sections"] == pinned["sections"]
    assert copy["kept_sections"] == ["psyc-l02"]
    changed = post(client, headers, "/swap", copy, from_key="writ-w01", to_key="writ-w03")
    assert changed["changed"]
    assert post(client, headers, "/confirm", pinned) == confirmation
    assert post(client, headers, "/confirm", changed)["reference"] != confirmation["reference"]


def test_reopen_requires_ownership_and_confirmation(client, headers, draft):
    assert (
        client.post("/reopen", headers=headers, json={"plan_id": draft["plan_id"]}).status_code
        == 409
    )
    post(client, headers, "/confirm", draft)
    assert (
        client.post(
            "/reopen",
            headers={**headers, "X-User-Id": "another-student"},
            json={"plan_id": draft["plan_id"]},
        ).status_code
        == 404
    )
    assert client.post("/reopen", json={"plan_id": draft["plan_id"]}).status_code == 401


def test_reopen_can_repair_a_class_that_closed_after_confirmation(app, client, headers, draft):
    post(client, headers, "/confirm", draft)
    workshop = next(
        s for s in app.extensions["enrolment"].catalogue.sections if s.key == "writ-w01"
    )
    workshop.selectable = False
    copy = post(client, headers, "/reopen", draft)
    assert copy["sections"] == draft["sections"]
    repaired = post(client, headers, "/swap", copy, from_key="writ-w01", to_key="writ-w03")
    assert repaired["changed"]
