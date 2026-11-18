import base64
import binascii
import json
from collections.abc import Mapping


def get_request_header(
    request_headers: object,
    request: object,
    header_name: str,
) -> object:
    target = header_name.lower()
    candidates = (
        request_headers,
        getattr(request, "headers", None),
    )
    for headers in candidates:
        if not isinstance(headers, Mapping):
            continue
        for name, value in headers.items():
            if isinstance(name, str) and name.lower() == target:
                return value
    return None


def get_authorization_header(request_headers: object, request: object = None) -> object:
    return get_request_header(request_headers, request, "Authorization")


def get_actor_id(authorization_header: object) -> str:
    if not isinstance(authorization_header, str):
        raise ValueError("No se pudo identificar al usuario autenticado.")

    scheme, separator, token = authorization_header.partition(" ")
    parts = token.split(".") if separator and scheme.lower() == "bearer" else []
    if len(parts) != 3:
        raise ValueError("El token de Cognito no tiene un formato JWT válido.")

    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise ValueError("No se pudieron leer los claims del token de Cognito.") from exc

    # El autorizador JWT de AgentCore valida la firma y expiración antes de entregar la solicitud.
    if not isinstance(claims, dict):
        raise ValueError("El token de Cognito no contiene claims válidos.")

    actor_id = claims.get("sub")
    if claims.get("token_use") != "access" or not isinstance(actor_id, str) or not actor_id:
        raise ValueError("El token de Cognito no contiene una identidad de acceso válida.")

    return actor_id
