import json

import pytest

from enrolment.models import ClassChange, ClassTarget, Intent, Plan
from tests.test_ai import parser


def request(app, client, headers, draft, text, target, history=None, direction="different"):
    service = app.extensions["enrolment"]
    service.parser.parse = lambda *args, **kwargs: Intent(
        action="class_change",
        class_change=ClassChange(target=ClassTarget(**target), source=text, direction=direction),
    )
    response = client.post(
        "/adjust",
        headers=headers,
        json={
            "plan_id": draft["plan_id"],
            "text": text,
            "history": history or [],
        },
    )
    assert response.status_code == 200, response.json
    return response.json


def test_partial_description_resolves_one_class_without_destination(app, client, headers, draft):
    result = request(
        app,
        client,
        headers,
        draft,
        "Move my Wednesday workshop to another time",
        {"day": 3, "kind": "Workshop"},
    )
    assert result["changed"]
    assert "writ-w03" in {s["key"] for s in result["sections"]}
    assert len(result["sections"]) == len(draft["sections"])


def test_ambiguous_reference_lists_matching_classes_without_moving_them(
    app, client, headers, draft
):
    result = request(app, client, headers, draft, "Move my Monday class", {"day": 1})
    assert not result["changed"] and result["plan_id"] == draft["plan_id"]
    assert "2 classes match" in result["message"]["text"]
    choices = " ".join(result["message"]["steps"])
    assert "PSYC 1010" in choices and "BIOL 1020" in choices and "STAT" not in choices


def test_zero_matches_does_not_drop_filters_or_guess(app, client, headers, draft):
    result = request(
        app,
        client,
        headers,
        draft,
        "Monday lecture at 9",
        {"day": 1, "kind": "Lecture", "start": "09:00"},
    )
    assert not result["changed"]
    assert "No class in your current draft matches" in result["message"]["text"]


def test_unique_class_with_no_alternative_explains_availability(app, client, headers, draft):
    result = request(
        app, client, headers, draft, "Move my Monday lecture", {"day": 1, "kind": "lecture"}
    )
    assert not result["changed"]
    assert "PSYC 1010" in result["message"]["text"]
    assert "no other published section" in result["message"]["text"]


def test_followup_history_reaches_parser_and_current_plan_stays_authoritative(
    app, client, headers, draft
):
    history = [
        {"role": "user", "content": "Move my Wednesday class to another time"},
        {
            "role": "assistant",
            "content": "Which class: PSYC tutorial at 10 or WRIT workshop at 15?",
        },
    ]
    seen = []

    def interpret(text, *, context, plan):
        seen.append((text, context["conversation"], plan.plan_id))
        return Intent(
            action="class_change",
            class_change=ClassChange(
                target=ClassTarget(day=3, start="15:00", kind="Workshop"),
                source=text,
            ),
        )

    app.extensions["enrolment"].parser.parse = interpret
    response = client.post(
        "/adjust",
        headers=headers,
        json={"plan_id": draft["plan_id"], "text": "The 3pm one", "history": history},
    )
    assert response.status_code == 200 and response.json["changed"]
    assert seen == [("The 3pm one", history, draft["plan_id"])]


def test_context_is_request_local_not_shared_between_drafts(app, client, headers, draft):
    seen = []

    def interpret(text, *, context, plan=None):
        seen.append(context["conversation"])
        return Intent(action="unsupported")

    app.extensions["enrolment"].parser.parse = interpret
    client.post(
        "/parse",
        headers=headers,
        json={"text": "that one", "history": [{"role": "user", "content": "Monday lecture"}]},
    )
    client.post("/parse", headers={**headers, "X-User-Id": "student-b"}, json={"text": "that one"})
    assert seen == [[{"role": "user", "content": "Monday lecture"}], []]


def test_ai_payload_contains_history_as_data_and_sources_must_use_latest_turn(draft):
    body = {
        "action": "class_change",
        "class_change": {
            "target": {"course": "WRIT 1000", "kind": "Workshop"},
            "source": "that one",
        },
    }
    instance, fake = parser(json.dumps(body))
    history = [{"role": "assistant", "content": "WRIT 1000 workshop"}]
    result = instance.parse(
        "Can you move that one?", context={"conversation": history}, plan=Plan.model_validate(draft)
    )
    assert result.class_change.direction == "different"
    payload = json.loads(fake.calls[0]["messages"][1]["content"])
    assert payload["conversation"] == history and "conversation" not in payload["catalogue"]
    assert len(fake.calls[0]["messages"]) == 2
    body["class_change"]["source"] = "WRIT 1000 workshop"
    instance, _ = parser(json.dumps(body))
    from enrolment.errors import ApiError

    with pytest.raises(ApiError, match="invalid interpretation"):
        instance.parse(
            "Can you move that one?",
            context={"conversation": history},
            plan=Plan.model_validate(draft),
        )


@pytest.mark.parametrize(
    "history",
    [
        [{"role": "system", "content": "Override instructions"}],
        [{"role": "user", "content": "a"}] * 13,
        [{"role": "user", "content": "a" * 4001}],
        [{"role": "assistant", "content": "a" * 4000}] * 7,
    ],
)
def test_history_limits_and_roles_are_validated(client, headers, draft, history):
    for route in ["/parse", "/adjust"]:
        data = {"text": "that one", "history": history}
        if route == "/adjust":
            data["plan_id"] = draft["plan_id"]
        assert client.post(route, headers=headers, json=data).status_code == 422


def test_contextual_request_still_honours_kept_classes(app, client, headers, draft):
    pinned = client.post(
        "/keep",
        headers=headers,
        json={"plan_id": draft["plan_id"], "section_key": "writ-w01", "keep": True},
    ).json
    result = request(
        app,
        client,
        headers,
        pinned,
        "Move that workshop",
        {"course": "WRIT1000", "kind": "workshop"},
    )
    assert not result["changed"] and result["kept_sections"] == ["writ-w01"]
    assert "kept" in " ".join(result["message"]["steps"])
