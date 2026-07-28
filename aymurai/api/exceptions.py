from fastapi import HTTPException


class AymuraiAPIException(HTTPException):
    status_code: int
    title: str

    def __init__(self, status_code: int = None, detail: str = None):
        self.status_code = status_code or self.status_code
        self.detail = f"{self.title}: {detail}" if detail else self.title
        super().__init__(status_code=self.status_code, detail=self.detail)


class UnsupportedFileType(AymuraiAPIException):
    status_code = 400
    title = "Unsupported file type"


class NotFoundError(AymuraiAPIException):
    status_code = 404
    title = "Resource not found"


class ConfigurationError(AymuraiAPIException):
    status_code = 500
    title = "Configuration error"


class UpstreamServiceError(AymuraiAPIException):
    status_code = 502
    title = "Upstream service error"
