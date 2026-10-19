"""Environment compatibility shims for exchange connectivity.

1. ccxt 4.5.88 passes timeout as a 1-tuple, e.g. timeout=(10.0,), which
   requests>=2.31 rejects. This normalizes it to a float.
2. Routes through the egress proxy when the standard *_proxy env vars exist.
3. Trusts extra CA certificates (e.g. the sandbox egress proxy's MITM CA)
   placed as PEM files in backend/certs/. They are combined with the system
   bundle once and injected as the verify path.
"""
import glob
import os
import tempfile

import requests

_applied = False
_bundle_path: str | None = None


def proxy_dict() -> dict:
    px = (
        os.environ.get("https_proxy")
        or os.environ.get("HTTPS_PROXY")
        or os.environ.get("http_proxy")
        or os.environ.get("HTTP_PROXY")
    )
    if not px:
        return {}
    if "://" not in px:
        px = "http://" + px
    return {"http": px, "https": px}


def ca_bundle_path() -> str | None:
    """Path to a CA bundle = system certs + backend/certs/*.pem, or None."""
    global _bundle_path
    if _bundle_path is not None:
        return _bundle_path
    explicit = os.environ.get("SSL_CA_BUNDLE")
    if explicit and os.path.exists(explicit):
        _bundle_path = explicit
        return _bundle_path
    certs_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "certs"
    )
    extra = sorted(glob.glob(os.path.join(certs_dir, "*.pem")))
    if not extra:
        return None
    system_bundle = "/etc/ssl/certs/ca-certificates.crt"
    out = os.path.join(tempfile.gettempdir(), "ai-crypto-ca-bundle.pem")
    with open(out, "w") as fh:
        if os.path.exists(system_bundle):
            fh.write(open(system_bundle).read())
            fh.write("\n")
        for pem in extra:
            fh.write(open(pem).read())
            fh.write("\n")
    _bundle_path = out
    return _bundle_path


def apply_shims() -> None:
    global _applied
    if _applied:
        return
    bundle = ca_bundle_path()
    _orig_request = requests.Session.request

    def _patched(self, method, url, **kwargs):
        t = kwargs.get("timeout")
        if isinstance(t, tuple) and len(t) == 1:
            kwargs["timeout"] = float(t[0])
        if kwargs.get("verify") is True and bundle:
            kwargs["verify"] = bundle
        return _orig_request(self, method, url, **kwargs)

    requests.Session.request = _patched  # type: ignore[method-assign]
    _applied = True
