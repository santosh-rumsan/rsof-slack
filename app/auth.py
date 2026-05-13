import base64
import json
import time
from typing import Optional

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

# ---------------------------------------------------------------------------
# API Key
# ---------------------------------------------------------------------------

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: Optional[str] = Security(_api_key_header)) -> str:
    if not api_key or api_key != settings.api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )
    return api_key


# ---------------------------------------------------------------------------
# JWT (RS256, verify-only)
# ---------------------------------------------------------------------------

_bearer = HTTPBearer(auto_error=False)


def _b64url_decode(s: str) -> bytes:
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


def _verify_jwt(token: str) -> Optional[dict]:
    """Verify an RS256 JWT using the configured public key PEM.
    Returns the payload dict on success, None on failure."""
    if not settings.jwt_public_key_pem:
        return None
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None

        header = json.loads(_b64url_decode(parts[0]))
        if header.get("alg") != "RS256":
            return None

        payload = json.loads(_b64url_decode(parts[1]))
        signature = _b64url_decode(parts[2])
        message = f"{parts[0]}.{parts[1]}".encode()

        pem = settings.jwt_public_key_pem.replace("\\n", "\n").encode()
        public_key = serialization.load_pem_public_key(pem)
        public_key.verify(signature, message, padding.PKCS1v15(), hashes.SHA256())

        if payload.get("exp", 0) < int(time.time()):
            return None

        return payload
    except Exception:
        return None


async def verify_jwt(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
        )

    payload = _verify_jwt(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )

    if not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing sub claim"
        )

    return payload
