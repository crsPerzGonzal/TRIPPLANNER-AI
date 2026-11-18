import base64
import json
import unittest
from types import SimpleNamespace

from identity import get_actor_id, get_authorization_header, get_request_header


def make_token(claims):
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"header.{payload}.signature"


class GetActorIdTests(unittest.TestCase):
    def test_returns_authenticated_subject_from_access_token(self):
        token = make_token({"sub": "user-123", "token_use": "access"})

        self.assertEqual(get_actor_id(f"Bearer {token}"), "user-123")

    def test_rejects_missing_or_malformed_bearer_token(self):
        for header in (None, "Basic token", "Bearer invalid"):
            with self.subTest(header=header), self.assertRaises(ValueError):
                get_actor_id(header)

    def test_rejects_non_access_tokens_and_missing_subject(self):
        for claims in (
            {"sub": "user-123", "token_use": "id"},
            {"token_use": "access"},
        ):
            with self.subTest(claims=claims), self.assertRaises(ValueError):
                get_actor_id(f"Bearer {make_token(claims)}")


class GetAuthorizationHeaderTests(unittest.TestCase):
    def test_finds_authorization_header_case_insensitively(self):
        token = "Bearer access-token"

        for header_name in ("Authorization", "authorization", "AUTHORIZATION"):
            with self.subTest(header_name=header_name):
                self.assertEqual(
                    get_authorization_header({header_name: token}),
                    token,
                )

    def test_returns_none_when_headers_are_missing(self):
        self.assertIsNone(get_authorization_header(None))
        self.assertIsNone(get_authorization_header({"content-type": "application/json"}))

    def test_reads_authorization_from_original_request_when_context_headers_omit_it(self):
        token = "Bearer access-token"
        request = SimpleNamespace(headers={"authorization": token})

        self.assertEqual(get_authorization_header({}, request), token)

    def test_reads_custom_business_token_from_request_headers(self):
        token = "cognito-id-token"

        self.assertEqual(
            get_request_header(
                {"x-tripplanner-business-token": token},
                None,
                "X-TripPlanner-Business-Token",
            ),
            token,
        )


if __name__ == "__main__":
    unittest.main()
