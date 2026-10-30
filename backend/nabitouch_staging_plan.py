"""Compatibility shim — production-directed plan is the source of truth.

Kept so earlier Checkpoint E prep imports continue to resolve.
"""
from nabitouch_production_plan import *  # noqa: F401,F403
from nabitouch_production_plan import (
    COLLECTIONS_MODIFIED_BY_IMPORT,
    COLLECTIONS_NOT_TOUCHED,
    build_checkpoint_e_prep_report,
)

__all__ = [
    "COLLECTIONS_MODIFIED_BY_IMPORT",
    "COLLECTIONS_NOT_TOUCHED",
    "build_checkpoint_e_prep_report",
]
