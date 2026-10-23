"""Country names for the codes used in the UN corpus and in uploaded datasets."""
import re

from .country_names import COUNTRY_NAMES

CODE_PATTERN = re.compile(r"^[A-Z]{2,8}$")

# Fictional countries used only by the demo data (python -m dla seed-demo)
DEMO_NAMES = {"VLD": "Valdoria", "ORS": "Orsinia", "FRD": "Freedonia", "SYL": "Syldavia", "BOR": "Borduria"}


def normalize_code(value) -> str:
    return str(value or "").strip().upper()


def is_valid_code(code: str) -> bool:
    return bool(CODE_PATTERN.match(code))


def country_name(code: str) -> str:
    return COUNTRY_NAMES.get(code) or DEMO_NAMES.get(code, code)
