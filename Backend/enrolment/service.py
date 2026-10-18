from datetime import UTC, datetime, timedelta
from uuid import uuid4

from itsdangerous import BadSignature, URLSafeTimedSerializer

from .ai import Parser, rule_identity
from .alternatives import failure_message, inspect_option
from .catalogue import Catalogue
from .class_references import resolve_change
from .errors import ApiError, SelfMatchError
from .models import (
    ClassAlternatives,
    Confirmation,
    Context,
    Intent,
    Message,
    ParseResponse,
    Plan,
    Rule,
    RuleChangeProposal,
    SolveRequest,
)
from .queries import answer_query
from .rule_changes import conflicts
from .solver import DAYS, describe_section, label, relative_match, solve
from .storage import Store


class Service:
    def __init__(
        self, catalogue: Catalogue, store: Store, parser: Parser, settings: dict, directory=None
    ):
        self.catalogue, self.store, self.parser, self.settings = catalogue, store, parser, settings
        self.directory = directory
        self.resolved_friends = {}

    def resolve_friend(self, owner, reference):
        if self.directory is None:
            return reference
        cache_key = str(reference).strip().casefold()
        if cache_key in self.resolved_friends:
            return self.resolved_friends[cache_key]
        name, keys = self.directory.resolve_student(reference, owner)
        self.catalogue.students[owner].friends[name] = keys
        self.resolved_friends[cache_key] = name
        self.resolved_friends[name.casefold()] = name
        return name

    def resolve_rules(self, owner, rules):
        for rule in rules:
            if rule.kind == "friend":
                rule.value = self.resolve_friend(owner, str(rule.value))
                rule.label = label(rule.kind, rule.value)
        return rules

    def context(self, owner: str, name: str):
        profile = self.catalogue.profile(owner)
        return Context(
            student_name=name,
            term=self.catalogue.term,
            approved_courses=len(profile.approved_courses),
            published_sections=len(self.catalogue.available(profile)),
            friends=list(profile.friends),
            greeting=Message(
                text=f"Hi {name.split()[0]}. Tell me how you'd like your week to look.",
                note="Fictional sample courses; confirmations are stored locally."
                if self.catalogue.demo
                else "Prototype: match by student name or student ID. Saved drafts can be matched by other signed-in students."
                if self.directory
                else None,
            ),
        )

    def interpret(self, owner: str, text: str, plan: Plan | None = None, history=None):
        if plan and self.directory:
            # Hydrate current sharing data without editing rules in a read-only reply.
            for rule in plan.rules:
                if rule.kind == "friend":
                    name = self.resolve_friend(owner, str(rule.value))
                    self.catalogue.students[owner].friends[str(rule.value)] = (
                        self.catalogue.students[owner].friends[name]
                    )
        profile = self.catalogue.profile(owner)
        context = {
            "sections": [
                s.model_dump(exclude={"with_friend", "shared_with", "changed"})
                for s in self.catalogue.available(profile)
            ],
            "shared_friends": profile.friends,
            "student_directory_lookup": self.directory is not None,
            "conversation": [message.model_dump() for message in history or []],
        }
        intent = self.parser.parse(text, context=context, plan=plan)
        if self.directory:
            for rule in intent.rules:
                if rule.kind == "friend":
                    rule.value = self.resolve_friend(owner, str(rule.value))
            if intent.query and intent.query.topic != "student_identity":
                intent.query.friends = [
                    self.resolve_friend(owner, name) for name in intent.query.friends
                ]
        rules = [
            Rule(
                id=f"r-{uuid4().hex}",
                kind=r.kind,
                value=r.value,
                label=label(r.kind, r.value),
                source=r.source,
            )
            for r in intent.rules
        ]
        return intent, rules

    def answer(self, owner, query, plan=None):
        if query.topic == "enrolment" and self.directory:
            keys = self.directory.enrolled_sections(owner)
            sections = [
                s
                for s in self.catalogue.sections
                if s.key in keys
                and (query.day is None or s.day == query.day)
                and (query.course is None or s.code == query.course)
                and (query.section_key is None or s.key == query.section_key)
            ]
            if keys:
                return Message(
                    text="Your confirmed classes in this prototype:"
                    if sections
                    else "No confirmed classes match that question in this prototype.",
                    steps=[
                        f"{describe_section(s)} · {s.room}"
                        for s in sorted(sections, key=lambda s: (s.day, s.start, s.code))
                    ],
                    note="These are prototype bookings, not a university enrolment record.",
                )
        if query.topic == "student_identity":
            if not self.directory:
                return Message(text="Student lookup is unavailable in the sample-file mode.")
            if not query.friends:
                return Message(text="Enter a student name or student ID so I can look them up.")
            students = [
                self.directory.lookup_student(reference)
                for reference in dict.fromkeys(query.friends)
            ]
            lines = list(
                dict.fromkeys(
                    f"Student {student['student_id']} is {student['name']}." for student in students
                )
            )
            text = "\n".join(lines)
            return (
                Message(text=text)
                if len(text) <= 1000
                else Message(text="Here are the students matching your lookup:", steps=lines)
            )
        return answer_query(query, plan, self.catalogue, self.catalogue.profile(owner))

    def parse(self, owner: str, text: str, history=None):
        try:
            intent, rules = self.interpret(owner, text, history=history)
        except SelfMatchError as error:
            return ParseResponse(rules=[], message=Message(text=error.detail))
        if intent.query:
            return ParseResponse(
                rules=[],
                message=self.answer(owner, intent.query),
            )
        return ParseResponse(
            rules=rules,
            ready_to_build=bool(rules) or intent.action == "build",
            message=Message(
                steps=[f"Validated {len(rules)} preferences against supported rule types."]
                if rules
                else [],
                text="Review these preferences before building your timetable."
                if rules
                else "I'll include every required class from your selected courses and avoid clashes. Choose ‘Build my timetable’ to generate a draft; extra preferences are optional."
                if intent.action == "build"
                else "I couldn't identify a checkable timetable preference. Try a time, day off, lunch break or friend match.",
            ),
        )

    def build(self, owner: str, rules: list[Rule]):
        if self.directory:
            rules = self.resolve_rules(owner, [r.model_copy() for r in rules])
            rules = SolveRequest(rules=rules).rules
        profile = self.catalogue.profile(owner)
        if not profile.approved_courses:
            raise ApiError(
                422, "Choose your courses in course onboarding before building a timetable."
            )
        plan = solve(self.catalogue, profile, rules, **self.solver_settings())
        if plan is None:
            raise ApiError(
                422,
                "No available, clash-free combination covers all required classes. Some options may be full or closed; try again after availability changes.",
            )
        self.store.save(owner, plan)
        return plan

    def solver_settings(self):
        return {
            "timeout": self.settings["SOLVER_TIMEOUT_SECONDS"],
            "max_nodes": self.settings["MAX_SOLVER_NODES"],
        }

    @staticmethod
    def unchanged(plan: Plan, text: str):
        return plan.model_copy(update={"changed": False, "message": Message(text=text)})

    def alternatives(self, owner, plan_id, section_key):
        current, _ = self.store.get(owner, plan_id, editable=True)
        if self.directory:
            for rule in current.rules:
                if rule.kind == "friend":
                    name = self.resolve_friend(owner, str(rule.value))
                    self.catalogue.students[owner].friends[str(rule.value)] = (
                        self.catalogue.students[owner].friends[name]
                    )
        profile = self.catalogue.matching_profile(self.catalogue.profile(owner))
        if {s.code for s in current.sections} != set(profile.approved_courses):
            raise ApiError(
                422,
                "Your course selection changed. Start a new timetable for your current courses.",
            )
        published = {s.key: s for s in self.catalogue.available(profile)}
        source = published.get(section_key)
        selected = next((s for s in current.sections if s.key == section_key), None)
        if source is None or selected is None:
            raise ApiError(422, "Choose a published class in your current timetable.")
        return ClassAlternatives(
            plan_id=plan_id,
            current=selected,
            kept=section_key in current.kept_sections,
            options=[
                inspect_option(current, selected, target, profile, published)
                for target in sorted(published.values(), key=lambda s: (s.day, s.start, s.key))
                if target.group == source.group and target.key != source.key
            ],
        )

    def keep(self, owner, plan_id, section_key, keep):
        current, _ = self.store.get(owner, plan_id, editable=True)
        section = next((s for s in current.sections if s.key == section_key), None)
        if section is None:
            raise ApiError(422, "Choose a class in your current timetable.")
        keys = set(current.kept_sections)
        if (section_key in keys) == keep:
            return self.unchanged(current, "This class already has that setting.")
        if keep:
            keys.add(section_key)
        else:
            keys.discard(section_key)
        plan = current.model_copy(
            update={
                "plan_id": f"plan-{uuid4().hex}",
                "version": current.version + 1,
                "changed": True,
                "kept_sections": sorted(keys),
                "sections": [s.model_copy(update={"changed": False}) for s in current.sections],
                "message": Message(
                    text=(
                        f"Keeping {describe_section(section)}. Adjustments will leave this class in place."
                        if keep
                        else f"Released {section.code} {section.section}. Adjustments can move it again."
                    )
                ),
            }
        )
        self.store.save(owner, plan, current.plan_id)
        return plan

    def swap(self, owner, plan_id, from_key, to_key):
        current, _ = self.store.get(owner, plan_id, editable=True)
        options = self.alternatives(owner, plan_id, from_key)
        option = next((o for o in options.options if o.section.key == to_key), None)
        if option is None:
            raise ApiError(422, "Choose an alternative for the same required class.")
        if not option.can_swap:
            available = next((o for o in options.options if o.can_swap), None)
            return current.model_copy(
                update={
                    "changed": False,
                    "message": Message(
                        text="That swap cannot be made. Your draft is unchanged.",
                        steps=option.reasons,
                        note=f"Available instead: {describe_section(available.section)}."
                        if available
                        else "Choose another class or release its Keep setting.",
                    ),
                }
            )
        profile = self.catalogue.profile(owner)
        published = {s.key: s for s in self.catalogue.available(profile)}
        if any(s.key not in published for s in current.sections):
            return self.unchanged(
                current,
                "A current class is no longer published. Build a new timetable with the latest courses.",
            )
        forced = {
            published[s.key].group: to_key if s.key == from_key else s.key for s in current.sections
        }
        plan = solve(
            self.catalogue,
            profile,
            current.rules,
            previous=current,
            forced=forced,
            **self.solver_settings(),
        )
        if plan is None:
            return self.unchanged(
                current,
                "Availability changed: a required class is now full or closed. Refresh the alternatives and try again. Your draft is unchanged.",
            )
        plan.message = Message(
            text=f"Swapped {options.current.code} {options.current.section} to {describe_section(option.section)}. All other classes stayed in place.",
            note=" ".join(option.preference_notes) or None,
        )
        self.store.save(owner, plan, current.plan_id)
        return plan

    def section_preferences(self, current, changes, profile):
        published = {s.key: s for s in self.catalogue.available(profile)}
        selected = {s.key for s in current.sections}
        rules = []
        for change in changes:
            source = published.get(change.from_key)
            if source is None or source.key not in selected:
                raise ApiError(
                    502,
                    "The AI referred to a class outside your current draft. Name the class and try again.",
                )
            kind = f"section_{change.direction}" + ("_same_day" if change.same_day else "")
            description = {
                "earlier": f"before {source.start}",
                "later": f"after {source.start}",
                "other_day": f"off {DAYS[source.day - 1]}",
                "different": f"in an alternative to {source.section}",
            }[change.direction]
            if change.same_day:
                description += f" on {DAYS[source.day - 1]}"
            rule = Rule(
                id=f"r-{uuid4().hex}",
                kind=kind,
                value=source.key,
                label=f"{source.code} {source.kind.lower()} {description}",
                source=change.source,
            )
            if not any(relative_match(kind, source, s) for s in published.values()):
                alternatives = [
                    s for s in published.values() if s.group == source.group and s.key != source.key
                ]
                details = " ".join(
                    f"Published alternative: {describe_section(s)}." for s in alternatives[:3]
                )
                if not details:
                    details = "This required class has no other published section."
                return [], (
                    f"No published option puts your {rule.label}. {details} Your draft is unchanged."
                )
            rules.append(rule)
        return rules, None

    def adjust(self, owner: str, plan_id: str, text: str, history=None):
        current, parent_id = self.store.get(owner, plan_id, editable=True)
        try:
            intent, added = self.interpret(owner, text, current, history=history)
        except SelfMatchError as error:
            return self.unchanged(current, error.detail)
        return self.adjust_intent(owner, current, parent_id, intent, added)

    def proposal_signer(self):
        return URLSafeTimedSerializer(
            self.settings["TIMETABLE_BACKEND_TOKEN"], salt="rule-change-v1"
        )

    def rule_change(self, owner, plan_id, token, accept):
        try:
            proposal = self.proposal_signer().loads(token, max_age=3600)
        except BadSignature as error:
            raise ApiError(
                409, "This rule proposal expired or is invalid. Send your request again."
            ) from error
        if proposal["owner"] != owner or proposal["plan_id"] != plan_id:
            raise ApiError(404, "This rule proposal does not belong to this timetable.")
        current, parent_id = self.store.get(owner, plan_id, editable=True)
        if not accept:
            return self.unchanged(
                current, "Kept your existing rules. The proposed change was not applied."
            )
        if self.directory:
            for rule in current.rules:
                if rule.kind == "friend":
                    name = self.resolve_friend(owner, str(rule.value))
                    self.catalogue.students[owner].friends[str(rule.value)] = (
                        self.catalogue.students[owner].friends[name]
                    )
        added = self.resolve_rules(owner, [Rule.model_validate(r) for r in proposal["added"]])
        return self.adjust_intent(
            owner,
            current,
            parent_id,
            Intent.model_validate(proposal["intent"]),
            added,
            approved=set(proposal["remove_ids"]),
        )

    def adjust_intent(self, owner, current, parent_id, intent, added, approved=None):
        original_intent = intent.model_dump(mode="json")
        original_added = [r.model_dump(mode="json") for r in added]
        profile = self.catalogue.profile(owner)
        if intent.class_change:
            change, question = resolve_change(intent.class_change, current)
            if question:
                return current.model_copy(update={"changed": False, "message": question})
            intent = intent.model_copy(
                update={"action": "alternatives", "class_change": None, "changes": [change]}
            )
        if intent.query:
            return current.model_copy(
                update={
                    "changed": False,
                    "message": self.answer(owner, intent.query, current),
                }
            )
        if intent.action == "unsupported":
            explanations = {
                "ambiguous": "Which class should I move? Reply with its course code, class type, weekday or current start time. I can check other times without a preferred destination. Your draft is unchanged.",
                "course_removal": "This planner keeps every required class in your approved courses, so it cannot drop a course or delete its required seminar. You can ask to move the seminar to another day. Your draft is unchanged.",
                "outside_catalogue": "I can only use the published Monday–Friday sections. Ask for another weekday or a different time; I cannot create a new class time. Your draft is unchanged.",
            }
            return self.unchanged(
                current,
                explanations[intent.reason],
            )
        forced = {}
        rules = list(current.rules)
        removed = []
        if intent.action == "undo":
            if not parent_id:
                return self.unchanged(current, "There is no earlier version to restore.")
            parent, _ = self.store.get(owner, parent_id)
            by_key = {s.key: s for s in self.catalogue.available(profile)}
            if any(s.key not in by_key for s in parent.sections):
                return self.unchanged(
                    current,
                    "The earlier sections are no longer published. Your draft is unchanged.",
                )
            forced = {by_key[s.key].group: s.key for s in parent.sections}
            rules = parent.rules
        else:
            relative, unavailable = self.section_preferences(current, intent.changes, profile)
            if unavailable:
                return self.unchanged(current, unavailable)
            added.extend(relative)
            remove_ids = {r.rule_id for r in intent.remove_rules}
            if not remove_ids <= {r.id for r in current.rules}:
                raise ApiError(
                    502,
                    "The AI proposed removing an unknown preference. Try rephrasing your request.",
                )
            explicit = {r.rule_id for r in intent.remove_rules if r.mode == "explicit"}
            detected = conflicts(
                [r for r in current.rules if r.id not in explicit],
                added,
                {s.key: s for s in self.catalogue.available(profile)},
                profile,
            )
            proposed = (remove_ids - explicit) | set(detected)
            if proposed - (approved or set()):
                removal_ids = explicit | proposed
                token = self.proposal_signer().dumps(
                    {
                        "owner": owner,
                        "plan_id": current.plan_id,
                        "intent": original_intent,
                        "added": original_added,
                        "remove_ids": sorted(removal_ids),
                    }
                )
                reasons = [reason for values in detected.values() for reason in values]
                if proposed - set(detected):
                    reasons.append(
                        "Your request may replace an existing preference. Review the exact changes below."
                    )
                return current.model_copy(
                    update={
                        "changed": False,
                        "message": Message(
                            text="This request would change existing rules. Apply the changes below or keep your existing rules?",
                            note="Your draft is unchanged. Approval applies this request only; kept classes stay protected.",
                            rule_change=RuleChangeProposal(
                                plan_id=current.plan_id,
                                token=token,
                                remove=[r for r in current.rules if r.id in removal_ids],
                                add=added,
                                reasons=reasons,
                            ),
                        ),
                    }
                )
            remove_ids = explicit | proposed | (approved or set())
            removed = [r for r in rules if r.id in remove_ids]
            rules = [r for r in rules if r.id not in remove_ids]
            if intent.move:
                by_key = {s.key: s for s in self.catalogue.available(profile)}
                source, target = by_key.get(intent.move.from_key), by_key.get(intent.move.to_key)
                if (
                    source is None
                    or target is None
                    or source.group != target.group
                    or source.key not in {s.key for s in current.sections}
                ):
                    raise ApiError(
                        502,
                        "The AI proposed an invalid section change. Try rephrasing your request.",
                    )
                forced = {target.group: target.key}
            existing = {rule_identity(r) for r in rules}
            added = [r for r in added if rule_identity(r) not in existing]
            rules.extend(added)
            # Apply the same limits and duplicate checks as /solve.
            rules = SolveRequest(rules=rules).rules
            if not added and not forced and not removed:
                return self.unchanged(
                    current,
                    f"Your draft already includes all {len(current.sections)} required classes without clashes. Your kept classes and preferences are unchanged."
                    if intent.action == "build"
                    else "Those preferences are already in your draft. No classes changed.",
                )
        plan = solve(
            self.catalogue,
            profile,
            rules,
            previous=current,
            forced=forced,
            # Friend matching stays best effort even when adding another friend.
            required_rules=[r for r in added if r.kind != "friend"],
            **self.solver_settings(),
        )
        if plan is None:
            lines, suggestion = failure_message(
                current,
                profile,
                {s.key: s for s in self.catalogue.available(profile)},
                forced,
                [r for r in added if r.kind != "friend"],
            )
            return current.model_copy(
                update={
                    "changed": False,
                    "message": Message(
                        text="No available combination meets that request while keeping every required class and your kept classes. Your draft is unchanged.",
                        steps=lines,
                        note=suggestion,
                    ),
                }
            )
        if {s.key for s in plan.sections} == {
            s.key for s in current.sections
        } and plan.rules == current.rules:
            return self.unchanged(
                current, "Your draft already meets that request. No classes changed."
            )
        note = plan.message.note or ""
        if removed:
            note = f"Removed: {'; '.join(r.label for r in removed)}. {note}".strip()
        if added:
            note = f"Added: {'; '.join(r.label for r in added)}. {note}".strip()
        if intent.action == "undo":
            note = f"Restored the previous draft as version {plan.version}. {note}".strip()
        elif intent.move or intent.changes:
            published = {s.key: s for s in self.catalogue.available(profile)}
            old_by_group = {
                published[s.key].group: s for s in current.sections if s.key in published
            }
            moves = []
            for section in plan.sections:
                old = old_by_group.get(published[section.key].group)
                if old and old.key != section.key:
                    moves.append(
                        f"Moved {section.code} {section.kind.lower()} from {DAYS[old.day - 1]} {old.start}–{old.end} to {DAYS[section.day - 1]} {section.start}–{section.end} ({section.section})."
                    )
            if moves:
                plan.message.text = (
                    " ".join(moves)
                    + f" All {len(plan.sections)} required classes are still included."
                )
        plan.message.note = note or None
        self.store.save(owner, plan, current.plan_id)
        return plan

    def reopen(self, owner, plan_id):
        def make_draft(current):
            return current.model_copy(
                deep=True,
                update={
                    "plan_id": f"plan-{uuid4().hex}",
                    "version": 1,
                    "changed": True,
                    "sections": [s.model_copy(update={"changed": False}) for s in current.sections],
                    "message": Message(
                        text="Created an editable copy of your confirmed timetable. Your existing bookings stay in place until you confirm this revised draft."
                    ),
                },
            )

        return self.store.fork_confirmed(owner, plan_id, make_draft)

    def confirm(self, owner: str, plan_id: str):
        def create(plan):
            now = datetime.now(UTC)
            courses = len({s.code for s in plan.sections})
            return Confirmation(
                reference=f"ENR-{now.year}-{uuid4().hex[:12].upper()}",
                confirmed_at=now.isoformat(),
                courses=courses,
                sections=len(plan.sections),
                credits=plan.summary.credits,
                swap_deadline=(now + timedelta(days=self.settings["SWAP_WINDOW_DAYS"]))
                .date()
                .isoformat(),
                message=Message(
                    steps=["Saved this plan's confirmation in the local database."],
                    text=f"Plan confirmed — {courses} courses, {len(plan.sections)} classes, {plan.summary.credits} credits.",
                    note="This is a local confirmation, not a submission to a university enrolment system.",
                ),
            )

        return self.store.confirm(owner, plan_id, create)
