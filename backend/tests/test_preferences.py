import json
import os
import sys
import unittest
from unittest.mock import Mock, patch


BACKEND_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_PATH not in sys.path:
    sys.path.insert(0, BACKEND_PATH)

from lambdas.preferences import handler as preferences_handler


USER_ID = "user-123"
PREFERENCES = {
    "interests": ["nature", "culture"],
    "travelPace": "balanced",
    "budgetStyle": "economy",
}


def event(method, body=None, authenticated=True):
    request_context = {}
    if authenticated:
        request_context["authorizer"] = {"claims": {"sub": USER_ID}}
    return {
        "httpMethod": method,
        "resource": "/preferences",
        "requestContext": request_context,
        "body": None if body is None else json.dumps(body),
    }


class PreferencesHandlerTests(unittest.TestCase):
    def test_unauthenticated_request_is_rejected_before_table_access(self):
        with patch("lambdas.preferences.handler.get_table") as get_table:
            result = preferences_handler.lambda_handler(event("GET", authenticated=False), None)

        self.assertEqual(result["statusCode"], 401)
        get_table.assert_not_called()

    def test_get_reads_only_the_authenticated_user_partition(self):
        table = Mock()
        stored = {**PREFERENCES, "createdAt": "created", "updatedAt": "updated"}
        with (
            patch("lambdas.preferences.handler.get_table", return_value=table),
            patch("lambdas.preferences.handler.get_item", return_value=stored) as get_item,
        ):
            result = preferences_handler.lambda_handler(event("GET"), None)

        get_item.assert_called_once_with(table, USER_ID, "PREFERENCES#TRAVEL")
        self.assertEqual(json.loads(result["body"])["preferences"]["interests"], PREFERENCES["interests"])

    def test_put_writes_to_authenticated_partition_and_rejects_user_id(self):
        table = Mock()
        with (
            patch("lambdas.preferences.handler.get_table", return_value=table),
            patch("lambdas.preferences.handler.get_item", return_value=None),
        ):
            result = preferences_handler.lambda_handler(event("PUT", PREFERENCES), None)

        item = table.put_item.call_args.kwargs["Item"]
        self.assertEqual(item["PK"], f"USER#{USER_ID}")
        self.assertEqual(item["SK"], "PREFERENCES#TRAVEL")
        self.assertEqual(result["statusCode"], 200)

        with patch("lambdas.preferences.handler.get_table", return_value=table):
            invalid = preferences_handler.lambda_handler(
                event("PUT", {**PREFERENCES, "userId": "other-user"}),
                None,
            )

        self.assertEqual(invalid["statusCode"], 400)
        self.assertEqual(table.put_item.call_count, 1)


if __name__ == "__main__":
    unittest.main()
