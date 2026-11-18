import importlib
import json
import os
import sys
import types
import unittest
from unittest.mock import patch

from business_api import BusinessApiError


_decorated_tools: list[str] = []


def _tool(func=None, *, context=False, **_kwargs):
    def decorate(function):
        if context is not True:
            raise AssertionError("Business tools must enable Strands context injection.")
        _decorated_tools.append(function.__name__)
        return function

    return decorate if func is None else decorate(func)


class _ToolContext:
    def __init__(self, token="cognito-id-token"):
        self.invocation_state = {"business_id_token": token}


strands_module = types.ModuleType("strands")
strands_module.tool = _tool
strands_types_module = types.ModuleType("strands.types")
strands_types_module.__path__ = []
strands_tools_module = types.ModuleType("strands.types.tools")
strands_tools_module.ToolContext = _ToolContext

with patch.dict(
    sys.modules,
    {
        "strands": strands_module,
        "strands.types": strands_types_module,
        "strands.types.tools": strands_tools_module,
    },
):
    business_tools = importlib.import_module("business_tools")


class BusinessToolsTests(unittest.TestCase):
    def setUp(self):
        self.context = _ToolContext()
        self.api_call = patch.object(
            business_tools,
            "call_business_api",
            return_value={"saved": True},
        )
        self.mock_api_call = self.api_call.start()
        self.addCleanup(self.api_call.stop)
        self.environment = patch.dict(
            os.environ,
            {"TRIPPLANNER_BUSINESS_API_URL": "https://api.example.com/prod/"},
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def assert_api_call(self, method, path, payload=None):
        self.mock_api_call.assert_called_once_with(
            "https://api.example.com/prod/",
            path,
            method,
            "cognito-id-token",
            payload,
        )

    def test_registers_tools_with_context_injection(self):
        self.assertEqual(
            set(_decorated_tools),
            {
                "create_trip",
                "get_trips",
                "get_travel_preferences",
                "save_travel_preferences",
                "update_trip",
                "get_itinerary",
                "create_itinerary",
                "update_itinerary",
                "create_reservation",
                "get_reservations",
                "update_reservation",
            },
        )

    def test_create_trip_maps_arguments_to_api_contract(self):
        result = business_tools.create_trip(
            "Bogotá",
            "Cartagena",
            "2026-12-01",
            "2026-12-04",
            3,
            5_000_000,
            "COP",
            self.context,
        )

        self.assert_api_call(
            "POST",
            "/trips",
            {
                "origin": "Bogotá",
                "destination": "Cartagena",
                "startDate": "2026-12-01",
                "endDate": "2026-12-04",
                "travelerCount": 3,
                "budget": {"amount": 5_000_000, "currency": "COP"},
            },
        )
        self.assertEqual(json.loads(result), {"ok": True, "result": {"saved": True}})

    def test_get_trips_uses_authenticated_api(self):
        business_tools.get_trips(self.context)

        self.assert_api_call("GET", "/trips")

    def test_update_trip_encodes_id_and_only_sends_changed_fields(self):
        business_tools.update_trip(
            "trip/one",
            self.context,
            destination="Cali",
            budget_amount=400_000,
            budget_currency="COP",
        )

        self.assert_api_call(
            "PATCH",
            "/trips/trip%2Fone",
            {
                "destination": "Cali",
                "budget": {"amount": 400_000, "currency": "COP"},
            },
        )

    def test_update_trip_rejects_partial_or_empty_updates(self):
        for kwargs, error_code in (
            ({"budget_amount": 100}, "INVALID_BUDGET"),
            ({}, "EMPTY_UPDATE"),
        ):
            with self.subTest(error_code=error_code):
                result = business_tools.update_trip("trip-1", self.context, **kwargs)
                self.assertEqual(json.loads(result)["error"]["code"], error_code)

        self.mock_api_call.assert_not_called()

    def test_itinerary_tools_use_days_contract_and_encoded_trip_id(self):
        days = [{"dayNumber": 1, "activities": [{"name": "Museo"}]}]

        business_tools.get_itinerary("trip/one", self.context)
        self.assert_api_call("GET", "/trips/trip%2Fone/itinerary")

        self.mock_api_call.reset_mock()
        business_tools.create_itinerary("trip-1", days, self.context)
        self.assert_api_call("PUT", "/trips/trip-1/itinerary", {"days": days})

        self.mock_api_call.reset_mock()
        business_tools.update_itinerary("trip-1", days, self.context)
        self.assert_api_call("PUT", "/trips/trip-1/itinerary", {"days": days})

    def test_reservation_tools_use_api_contract_and_encode_ids(self):
        business_tools.create_reservation("trip-1", "hotel", self.context)
        self.assert_api_call(
            "POST",
            "/trips/trip-1/reservations",
            {"type": "hotel"},
        )

        self.mock_api_call.reset_mock()
        business_tools.get_reservations("trip-1", self.context)
        self.assert_api_call("GET", "/trips/trip-1/reservations")

        self.mock_api_call.reset_mock()
        business_tools.update_reservation(
            "trip/one",
            "reservation/one",
            "PENDIENTE",
            self.context,
        )
        self.assert_api_call(
            "PATCH",
            "/trips/trip%2Fone/reservations/reservation%2Fone",
            {"status": "PENDIENTE"},
        )

    def test_api_errors_remain_explicit_tool_results(self):
        self.mock_api_call.side_effect = BusinessApiError(
            404,
            "TRIP_NOT_FOUND",
            "No se encontró el viaje.",
        )

        result = json.loads(business_tools.get_trips(self.context))

        self.assertEqual(
            result,
            {
                "ok": False,
                "error": {
                    "status": 404,
                    "code": "TRIP_NOT_FOUND",
                    "message": "No se encontró el viaje.",
                },
            },
        )


if __name__ == "__main__":
    unittest.main()
