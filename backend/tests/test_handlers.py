import json
import os
import sys
import unittest
from unittest.mock import patch


BACKEND_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_PATH not in sys.path:
    sys.path.insert(0, BACKEND_PATH)

from lambdas.itineraries import handler as itineraries_handler
from lambdas.reservations import handler as reservations_handler
from lambdas.trips import handler as trips_handler
from common.api import ApiError, respond
from common.validation import validate_reservation_status


USER_ID = "user-123"


def event(method, resource, path_parameters=None, body=None, authenticated=True):
    request_context = {}
    if authenticated:
        request_context["authorizer"] = {"claims": {"sub": USER_ID}}
    return {
        "httpMethod": method,
        "resource": resource,
        "pathParameters": path_parameters,
        "requestContext": request_context,
        "body": None if body is None else json.dumps(body),
    }


def response_body(result):
    return json.loads(result["body"])


class HandlerTests(unittest.TestCase):
    def test_unauthenticated_request_is_rejected_before_table_access(self):
        with patch("lambdas.trips.handler.get_table") as get_table:
            result = trips_handler.lambda_handler(
                event("GET", "/trips", authenticated=False),
                None,
            )

        self.assertEqual(result["statusCode"], 401)
        get_table.assert_not_called()

    def test_api_response_uses_the_configured_cors_origin(self):
        with patch.dict(os.environ, {"ALLOWED_ORIGINS": "http://127.0.0.1:5173"}):
            result = respond(
                200,
                {"ok": True},
                {"headers": {"Origin": "http://127.0.0.1:5173"}},
            )

        self.assertEqual(
            result["headers"]["Access-Control-Allow-Origin"],
            "http://127.0.0.1:5173",
        )

    def test_create_trip_persists_only_authorized_owner_and_returns_generated_id(self):
        payload = {
            "origin": "Bogotá",
            "destination": "Cartagena",
            "startDate": "2026-12-01",
            "endDate": "2026-12-05",
            "travelerCount": 3,
            "budget": {"amount": 5000000, "currency": "COP"},
        }
        table = unittest.mock.Mock()
        with patch("lambdas.trips.handler.get_table", return_value=table):
            result = trips_handler.lambda_handler(event("POST", "/trips", body=payload), None)

        saved = table.put_item.call_args.kwargs["Item"]
        self.assertEqual(result["statusCode"], 201)
        self.assertEqual(saved["PK"], f"USER#{USER_ID}")
        self.assertTrue(saved["tripId"])
        self.assertEqual(saved["destination"], "Cartagena")
        self.assertEqual(response_body(result)["trip"]["tripId"], saved["tripId"])

    def test_invalid_trip_dates_are_rejected_without_writing(self):
        payload = {
            "origin": "Bogotá",
            "destination": "Cartagena",
            "startDate": "2026-12-06",
            "endDate": "2026-12-05",
            "travelerCount": 3,
            "budget": {"amount": 5000000, "currency": "COP"},
        }
        table = unittest.mock.Mock()
        with patch("lambdas.trips.handler.get_table", return_value=table):
            result = trips_handler.lambda_handler(event("POST", "/trips", body=payload), None)

        self.assertEqual(result["statusCode"], 400)
        table.put_item.assert_not_called()

    def test_non_finite_budget_is_rejected(self):
        payload = {
            "origin": "Bogotá",
            "destination": "Cartagena",
            "startDate": "2026-12-01",
            "endDate": "2026-12-05",
            "travelerCount": 3,
            "budget": {"amount": float("nan"), "currency": "COP"},
        }
        table = unittest.mock.Mock()
        with patch("lambdas.trips.handler.get_table", return_value=table):
            result = trips_handler.lambda_handler(event("POST", "/trips", body=payload), None)

        self.assertEqual(result["statusCode"], 400)
        table.put_item.assert_not_called()

    def test_itinerary_requires_trip_owned_by_user(self):
        table = unittest.mock.Mock()
        table.get_item.return_value = {}
        with patch("lambdas.itineraries.handler.get_table", return_value=table):
            result = itineraries_handler.lambda_handler(
                event(
                    "PUT",
                    "/trips/{tripId}/itinerary",
                    {"tripId": "trip-1"},
                    {"days": []},
                ),
                None,
            )

        self.assertEqual(result["statusCode"], 404)
        table.put_item.assert_not_called()

    def test_itinerary_day_must_fall_within_trip_dates(self):
        table = unittest.mock.Mock()
        table.get_item.side_effect = [
            {"Item": {"tripId": "trip-1", "startDate": "2026-12-01", "endDate": "2026-12-03"}},
            {"Item": None},
        ]
        with patch("lambdas.itineraries.handler.get_table", return_value=table):
            result = itineraries_handler.lambda_handler(
                event(
                    "PUT",
                    "/trips/{tripId}/itinerary",
                    {"tripId": "trip-1"},
                    {"days": [{"dayNumber": 4, "activities": [{"name": "Museo"}]}]},
                ),
                None,
            )

        self.assertEqual(result["statusCode"], 400)
        self.assertEqual(response_body(result)["error"]["code"], "INVALID_ITINERARY")
        table.put_item.assert_not_called()

    def test_create_itinerary_saves_sorted_days_for_owned_trip(self):
        table = unittest.mock.Mock()
        table.get_item.side_effect = [
            {"Item": {"tripId": "trip-1", "startDate": "2026-12-01", "endDate": "2026-12-02"}},
            {"Item": None},
        ]
        payload = {
            "days": [
                {"dayNumber": 2, "activities": [{"name": "Museo"}]},
                {"dayNumber": 1, "activities": [{"name": "Centro histórico"}]},
            ],
        }
        with patch("lambdas.itineraries.handler.get_table", return_value=table):
            result = itineraries_handler.lambda_handler(
                event("PUT", "/trips/{tripId}/itinerary", {"tripId": "trip-1"}, payload),
                None,
            )

        saved = table.put_item.call_args.kwargs["Item"]
        self.assertEqual(result["statusCode"], 201)
        self.assertEqual(saved["PK"], f"USER#{USER_ID}")
        self.assertEqual(
            [day["dayNumber"] for day in saved["days"]],
            [1, 2],
        )
        self.assertEqual(response_body(result)["itinerary"]["tripId"], "trip-1")

    def test_create_reservation_starts_simulated(self):
        table = unittest.mock.Mock()
        table.get_item.return_value = {"Item": {"tripId": "trip-1"}}
        with patch("lambdas.reservations.handler.get_table", return_value=table):
            result = reservations_handler.lambda_handler(
                event(
                    "POST",
                    "/trips/{tripId}/reservations",
                    {"tripId": "trip-1"},
                    {"type": "flight"},
                ),
                None,
            )

        saved = table.put_item.call_args.kwargs["Item"]
        self.assertEqual(result["statusCode"], 201)
        self.assertEqual(saved["status"], "SIMULADA")
        self.assertEqual(saved["PK"], f"USER#{USER_ID}")

    def test_reservation_cannot_be_confirmed_without_a_provider(self):
        with self.assertRaises(ApiError) as context:
            validate_reservation_status("CONFIRMADA")

        self.assertEqual(context.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
