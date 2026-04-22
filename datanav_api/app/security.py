from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def _build_token(user_id: str, token_type: str, secret: str, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def create_access_token(user_id: str, secret: str, expires_minutes: int = 15) -> str:
    return _build_token(
        user_id=user_id,
        token_type="access",
        secret=secret,
        expires_delta=timedelta(minutes=expires_minutes),
    )


def create_refresh_token(user_id: str, secret: str, expires_days: int = 7) -> str:
    return _build_token(
        user_id=user_id,
        token_type="refresh",
        secret=secret,
        expires_delta=timedelta(days=expires_days),
    )


def decode_token(token: str, secret: str) -> dict:
    return jwt.decode(token, secret, algorithms=["HS256"])