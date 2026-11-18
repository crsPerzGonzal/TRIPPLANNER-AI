import os

from common.api import _allowed_origins, _request_header


ALLOWED_METHODS = {"GET", "POST", "PATCH", "PUT", "OPTIONS"}
ALLOWED_HEADERS = {"authorization", "content-type"}


def lambda_handler(event, context):
    origin = _request_header(event, "origin")
    requested_method = _request_header(event, "access-control-request-method")
    requested_headers = _request_header(event, "access-control-request-headers") or ""

    headers = {
        "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    }
    if origin not in _allowed_origins():
        return {"statusCode": 403, "headers": headers, "body": ""}

    if requested_method and requested_method.upper() not in ALLOWED_METHODS:
        return {"statusCode": 403, "headers": headers, "body": ""}

    requested = {
        header.strip().lower()
        for header in requested_headers.split(",")
        if header.strip()
    }
    if not requested.issubset(ALLOWED_HEADERS):
        return {"statusCode": 403, "headers": headers, "body": ""}

    headers.update(
        {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": ",".join(sorted(ALLOWED_METHODS)),
            "Access-Control-Allow-Headers": "Authorization,Content-Type",
            "Access-Control-Max-Age": "600",
        }
    )
    return {"statusCode": 204, "headers": headers, "body": ""}
