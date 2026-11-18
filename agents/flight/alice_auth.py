"""OAuth token refresh for the Alice Flights MCP endpoint."""

import asyncio
import json
import os
import threading
import time
from collections.abc import AsyncGenerator, Callable
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import boto3
import httpx2

ALICE_TOKEN_URL = "https://mcp.alice.co.il/token"
ALICE_RESOURCE = "https://mcp.alice.co.il/mcp"


class AliceOAuthAuth(httpx2.Auth):
    """Adds Alice OAuth access tokens and refreshes them when they expire."""

    def __init__(
        self,
        secret_id: str | None = None,
        *,
        secrets_client: Any | None = None,
        token_requester: Callable[[dict[str, str]], dict[str, Any]] | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.secret_id = secret_id or os.environ.get("ALICE_OAUTH_SECRET_ID")
        if not self.secret_id:
            raise RuntimeError("ALICE_OAUTH_SECRET_ID debe identificar el secreto OAuth de Alice.")
        self._secrets = secrets_client or boto3.client(
            "secretsmanager",
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
        )
        self._token_requester = token_requester or self._request_token
        self._clock = clock
        self._lock = threading.Lock()
        self._secret_data: dict[str, Any] | None = None
        self._access_token: str | None = None
        self._access_token_expiry = 0.0

    async def async_auth_flow(
        self, request: httpx2.Request
    ) -> AsyncGenerator[httpx2.Request, httpx2.Response]:
        token = await asyncio.to_thread(self._get_access_token, False)
        request.headers["Authorization"] = f"Bearer {token}"
        response = yield request
        if response.status_code == 401:
            token = await asyncio.to_thread(self._get_access_token, True)
            request.headers["Authorization"] = f"Bearer {token}"
            yield request

    def _load_secret(self) -> dict[str, Any]:
        if self._secret_data is None:
            response = self._secrets.get_secret_value(SecretId=self.secret_id)
            secret_string = response.get("SecretString")
            if not isinstance(secret_string, str):
                raise RuntimeError("El secreto OAuth de Alice no contiene un SecretString.")
            secret_data = json.loads(secret_string)
            if not isinstance(secret_data, dict):
                raise RuntimeError("El secreto OAuth de Alice debe ser un objeto JSON.")
            if not isinstance(secret_data.get("client_id"), str) or not isinstance(
                secret_data.get("refresh_token"), str
            ):
                raise RuntimeError("El secreto OAuth de Alice no contiene client_id y refresh_token.")
            self._secret_data = secret_data
        return self._secret_data

    def _get_access_token(self, force_refresh: bool) -> str:
        with self._lock:
            if (
                not force_refresh
                and self._access_token
                and self._clock() < self._access_token_expiry - 60
            ):
                return self._access_token

            secret_data = self._load_secret()
            form = {
                "grant_type": "refresh_token",
                "client_id": secret_data["client_id"],
                "refresh_token": secret_data["refresh_token"],
                "resource": ALICE_RESOURCE,
            }
            if secret_data.get("client_secret"):
                form["client_secret"] = secret_data["client_secret"]

            token_response = self._token_requester(form)
            access_token = token_response.get("access_token")
            if not isinstance(access_token, str) or not access_token:
                raise RuntimeError("La renovacion OAuth de Alice no devolvio access_token.")

            expires_in = token_response.get("expires_in", 3600)
            if not isinstance(expires_in, (int, float)) or expires_in <= 0:
                raise RuntimeError("Alice devolvio una duracion OAuth invalida.")

            rotated_refresh_token = token_response.get("refresh_token")
            if rotated_refresh_token is not None:
                if not isinstance(rotated_refresh_token, str) or not rotated_refresh_token:
                    raise RuntimeError("Alice devolvio un refresh_token invalido.")
                if rotated_refresh_token != secret_data["refresh_token"]:
                    secret_data["refresh_token"] = rotated_refresh_token
                    self._secrets.put_secret_value(
                        SecretId=self.secret_id,
                        SecretString=json.dumps(secret_data),
                    )

            self._access_token = access_token
            self._access_token_expiry = self._clock() + float(expires_in)
            return access_token

    @staticmethod
    def _request_token(form: dict[str, str]) -> dict[str, Any]:
        request = Request(
            ALICE_TOKEN_URL,
            data=urlencode(form).encode("ascii"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=15) as response:
                result = json.loads(response.read())
        except HTTPError as exc:
            raise RuntimeError(f"Alice rechazo la renovacion OAuth (HTTP {exc.code}).") from None
        except URLError:
            raise RuntimeError("No se pudo conectar al endpoint OAuth de Alice.") from None
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise RuntimeError("Alice devolvio una respuesta OAuth invalida.") from None
        if not isinstance(result, dict):
            raise RuntimeError("Alice devolvio una respuesta OAuth invalida.")
        return result
