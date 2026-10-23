"""Reading uploaded files (.txt in any common encoding, .pdf with a text layer)."""
import io


class UnreadableFile(ValueError):
    """The upload cannot be turned into text; the message is shown to the user."""


def decode_text(data: bytes) -> str:
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def pdf_to_text(data: bytes) -> tuple[str, int]:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise UnreadableFile("This PDF is password-protected.")
        pages = [page.extract_text() or "" for page in reader.pages]
    except PdfReadError as err:
        raise UnreadableFile("This file is not a readable PDF.") from err
    return "\n".join(pages), len(pages)


def read_upload(filename: str, data: bytes) -> dict:
    """Return {"text", "pages"} for a .txt or .pdf upload, or raise UnreadableFile."""
    name = (filename or "").lower()
    if not data:
        raise UnreadableFile("The file is empty.")
    if name.endswith(".pdf"):
        text, pages = pdf_to_text(data)
    elif name.endswith(".txt"):
        text, pages = decode_text(data), None
    else:
        raise UnreadableFile("Only .txt and .pdf files are supported.")
    if not text.strip():
        raise UnreadableFile("No text found in this file. Scanned PDFs need OCR first.")
    return {"text": text, "pages": pages}
