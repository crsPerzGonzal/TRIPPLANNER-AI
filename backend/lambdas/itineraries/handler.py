from datetime import date
import uuid

from common.api import ApiError, parse_json_body, run
from common.storage import get_item, get_table, now_timestamp, put_item, update_item, user_partition_key
from common.validation import require_path_parameter, validate_days


def lambda_handler(event, context):
    return run(event, _handle)


def _handle(event, user_id):
    trip_id = require_path_parameter(event, "tripId")
    table = get_table()
    trip = get_item(table, user_id, f"TRIP#{trip_id}")
    if trip is None:
        raise ApiError(404, "TRIP_NOT_FOUND", "No se encontró el viaje.")

    sort_key = f"ITINERARY#{trip_id}"
    if event.get("httpMethod") == "GET" and event.get("resource") == "/trips/{tripId}/itinerary":
        itinerary = get_item(table, user_id, sort_key)
        if itinerary is None:
            raise ApiError(404, "ITINERARY_NOT_FOUND", "El viaje aún no tiene itinerario.")
        return 200, {"itinerary": itinerary}

    if event.get("httpMethod") == "PUT" and event.get("resource") == "/trips/{tripId}/itinerary":
        return _put_itinerary(event, user_id, table, trip_id, sort_key, trip)

    raise ApiError(404, "NOT_FOUND", "La operación solicitada no existe.")


def _put_itinerary(event, user_id, table, trip_id, sort_key, trip):
    payload = parse_json_body(event)
    trip_day_count = (
        date.fromisoformat(trip["endDate"]) - date.fromisoformat(trip["startDate"])
    ).days + 1
    days = validate_days(payload, max_day_number=trip_day_count)
    existing = get_item(table, user_id, sort_key)
    timestamp = now_timestamp()

    if existing is None:
        itinerary = {
            "PK": user_partition_key(user_id),
            "SK": sort_key,
            "entityType": "ITINERARY",
            "tripId": trip_id,
            "itineraryId": uuid.uuid4().hex,
            "days": days,
            "createdAt": timestamp,
            "updatedAt": timestamp,
        }
        put_item(table, itinerary)
        return 201, {"itinerary": itinerary}
    else:
        itinerary = update_item(table, user_id, sort_key, {"days": days})

    return 200, {"itinerary": itinerary}
