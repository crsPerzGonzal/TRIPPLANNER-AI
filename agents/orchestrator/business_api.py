import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class BusinessApiError(Exception):
    def __init__(self, status_code: int | None, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def call_business_api(
    api_base_url: str,
    path: str,
    method: str,
    id_token: str,
    payload: dict | None = None,
) -> dict:
    if not api_base_url:
        raise BusinessApiError(
            None,
            "BUSINESS_API_NOT_CONFIGURED",
            "La API de negocio no está configurada en el runtime.",
        )
    if not isinstance(id_token, str) or not id_token:
        raise BusinessApiError(
            None,
            "BUSINESS_API_TOKEN_MISSING",
            "No se recibió el token de Cognito para la operación de negocio.",
        )

    url = f"{api_base_url.rstrip('/')}/{path.lstrip('/')}"
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Accept": "application/json", "Authorization": id_token}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, data=body, headers=headers, method=method)

    try:
        with urlopen(request, timeout=10) as response:
            response_body = response.read().decode("utf-8")
    except HTTPError as exc:
        try:
            error_payload = json.loads(exc.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as parse_error:
            raise BusinessApiError(
                exc.code,
                "INVALID_ERROR_RESPONSE",
                "La API de negocio devolvió un error con formato no válido.",
            ) from parse_error

        if not isinstance(error_payload, dict):
            raise BusinessApiError(
                exc.code,
                "INVALID_ERROR_RESPONSE",
                "La API de negocio devolvió un error con formato no válido.",
            ) from exc
        error = error_payload.get("error")
        if not isinstance(error, dict):
            raise BusinessApiError(
                exc.code,
                "BUSINESS_API_ERROR",
                "La API de negocio rechazó la operación.",
            ) from exc
        raise BusinessApiError(
            exc.code,
            str(error.get("code") or "BUSINESS_API_ERROR"),
            str(error.get("message") or "La API de negocio rechazó la operación."),
        ) from exc
    except URLError as exc:
        raise BusinessApiError(
            None,
            "BUSINESS_API_UNAVAILABLE",
            "No fue posible comunicarse con la API de negocio.",
        ) from exc

    try:
        result = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise BusinessApiError(
            None,
            "INVALID_API_RESPONSE",
            "La API de negocio devolvió una respuesta que no es JSON.",
        ) from exc
    if not isinstance(result, dict):
        raise BusinessApiError(
            None,
            "INVALID_API_RESPONSE",
            "La API de negocio devolvió un objeto JSON no válido.",
        )
    return result
