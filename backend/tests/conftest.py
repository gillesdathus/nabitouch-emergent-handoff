import re

import pytest
import requests

from session_ready import ensure_session_ready

_TRANSITION = re.compile(r"/api/appointments/([^/]+)/transition$")
_original = requests.sessions.Session.request


def _request(self, method, url, *args, **kwargs):
    match = _TRANSITION.search(str(url))
    body = kwargs.get("json") or {}
    if method.upper() == "POST" and match and body.get("to") == "in_session" and not body.get("_noAutoConsent"):
        ensure_session_ready(match.group(1))
    return _original(self, method, url, *args, **kwargs)


@pytest.fixture(autouse=True)
def legacy_session_consent(request):
    """Legacy lifecycle tests predate session consent; consent-specific tests opt out with the `real_consent` marker."""
    if request.node.get_closest_marker("real_consent"):
        yield
        return
    requests.sessions.Session.request = _request
    yield
    requests.sessions.Session.request = _original


def pytest_configure(config):
    config.addinivalue_line("markers", "real_consent: exercise the real intake/consent gate (no auto-consent shim)")
