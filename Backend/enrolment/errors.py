class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


class SelfMatchError(ApiError):
    """A matching reference resolved to the authenticated student's own account."""

    def __init__(self, reference_kind: str):
        super().__init__(
            422,
            f"That {reference_kind} belongs to your own account. "
            f"Did you intend a different {reference_kind}?",
        )
