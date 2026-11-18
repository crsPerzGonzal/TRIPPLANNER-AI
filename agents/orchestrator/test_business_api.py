import io
import json
import unittest
from urllib.error import HTTPError, URLError
from unittest.mock import patch

from business_api import BusinessApiError, call_business_api


class CallBusinessApiTests(unittest.TestCase):
    @patch("business_api.urlopen")
    def test_sends_id_token_and_returns_json(self, urlopen):
        response = unittest.mock.Mock()
        response.read.return_value = b'{"trip":{"tripId":"trip-1"}}'
        urlopen.return_value.__enter__.return_value = response

        result = call_business_api(
            "https://api.example.com/prod/",
            "/trips",
            "POST",
            "cognito-id-token",
            {"destination": "Cartagena"},
        )

        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.example.com/prod/trips")
        self.assertEqual(request.get_header("Authorization"), "cognito-id-token")
        self.assertEqual(json.loads(request.data), {"destination": "Cartagena"})
        self.assertEqual(result, {"trip": {"tripId": "trip-1"}})
        urlopen.assert_called_once_with(request, timeout=10)

    @patch("business_api.urlopen")
    def test_surfaces_api_gateway_errors(self, urlopen):
        body = json.dumps(
            {"error": {"code": "TRIP_NOT_FOUND", "message": "No se encontró el viaje."}}
        ).encode()
        urlopen.side_effect = HTTPError(
            "https://api.example.com/prod/trips/missing",
            404,
            "Not Found",
            None,
            io.BytesIO(body),
        )

        with self.assertRaises(BusinessApiError) as context:
            call_business_api(
                "https://api.example.com/prod",
                "/trips/missing",
                "GET",
                "cognito-id-token",
            )

        self.assertEqual(context.exception.status_code, 404)
        self.assertEqual(context.exception.code, "TRIP_NOT_FOUND")

    @patch("business_api.urlopen")
    def test_rejects_non_object_error_response(self, urlopen):
        urlopen.side_effect = HTTPError(
            "https://api.example.com/prod/trips",
            400,
            "Bad Request",
            None,
            io.BytesIO(b"[]"),
        )

        with self.assertRaises(BusinessApiError) as context:
            call_business_api(
                "https://api.example.com/prod",
                "/trips",
                "GET",
                "cognito-id-token",
            )

        self.assertEqual(context.exception.code, "INVALID_ERROR_RESPONSE")

    @patch("business_api.urlopen", side_effect=URLError("offline"))
    def test_reports_network_failure(self, urlopen):
        with self.assertRaises(BusinessApiError) as context:
            call_business_api(
                "https://api.example.com/prod",
                "/trips",
                "GET",
                "cognito-id-token",
            )

        self.assertEqual(context.exception.code, "BUSINESS_API_UNAVAILABLE")

    @patch("business_api.urlopen")
    def test_rejects_missing_api_url_or_id_token(self, urlopen):
        for api_url, token, code in (
            ("", "cognito-id-token", "BUSINESS_API_NOT_CONFIGURED"),
            ("https://api.example.com/prod", "", "BUSINESS_API_TOKEN_MISSING"),
        ):
            with self.subTest(code=code), self.assertRaises(BusinessApiError) as context:
                call_business_api(api_url, "/trips", "GET", token)
            self.assertEqual(context.exception.code, code)
        urlopen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
