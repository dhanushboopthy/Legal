class AppError(Exception):
    """Base class for application errors that map to a specific HTTP status."""

    status_code = 500
    detail = "Internal server error"

    def __init__(self, detail: str | None = None):
        self.detail = detail or self.detail
        super().__init__(self.detail)


class NotFoundError(AppError):
    status_code = 404
    detail = "Resource not found"


class ForbiddenError(AppError):
    status_code = 403
    detail = "You do not have permission to perform this action"


class UnauthorizedError(AppError):
    status_code = 401
    detail = "Not authenticated"


class ConflictError(AppError):
    status_code = 409
    detail = "Request conflicts with the current state of the resource"


class PaymentRequiredError(AppError):
    status_code = 402
    detail = "Payment required before this action can proceed"


class ValidationAppError(AppError):
    status_code = 422
    detail = "Invalid request"
