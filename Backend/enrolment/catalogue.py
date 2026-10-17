import json
from pathlib import Path

from pydantic import Field, model_validator

from .errors import ApiError
from .models import Model, PublishedSection


class Profile(Model):
    approved_courses: list[str] = Field(min_length=1)
    # Only explicitly shared section keys belong here. Demo data is fictional.
    friends: dict[str, list[str]] = Field(default_factory=dict)


class Catalogue(Model):
    term: str = Field(min_length=1)
    demo: bool
    sections: list[PublishedSection] = Field(min_length=1, max_length=1000)
    required_groups: dict[str, list[str]]
    demo_profile: Profile | None = None
    students: dict[str, Profile] = Field(default_factory=dict)

    @model_validator(mode="after")
    def consistent(self):
        keys = {s.key for s in self.sections}
        if len(keys) != len(self.sections):
            raise ValueError("Published section keys must be unique.")
        owners = {}
        for code, groups in self.required_groups.items():
            if not groups or len(set(groups)) != len(groups):
                raise ValueError("Courses need distinct required groups.")
            for group in groups:
                if group in owners:
                    raise ValueError("A required group belongs to only one course.")
                owners[group] = code
                if not any(s.group == group and s.code == code for s in self.sections):
                    raise ValueError("Each required group needs a published section.")
        for section in self.sections:
            if owners.get(section.group) != section.code:
                raise ValueError("A section's group must belong to its course.")
        profiles = list(self.students.values()) + ([self.demo_profile] if self.demo_profile else [])
        for profile in profiles:
            if len(set(profile.approved_courses)) != len(profile.approved_courses):
                raise ValueError("Approved courses cannot repeat.")
            if not set(profile.approved_courses) <= self.required_groups.keys():
                raise ValueError("An approved course is absent from the catalogue.")
            names = [name.strip().casefold() for name in profile.friends]
            if not all(names) or len(names) != len(set(names)):
                raise ValueError("Shared friend names must be nonblank and distinct.")
            for shared in profile.friends.values():
                if len(set(shared)) != len(shared) or not set(shared) <= keys:
                    raise ValueError("Shared timetables must contain unique, published keys.")
        if self.demo and not self.demo_profile:
            raise ValueError("Demo catalogue requires a demo profile.")
        return self

    def profile(self, user_id: str) -> Profile:
        profile = self.students.get(user_id)
        if profile is None and self.demo:
            profile = self.demo_profile
        if profile is None:
            raise ApiError(404, "No approved courses are configured for your account.")
        return self.matching_profile(profile)

    def matching_profile(self, profile: Profile) -> Profile:
        # Friends may take other courses. Only eligible published classes can match.
        eligible = {s.key for s in self.available(profile)}
        return profile.model_copy(
            update={
                "friends": {
                    name: [key for key in keys if key in eligible]
                    for name, keys in profile.friends.items()
                }
            }
        )

    def available(self, profile: Profile) -> list[PublishedSection]:
        return [s for s in self.sections if s.code in profile.approved_courses]

    @classmethod
    def load(cls, path: str):
        return cls.model_validate(json.loads(Path(path).read_text(encoding="utf-8")))
