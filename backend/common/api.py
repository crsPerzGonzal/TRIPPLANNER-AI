import base64
import json
import logging
import os
from decimal import Decimal


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class ApiError(Exception):
    def __init__(self, status_code, code, message):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def authenticated_user_id(event):
    request_context = event.get("requestContext") or {}
    authorizer = request_context.get("authorizer") or {}
    claims = authorizer.get("claims") or {}
    user_id = claims.get("sub")

    if not isinstance(user_id, str) or not user_id.strip():
        raise ApiError(401, "UNAUTHORIZED", "Se requiere una identidad autenticada.")

    return user_id.strip()


def parse_json_body(event):
    body = event.get("body")
    if body is None:
        raise ApiError(400, "INVALID_BODY", "Se requiere un cuerpo JSON.")
    if event.get("isBase64Encoded"):
        try:
            body = base64.b64decode(body, validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            raise ApiError(400, "INVALID_BODY", "El cuerpo de la solicitud no es válido.")

    try:
        payload = json.loads(body, parse_constant=_reject_json_constant)
    except (TypeError, ValueError, json.JSONDecodeError):
        raise ApiError(400, "INVALID_BODY", "El cuerpo debe contener JSON válido.")

    if not isinstance(payload, dict):
        raise ApiError(400, "INVALID_BODY", "El cuerpo JSON debe ser un objeto.")

    return payload


def respond(status_code, payload, event=None):
    headers = {"Content-Type": "application/json; charset=utf-8"}
    origin = _request_header(event or {}, "origin")
    allowed_origins = _allowed_origins()
    if origin in allowed_origins:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"

    return {
        "statusCode": status_code,
        "headers": headers,
        "body": json.dumps(payload, default=_json_value, separators=(",", ":")),
    }


def _request_header(event, name):
    headers = event.get("headers") or {}
    return next(
        (value for key, value in headers.items() if key.lower() == name.lower()),
        None,
    )


def _allowed_origins():
    return {
        origin.strip()
        for origin in os.environ.get("ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    }


def run(event, operation):
    try:
        user_id = authenticated_user_id(event)
        status_code, payload = operation(event, user_id)
        return respond(status_code, payload, event)
    except ApiError as error:
        return respond(
            error.status_code,
            {"error": {"code": error.code, "message": error.message}},
            event,
        )
    except Exception:
        logger.exception("Error procesando una operación de negocio.")
        return respond(
            500,
            {"error": {"code": "INTERNAL_ERROR", "message": "Ocurrió un error interno."}},
            event,
        )


def _json_value(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError("El valor no se puede serializar como JSON.")


def _reject_json_constant(value):
    raise ValueError(f"El valor {value} no está permitido en JSON.")
