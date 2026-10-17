import json
from types import SimpleNamespace

import httpx
import pytest
from openai import APITimeoutError, AuthenticationError, RateLimitError

from enrolment.ai import DeepSeekParser
from enrolment.errors import ApiError


class FakeCompletions:
    def __init__(self, content, finish="stop", error=None):
        self.content, self.finish, self.error = content, finish, error
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    finish_reason=self.finish, message=SimpleNamespace(content=self.content)
                )
            ]
        )


def parser(content, *, finish="stop", error=None):
    fake = FakeCompletions(content, finish, error)
    instance = DeepSeekParser(
        {"DEEPSEEK_MODEL": "deepseek-flash"},
        client=SimpleNamespace(chat=SimpleNamespace(completions=fake)),
    )
    return instance, fake


def test_deepseek_request_and_validated_json():
    instance, fake = parser(
        json.dumps(
            {
                "action": "rules",
                "rules": [{"kind": "earliest", "value": 600, "source": "No classes before 10"}],
            }
        )
    )
    result = instance.parse("No classes before 10", context={"sections": []})
    assert result.rules[0].value == 600
    request = fake.calls[0]
    assert request["model"] == "deepseek-flash"
    assert request["response_format"] == {"type": "json_object"}
    assert request["extra_body"] == {"thinking": {"type": "disabled"}}
    assert "api_key" not in json.dumps(request)


@pytest.mark.parametrize(
    "content",
    [
        "",
        "not JSON",
        "{}",
        '{"action":"rules","rules":[{"kind":"earliest","value":600,"source":"invented"}]}',
        '{"action":"rules","rules":[{"kind":"dayoff","value":8,"source":"Friday"}]}',
        '{"action":"rules","rules":[],"sql":"DROP TABLE plans"}',
        '{"action":"undo"}',
    ],
)
def test_malformed_or_ungrounded_ai_output_rejected(content):
    instance, _ = parser(content)
    with pytest.raises(ApiError) as error:
        instance.parse("Friday", context={})
    assert error.value.status == 502


def test_truncated_output_and_missing_key():
    instance, _ = parser('{"action":"unsupported"}', finish="length")
    with pytest.raises(ApiError, match="invalid interpretation"):
        instance.parse("hello", context={})
    with pytest.raises(ApiError) as error:
        DeepSeekParser({"DEEPSEEK_API_KEY": ""}).parse("hello", context={})
    assert error.value.status == 503


def test_case_only_source_errors_return_the_original_exact_excerpt():
    instance, _ = parser(
        json.dumps(
            {
                "action": "rules",
                "rules": [{"kind": "dayoff", "value": 5, "source": "keep Fridays free"}],
            }
        )
    )
    result = instance.parse("Keep Fridays free.", context={})
    assert result.rules[0].source == "Keep Fridays free"


def test_global_deadline_expansion_does_not_inflate_the_score():
    rules = [
        {"kind": "latest_day", "value": f"{day}@930", "source": "Finish by 15:30 every day"}
        for day in range(1, 6)
    ]
    instance, _ = parser(json.dumps({"action": "rules", "rules": rules}))
    result = instance.parse("Finish by 15:30 every day", context={})
    assert [(r.kind, r.value) for r in result.rules] == [("latest", 930)]


def test_unknown_removal_is_rejected():
    instance, _ = parser(
        json.dumps(
            {"action": "rules", "remove_rules": [{"rule_id": "invented", "source": "remove it"}]}
        )
    )
    with pytest.raises(ApiError):
        instance.parse("remove it", context={})


def test_weekday_limit_remains_scoped_to_the_day():
    text = "Only on Thursday, no classes before 11:00."
    instance, _ = parser(
        json.dumps(
            {
                "action": "rules",
                "rules": [{"kind": "earliest_day", "value": "4@660", "source": text}],
            }
        )
    )
    result = instance.parse(text, context={})
    assert result.rules[0].kind == "earliest_day" and result.rules[0].value == "4@660"


@pytest.mark.parametrize("kind,status", [("timeout", 504), ("rate", 503), ("auth", 502)])
def test_provider_errors_are_readable_without_leaking_secrets(kind, status):
    request = httpx.Request("POST", "https://api.deepseek.com/chat/completions")
    response = httpx.Response(429 if kind == "rate" else 401, request=request)
    error = (
        APITimeoutError(request=request)
        if kind == "timeout"
        else (RateLimitError if kind == "rate" else AuthenticationError)(
            "secret-provider-detail", response=response, body=None
        )
    )
    instance, _ = parser("", error=error)
    with pytest.raises(ApiError) as caught:
        instance.parse("hello", context={})
    assert caught.value.status == status
    assert "secret-provider-detail" not in caught.value.detail
