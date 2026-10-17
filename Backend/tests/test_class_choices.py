import pytest

from enrolment.models import Intent, Move, SectionChange


def post(client, headers, route, plan, **values):
    response = client.post(route, headers=headers, json={"plan_id": plan["plan_id"], **values})
    assert response.status_code == 200, response.json
    return response.json


def test_direct_swap_only_moves_selected_class_and_warns_of_tradeoff(client, headers, draft):
    options = post(client, headers, "/alternatives", draft, section_key="phil-s02")
    target = options["options"][0]
    assert target["can_swap"]
    assert any("Friday" in note for note in target["preference_notes"])
    next_plan = post(client, headers, "/swap", draft, from_key="phil-s02", to_key="phil-s01")
    before = {s["key"] for s in draft["sections"]}
    after = {s["key"] for s in next_plan["sections"]}
    assert after == before - {"phil-s02"} | {"phil-s01"}
    assert next_plan["rules"] == draft["rules"]
    assert next_plan["version"] == draft["version"] + 1


def test_catalogue_edit_cannot_silently_move_another_or_kept_class(app, client, headers, draft):
    pinned = post(client, headers, "/keep", draft, section_key="psyc-l02", keep=True)
    service = app.extensions["enrolment"]
    section = next(s for s in service.catalogue.sections if s.key == "psyc-l02")
    section.start = "09:30"
    direct = post(client, headers, "/swap", pinned, from_key="phil-s02", to_key="phil-s01")
    assert not direct["changed"] and direct["sections"] == pinned["sections"]
    assert "PSYC 1010 L-02 changed" in " ".join(direct["message"]["steps"])
    service.parser.parse = lambda *args, **kwargs: Intent(
        action="move", move=Move(from_key="phil-s02", to_key="phil-s01")
    )
    ai = post(client, headers, "/adjust", pinned, text="move seminar")
    assert not ai["changed"] and ai["sections"] == pinned["sections"]
    assert "published time or room" in " ".join(ai["message"]["steps"])


def test_kept_classes_persist_and_block_direct_ai_and_undo(app, client, headers, draft):
    moved = post(client, headers, "/swap", draft, from_key="phil-s02", to_key="phil-s01")
    pinned = post(client, headers, "/keep", moved, section_key="phil-s01", keep=True)
    service = app.extensions["enrolment"]
    stored, _ = service.store.get("student-a", pinned["plan_id"])
    assert stored.kept_sections == ["phil-s01"]
    direct = post(client, headers, "/swap", pinned, from_key="phil-s01", to_key="phil-s02")
    assert not direct["changed"] and "kept" in " ".join(direct["message"]["steps"])
    service.parser.parse = lambda *args, **kwargs: Intent(
        action="move", move=Move(from_key="phil-s01", to_key="phil-s02")
    )
    ai = post(client, headers, "/adjust", pinned, text="move seminar")
    assert not ai["changed"] and ai["sections"] == pinned["sections"]
    # Undo after another change must retain the kept seminar, including restored JSON.
    other = post(client, headers, "/swap", pinned, from_key="writ-w01", to_key="writ-w03")
    service.parser.parse = lambda *args, **kwargs: Intent(action="undo")
    undone = post(client, headers, "/adjust", other, text="undo")
    assert undone["kept_sections"] == ["phil-s01"]
    assert "phil-s01" in {s["key"] for s in undone["sections"]}
    released = post(client, headers, "/keep", undone, section_key="phil-s01", keep=False)
    swapped = post(client, headers, "/swap", released, from_key="phil-s01", to_key="phil-s02")
    assert swapped["changed"] and not swapped["kept_sections"]


@pytest.mark.parametrize("capacity,phrase", [(0, "full"), (12, "closed")])
def test_availability_rechecked_after_preview(app, client, headers, draft, capacity, phrase):
    assert post(client, headers, "/alternatives", draft, section_key="phil-s02")["options"][0][
        "can_swap"
    ]
    target = next(s for s in app.extensions["enrolment"].catalogue.sections if s.key == "phil-s01")
    target.selectable = False
    target.remaining_seats = capacity
    result = post(client, headers, "/swap", draft, from_key="phil-s02", to_key="phil-s01")
    assert not result["changed"]
    assert phrase in " ".join(result["message"]["steps"])
    assert result["sections"] == draft["sections"]


def test_failure_names_full_option_clashing_lab_and_available_adjustment(
    app, client, headers, draft
):
    service = app.extensions["enrolment"]
    source = next(s for s in service.catalogue.sections if s.key == "phil-s01")
    source.selectable = False
    source.remaining_seats = 0
    service.catalogue.sections.append(
        source.model_copy(
            update={
                "key": "phil-clash",
                "section": "S-03",
                "day": 4,
                "start": "11:00",
                "end": "12:00",
                "selectable": True,
                "remaining_seats": 8,
            }
        )
    )
    service.parser.parse = lambda *args, **kwargs: Intent(
        action="alternatives",
        changes=[
            SectionChange(from_key="phil-s02", direction="different", source="another seminar")
        ],
    )
    result = post(client, headers, "/adjust", draft, text="another seminar")
    assert not result["changed"]
    reasons = " ".join(result["message"]["steps"])
    assert "full" in reasons and "Clashes with BIOL 1020" in reasons
    assert "WRIT 1000" in result["message"]["note"]
    options = post(client, headers, "/alternatives", draft, section_key="phil-s02")
    assert not any(o["can_swap"] for o in options["options"])


@pytest.mark.parametrize(
    "route,values",
    [
        ("/alternatives", {"section_key": "phil-s02"}),
        ("/keep", {"section_key": "phil-s02", "keep": True}),
        ("/swap", {"from_key": "phil-s02", "to_key": "phil-s01"}),
    ],
)
def test_class_controls_reject_foreign_stale_and_confirmed_plans(
    client, headers, draft, route, values
):
    payload = {"plan_id": draft["plan_id"], **values}
    assert (
        client.post(route, headers={**headers, "X-User-Id": "other"}, json=payload).status_code
        == 404
    )
    pinned = post(client, headers, "/keep", draft, section_key="psyc-l02", keep=True)
    assert client.post(route, headers=headers, json=payload).status_code == 409
    post(client, headers, "/confirm", pinned)
    assert (
        client.post(
            route, headers=headers, json={**payload, "plan_id": pinned["plan_id"]}
        ).status_code
        == 409
    )
