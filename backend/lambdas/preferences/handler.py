from common.api import ApiError, parse_json_body, run
from common.storage import get_item, get_table, now_timestamp, user_partition_key
from common.validation import validate_preferences


PREFERENCES_SORT_KEY = "PREFERENCES#TRAVEL"


def lambda_handler(event, context):
    return run(event, _handle)


def _handle(event, user_id):
    method = event.get("httpMethod")
    if method not in {"GET", "PUT"} or event.get("resource") != "/preferences":
        raise ApiError(404, "NOT_FOUND", "La operación solicitada no existe.")

    table = get_table()
    existing = get_item(table, user_id, PREFERENCES_SORT_KEY)
    if method == "GET":
        if existing is None:
            return 200, {"preferences": None}
        return 200, {"preferences": _public_preferences(existing)}

    preferences = validate_preferences(parse_json_body(event))
    timestamp = now_timestamp()
    item = {
        "PK": user_partition_key(user_id),
        "SK": PREFERENCES_SORT_KEY,
        "entityType": "PREFERENCES",
        **preferences,
        "createdAt": existing.get("createdAt", timestamp) if existing else timestamp,
        "updatedAt": timestamp,
    }
    table.put_item(Item=item)
    return 200, {"preferences": _public_preferences(item)}


def _public_preferences(item):
    return {
        "interests": item["interests"],
        "travelPace": item["travelPace"],
        "budgetStyle": item["budgetStyle"],
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
    }
