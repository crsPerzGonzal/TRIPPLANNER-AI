import asyncio
import json
import unittest

import httpx2

from alice_auth import AliceOAuthAuth


class FakeSecretsClient:
    def __init__(self, secret: dict) -> None:
        self.secret = secret
        self.writes = []

    def get_secret_value(self, SecretId: str) -> dict:
        return {"SecretString": json.dumps(self.secret)}

    def put_secret_value(self, SecretId: str, SecretString: str) -> dict:
        self.secret = json.loads(SecretString)
        self.writes.append(self.secret.copy())
        return {}


class AliceOAuthAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.secret = {
            "client_id": "public-client-id",
            "refresh_token": "refresh-token",
        }
        self.secrets = FakeSecretsClient(self.secret.copy())

    def test_refreshes_access_token_and_persists_rotation(self) -> None:
        requested = []

        def request_token(form: dict) -> dict:
            requested.append(form)
            return {
                "access_token": "new-access-token",
                "refresh_token": "rotated-refresh-token",
                "expires_in": 3600,
            }

        auth = AliceOAuthAuth(
            "test-secret",
            secrets_client=self.secrets,
            token_requester=request_token,
            clock=lambda: 1000,
        )

        self.assertEqual(auth._get_access_token(False), "new-access-token")
        self.assertEqual(requested[0]["grant_type"], "refresh_token")
        self.assertEqual(requested[0]["refresh_token"], "refresh-token")
        self.assertEqual(requested[0]["resource"], "https://mcp.alice.co.il/mcp")
        self.assertEqual(self.secrets.secret["refresh_token"], "rotated-refresh-token")
        self.assertEqual(len(self.secrets.writes), 1)

    def test_reuses_unexpired_access_token_without_refresh(self) -> None:
        auth = AliceOAuthAuth(
            "test-secret",
            secrets_client=self.secrets,
            token_requester=lambda _form: {
                "access_token": "cached-access-token",
                "expires_in": 3600,
            },
            clock=lambda: 1000,
        )

        self.assertEqual(auth._get_access_token(False), "cached-access-token")
        self.assertEqual(auth._get_access_token(False), "cached-access-token")
        self.assertEqual(self.secrets.writes, [])

    def test_rejects_missing_refresh_token(self) -> None:
        self.secrets.secret = {"client_id": "public-client-id"}
        auth = AliceOAuthAuth(
            "test-secret",
            secrets_client=self.secrets,
            token_requester=lambda _form: {},
        )

        with self.assertRaisesRegex(RuntimeError, "client_id y refresh_token"):
            auth._get_access_token(False)

    def test_auth_flow_refreshes_once_after_unauthorized_response(self) -> None:
        tokens = iter(["initial-access-token", "refreshed-access-token"])
        auth = AliceOAuthAuth(
            "test-secret",
            secrets_client=self.secrets,
            token_requester=lambda _form: {
                "access_token": next(tokens),
                "expires_in": 3600,
            },
            clock=lambda: 1000,
        )
        request = httpx2.Request("POST", "https://mcp.alice.co.il/mcp")
        flow = auth.async_auth_flow(request)

        async def exercise_flow() -> None:
            first_request = await flow.__anext__()
            self.assertEqual(
                first_request.headers["Authorization"],
                "Bearer initial-access-token",
            )
            retry_request = await flow.asend(
                httpx2.Response(401, request=first_request)
            )
            self.assertEqual(
                retry_request.headers["Authorization"],
                "Bearer refreshed-access-token",
            )
            with self.assertRaises(StopAsyncIteration):
                await flow.asend(httpx2.Response(200, request=retry_request))

        asyncio.run(exercise_flow())


if __name__ == "__main__":
    unittest.main()
