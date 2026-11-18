import uuid

from common.api import ApiError, parse_json_body, run
from common.storage import get_item, get_table, now_timestamp, put_item, query_prefix, update_item, user_partition_key
from common.validation import TRIP_FIELDS, require_path_parameter, validate_trip


def lambda_handler(event, context):
    return run(event, _handle)


def _handle(event, user_id):
    method = event.get("httpMethod")
    resource = event.get("resource")
    table = get_table()

    if method == "POST" and resource == "/trips":
        return _create_trip(event, user_id, table)
    if method == "GET" and resource == "/trips":
        trips = query_prefix(table, user_id, "TRIP#")
        return 200, {"trips": trips}
    if resource == "/trips/{tripId}":
        trip_id = require_path_parameter(event, "tripId")
        sort_key = f"TRIP#{trip_id}"
        if method == "GET":
            trip = get_item(table, user_id, sort_key)
            if trip is None:
                raise ApiError(404, "TRIP_NOT_FOUND", "No se encontró el viaje.")
            return 200, {"trip": trip}
        if method == "PATCH":
            return _update_trip(event, user_id, table, trip_id, sort_key)

    raise ApiError(404, "NOT_FOUND", "La operación solicitada no existe.")


def _create_trip(event, user_id, table):
    payload = parse_json_body(event)
    attributes = validate_trip(payload)
    trip_id = uuid.uuid4().hex
    timestamp = now_timestamp()
    trip = {
        "PK": user_partition_key(user_id),
        "SK": f"TRIP#{trip_id}",
        "entityType": "TRIP",
        "tripId": trip_id,
        **attributes,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    put_item(table, trip)
    return 201, {"trip": trip}


def _update_trip(event, user_id, table, trip_id, sort_key):
    payload = parse_json_body(event)
    updates = validate_trip(payload, partial=True)
    current = get_item(table, user_id, sort_key)
    if current is None:
        raise ApiError(404, "TRIP_NOT_FOUND", "No se encontró el viaje.")

    candidate = {field: current[field] for field in TRIP_FIELDS}
    candidate.update(updates)
    validate_trip(candidate)
    updated = update_item(table, user_id, sort_key, updates)
    return 200, {"trip": updated}
