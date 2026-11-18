"""Authorize Alice Flights once and store its refresh token in AWS Secrets Manager."""

import argparse
import base64
import hashlib
import json
import os
import secrets
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

import boto3
from botocore.exceptions import ClientError

AUTHORIZATION_SERVER = "https://mcp.alice.co.il"
RESOURCE = "https://mcp.alice.co.il/mcp"
SECRET_NAME = "tripplanner/alice-flights/oauth"
REDIRECT_URI = "http://127.0.0.1:8765/callback"
SCOPE = "flights.search offline_access"


def _request_json(url: str, *, data: dict | None = None) -> dict:
    headers = {"Accept": "application/json"}
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, data=body, headers=headers)
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read())
    except HTTPError as exc:
        raise RuntimeError(f"El servidor OAuth respondio HTTP {exc.code}.") from None
    except URLError:
        raise RuntimeError("No se pudo conectar con el servidor OAuth de Alice.") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise RuntimeError("El servidor OAuth de Alice devolvio una respuesta invalida.") from None
    if not isinstance(result, dict):
        raise RuntimeError("El servidor OAuth de Alice devolvio una respuesta invalida.")
    return result


def _is_alice_https_endpoint(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and parsed.hostname == "mcp.alice.co.il"


def _wait_for_callback(expected_state: str) -> str:
    callback: dict[str, str] = {}

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            values = parse_qs(urlparse(self.path).query)
            if values.get("state", [""])[0] != expected_state:
                callback["error"] = "El parametro state no coincide."
            elif values.get("error"):
                callback["error"] = values["error"][0]
            else:
                callback["code"] = values.get("code", [""])[0]
            self.send_response(200 if "code" in callback else 400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                b"<html><body>Autorizacion recibida. Puedes cerrar esta ventana.</body></html>"
            )

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = HTTPServer(("127.0.0.1", 8765), CallbackHandler)
    server.timeout = 300
    try:
        server.handle_request()
    finally:
        server.server_close()
    if "error" in callback:
        raise RuntimeError(f"El consentimiento OAuth no se completo: {callback['error']}")
    if not callback.get("code"):
        raise RuntimeError("No se recibio una respuesta OAuth en cinco minutos.")
    return callback["code"]


def _exchange_code(
    token_url: str,
    client_id: str,
    code: str,
    verifier: str,
    client_secret: str | None,
) -> dict:
    form = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
        "resource": RESOURCE,
    }
    if client_secret:
        form["client_secret"] = client_secret
    request = Request(
        token_url,
        data=urlencode(form).encode("ascii"),
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read())
    except HTTPError as exc:
        raise RuntimeError(f"Alice rechazo el intercambio OAuth (HTTP {exc.code}).") from None
    except URLError:
        raise RuntimeError("No se pudo conectar con el endpoint de tokens de Alice.") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise RuntimeError("El endpoint de tokens de Alice devolvio una respuesta invalida.") from None
    if not isinstance(result, dict):
        raise RuntimeError("El endpoint de tokens de Alice devolvio una respuesta invalida.")
    if not isinstance(result.get("refresh_token"), str) or not result["refresh_token"]:
        raise RuntimeError("Alice no devolvio un refresh_token; no se guardo ningun secreto.")
    return result


def _store_secret(secret_data: dict, region: str) -> None:
    client = boto3.client("secretsmanager", region_name=region)
    secret_string = json.dumps(secret_data)
    try:
        client.describe_secret(SecretId=SECRET_NAME)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "ResourceNotFoundException":
            raise RuntimeError("No se pudo consultar el secreto OAuth en Secrets Manager.") from None
        try:
            client.create_secret(
                Name=SECRET_NAME,
                Description="OAuth refresh token for the TripPlanner Alice Flights MCP client",
                SecretString=secret_string,
            )
        except ClientError:
            raise RuntimeError("No se pudo crear el secreto OAuth en Secrets Manager.") from None
    else:
        try:
            client.put_secret_value(SecretId=SECRET_NAME, SecretString=secret_string)
        except ClientError:
            raise RuntimeError("No se pudo actualizar el secreto OAuth en Secrets Manager.") from None


def authorize(region: str) -> None:
    metadata = _request_json(f"{AUTHORIZATION_SERVER}/.well-known/oauth-authorization-server")
    registration_url = metadata.get("registration_endpoint")
    authorization_url = metadata.get("authorization_endpoint")
    token_url = metadata.get("token_endpoint")
    if not all(isinstance(value, str) for value in (registration_url, authorization_url, token_url)):
        raise RuntimeError("La metadata OAuth de Alice no contiene los endpoints requeridos.")
    if not all(
        _is_alice_https_endpoint(endpoint)
        for endpoint in (registration_url, authorization_url, token_url)
    ):
        raise RuntimeError("Los endpoints OAuth deben pertenecer a Alice y usar HTTPS.")

    registration = _request_json(
        registration_url,
        data={
            "client_name": "TripPlanner AI Flights Agent",
            "redirect_uris": [REDIRECT_URI],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "scope": SCOPE,
            "token_endpoint_auth_method": "none",
        },
    )
    client_id = registration.get("client_id")
    client_secret = registration.get("client_secret")
    if not isinstance(client_id, str) or not client_id:
        raise RuntimeError("Alice no registro un client_id OAuth utilizable.")
    if registration.get("token_endpoint_auth_method") not in (None, "none") and not client_secret:
        raise RuntimeError("El registro de Alice requiere un metodo de autenticacion no disponible.")

    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode("ascii").rstrip("=")
    state = secrets.token_urlsafe(32)
    query = urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "scope": SCOPE,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "resource": RESOURCE,
        }
    )
    print("Abre esta URL en el navegador y acepta el consentimiento de Alice:")
    print(f"{authorization_url}?{query}")
    print("El retorno local solo escucha en 127.0.0.1:8765 y espera hasta cinco minutos.")
    code = _wait_for_callback(state)
    token_response = _exchange_code(token_url, client_id, code, verifier, client_secret)

    secret_data = {
        "client_id": client_id,
        "refresh_token": token_response["refresh_token"],
        "scope": SCOPE,
    }
    if isinstance(client_secret, str) and client_secret:
        secret_data["client_secret"] = client_secret
    _store_secret(secret_data, region)
    print(f"Autorizacion completada y secreto guardado en {SECRET_NAME}.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    args = parser.parse_args()
    authorize(args.region)


if __name__ == "__main__":
    main()
