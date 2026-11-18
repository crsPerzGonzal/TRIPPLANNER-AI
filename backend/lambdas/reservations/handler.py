import uuid

from common.api import ApiError, parse_json_body, run
from common.storage import get_item, get_table, now_timestamp, put_item, query_prefix, update_item, user_partition_key
from common.validation import require_path_parameter, validate_reservation_status, validate_reservation_type


def lambda_handler(event, context):
    return run(event, _handle)


def _handle(event, user_id):
    trip_id = require_path_parameter(event, "tripId")
    table = get_table()
    if get_item(table, user_id, f"TRIP#{trip_id}") is None:
        raise ApiError(404, "TRIP_NOT_FOUND", "No se encontró el viaje.")

    resource = event.get("resource")
    method = event.get("httpMethod")
    if method == "POST" and resource == "/trips/{tripId}/reservations":
        return _create_reservation(event, user_id, table, trip_id)
    if method == "GET" and resource == "/trips/{tripId}/reservations":
        reservations = query_prefix(table, user_id, f"RESERVATION#{trip_id}#")
        return 200, {"reservations": reservations}
    if method == "PATCH" and resource == "/trips/{tripId}/reservations/{reservationId}":
        reservation_id = require_path_parameter(event, "reservationId")
        return _update_reservation(event, user_id, table, trip_id, reservation_id)

    raise ApiError(404, "NOT_FOUND", "La operación solicitada no existe.")


def _create_reservation(event, user_id, table, trip_id):
    payload = parse_json_body(event)
    if set(payload) != {"type"}:
        raise ApiError(400, "INVALID_FIELDS", "La reserva debe incluir únicamente type.")
    reservation_type = validate_reservation_type(payload["type"])
    reservation_id = uuid.uuid4().hex
    timestamp = now_timestamp()
    reservation = {
        "PK": user_partition_key(user_id),
        "SK": f"RESERVATION#{trip_id}#{reservation_id}",
        "entityType": "RESERVATION",
        "tripId": trip_id,
        "reservationId": reservation_id,
        "type": reservation_type,
        "status": "SIMULADA",
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    put_item(table, reservation)
    return 201, {"reservation": reservation}


def _update_reservation(event, user_id, table, trip_id, reservation_id):
    payload = parse_json_body(event)
    if set(payload) != {"status"}:
        raise ApiError(400, "INVALID_FIELDS", "La actualización debe incluir únicamente status.")
    status = validate_reservation_status(payload["status"])
    sort_key = f"RESERVATION#{trip_id}#{reservation_id}"
    if get_item(table, user_id, sort_key) is None:
        raise ApiError(404, "RESERVATION_NOT_FOUND", "No se encontró la reserva.")
    reservation = update_item(table, user_id, sort_key, {"status": status})
    return 200, {"reservation": reservation}
