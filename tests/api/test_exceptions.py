from aymurai.api.exceptions import (
    ConfigurationError,
    NotFoundError,
    UpstreamServiceError,
)


def test_not_found_error_has_404_status_and_detail():
    exc = NotFoundError(detail="Document not found: abc")
    assert exc.status_code == 404
    assert exc.detail == "Resource not found: Document not found: abc"


def test_configuration_error_has_500_status_and_detail():
    exc = ConfigurationError(detail="TRANSCRIBE_BASE_URL is not configured")
    assert exc.status_code == 500
    assert "TRANSCRIBE_BASE_URL is not configured" in exc.detail


def test_upstream_service_error_has_502_status_and_detail():
    exc = UpstreamServiceError(detail="Transcription service error")
    assert exc.status_code == 502
    assert "Transcription service error" in exc.detail


def test_error_without_detail_falls_back_to_title():
    exc = NotFoundError()
    assert exc.detail == "Resource not found"
