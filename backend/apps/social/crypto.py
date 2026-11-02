import base64
import hashlib

from cryptography.fernet import Fernet
from django.conf import settings


def _fernet():
    key = settings.TOKEN_ENCRYPTION_KEY
    if not key:
        key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest()).decode()
    return Fernet(key.encode())


def encrypt(value):
    return _fernet().encrypt(value.encode()).decode() if value else ""


def decrypt(value):
    return _fernet().decrypt(value.encode()).decode() if value else ""
