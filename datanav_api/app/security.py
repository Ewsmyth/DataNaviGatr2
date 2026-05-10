from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

"""
Authentication helpers for password hashing and JWT creation/validation.

Routes use these functions instead of touching argon2 or jwt directly, keeping
password and token behavior centralized.
"""

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Hash a plaintext password with Argon2 for storage in Postgres."""
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Return True when a plaintext password matches a stored Argon2 hash."""
    try:
        return password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def _build_token(user_id: str, token_type: str, secret: str, expires_delta: timedelta, roles=None) -> str:
    """Build a signed JWT payload shared by access and refresh tokens."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
    }
    if roles is not None:
        payload["roles"] = sorted(set(roles))
    return jwt.encode(payload, secret, algorithm="HS256")


def create_access_token(user_id: str, secret: str, expires_minutes: int = 15, roles=None) -> str:
    """Create a short-lived Bearer token used for API authorization."""
    return _build_token(
        user_id=user_id,
        token_type="access",
        secret=secret,
        expires_delta=timedelta(minutes=expires_minutes),
        roles=roles,
    )


def create_refresh_token(user_id: str, secret: str, expires_days: int = 7) -> str:
    """Create a longer-lived refresh token stored as an HTTP-only cookie."""
    return _build_token(
        user_id=user_id,
        token_type="refresh",
        secret=secret,
        expires_delta=timedelta(days=expires_days),
    )


def decode_token(token: str, secret: str) -> dict:
    """Decode and validate a JWT, raising jwt exceptions on invalid tokens."""
    return jwt.decode(token, secret, algorithms=["HS256"])
