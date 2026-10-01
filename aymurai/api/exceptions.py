from fastapi import HTTPException, status


class AymuraiAPIException(HTTPException):
    status_code: int
    title: str

    def __init__(self, status_code: int | None = None, detail: str | None = None):
        self.status_code = status_code or self.status_code
        self.detail = f"{self.title}: {detail}" if detail else self.title
        super().__init__(status_code=self.status_code, detail=self.detail)


class UnsupportedFileType(AymuraiAPIException):
    status_code = status.HTTP_400_BAD_REQUEST
    title = "Unsupported file type"


class NotFoundError(AymuraiAPIException):
    status_code = status.HTTP_404_NOT_FOUND
    title = "Resource not found"


class ConflictError(AymuraiAPIException):
    status_code = status.HTTP_409_CONFLICT
    title = "Resource conflict"


class PreconditionFailedError(AymuraiAPIException):
    status_code = status.HTTP_412_PRECONDITION_FAILED
    title = "Precondition failed"


class ConfigurationError(AymuraiAPIException):
    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    title = "Configuration error"


class UpstreamServiceError(AymuraiAPIException):
    status_code = status.HTTP_502_BAD_GATEWAY
    title = "Upstream service error"
