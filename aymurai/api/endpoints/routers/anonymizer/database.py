from fastapi import Depends
from fastapi.routing import APIRouter
from pydantic import UUID5
from sqlmodel import Session

from aymurai.database.session import get_session
from aymurai.logger import get_logger

logger = get_logger(__name__)


router = APIRouter()


@router.get("/document/list")
async def anonymizer_database_document_list(
    session: Session = Depends(get_session),
):
    pass


@router.get("/document/dump")
async def anonymizer_database_documents_dump(
    session: Session = Depends(get_session),
):
    pass


@router.get("/document/{document_id}")
async def anonymizer_database_document(
    document_id: UUID5,
    session: Session = Depends(get_session),
):
    pass
