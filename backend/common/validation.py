import re
from datetime import date
from decimal import Decimal, InvalidOperation

from common.api import ApiError


TRIP_FIELDS = {"origin", "destination", "startDate", "endDate", "travelerCount", "budget"}
PREFERENCE_INTERESTS = {"culture", "nature", "gastronomy", "adventure", "relaxation", "shopping"}
TRAVEL_PACES = {"relaxed", "balanced", "active"}
BUDGET_STYLES = {"economy", "balanced", "comfort"}


def validate_preferences(payload):
    allowed_fields = {"interests", "travelPace", "budgetStyle"}
    if set(payload) != allowed_fields:
        raise ApiError(
            400,
            "INVALID_PREFERENCES",
            "Las preferencias requieren interests, travelPace y budgetStyle.",
        )

    interests = payload["interests"]
    if (
        not isinstance(interests, list)
        or len(interests) > len(PREFERENCE_INTERESTS)
        or any(not isinstance(value, str) or value not in PREFERENCE_INTERESTS for value in interests)
        or len(set(interests)) != len(interests)
    ):
        raise ApiError(
            400,
            "INVALID_PREFERENCES",
            "interests debe contener intereses permitidos sin duplicados.",
        )

    travel_pace = payload["travelPace"]
    if not isinstance(travel_pace, str) or travel_pace not in TRAVEL_PACES:
        raise ApiError(400, "INVALID_PREFERENCES", "travelPace no es válido.")

    budget_style = payload["budgetStyle"]
    if not isinstance(budget_style, str) or budget_style not in BUDGET_STYLES:
        raise ApiError(400, "INVALID_PREFERENCES", "budgetStyle no es válido.")

    return {
        "interests": list(interests),
        "travelPace": travel_pace,
        "budgetStyle": budget_style,
    }


def require_path_parameter(event, name):
    parameters = event.get("pathParameters") or {}
    value = parameters.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(400, "INVALID_PATH", f"Falta el parámetro {name}.")
    return value.strip()


def validate_trip(payload, partial=False):
    allowed = TRIP_FIELDS
    unknown = set(payload) - allowed
    if unknown:
        raise ApiError(400, "INVALID_FIELDS", "El viaje contiene campos no permitidos.")
    if partial and not payload:
        raise ApiError(400, "EMPTY_UPDATE", "Indica al menos un campo para actualizar.")
    if not partial and set(payload) != TRIP_FIELDS:
        raise ApiError(400, "MISSING_FIELDS", "El viaje debe incluir todos los campos requeridos.")

    normalized = dict(payload)
    for field in ("origin", "destination"):
        if field in normalized:
            value = normalized[field]
            if not isinstance(value, str) or not value.strip():
                raise ApiError(400, "INVALID_TRIP", f"{field} debe ser un texto no vacío.")
            normalized[field] = value.strip()

    for field in ("startDate", "endDate"):
        if field in normalized:
            normalized[field] = _validate_date(normalized[field], field)

    if "travelerCount" in normalized:
        count = normalized["travelerCount"]
        if isinstance(count, bool) or not isinstance(count, int) or count < 1:
            raise ApiError(400, "INVALID_TRIP", "travelerCount debe ser un entero positivo.")

    if "budget" in normalized:
        normalized["budget"] = _validate_budget(normalized["budget"])

    if "startDate" in normalized and "endDate" in normalized:
        if normalized["endDate"] < normalized["startDate"]:
            raise ApiError(400, "INVALID_TRIP", "endDate no puede ser anterior a startDate.")

    return normalized


def validate_days(payload, max_day_number=None):
    if set(payload) != {"days"}:
        raise ApiError(400, "INVALID_FIELDS", "El itinerario debe incluir únicamente days.")

    days = payload["days"]
    if not isinstance(days, list):
        raise ApiError(400, "INVALID_ITINERARY", "days debe ser una lista.")

    normalized = []
    seen_days = set()
    for day in days:
        if not isinstance(day, dict) or set(day) != {"dayNumber", "activities"}:
            raise ApiError(400, "INVALID_ITINERARY", "Cada día requiere dayNumber y activities.")
        day_number = day["dayNumber"]
        activities = day["activities"]
        if isinstance(day_number, bool) or not isinstance(day_number, int) or day_number < 1:
            raise ApiError(400, "INVALID_ITINERARY", "dayNumber debe ser un entero positivo.")
        if max_day_number is not None and day_number > max_day_number:
            raise ApiError(400, "INVALID_ITINERARY", "dayNumber debe corresponder a una fecha del viaje.")
        if day_number in seen_days:
            raise ApiError(400, "INVALID_ITINERARY", "No se permiten días duplicados.")
        if not isinstance(activities, list):
            raise ApiError(400, "INVALID_ITINERARY", "activities debe ser una lista.")

        normalized_activities = []
        for activity in activities:
            if not isinstance(activity, dict) or set(activity) != {"name"}:
                raise ApiError(400, "INVALID_ITINERARY", "Cada actividad requiere únicamente name.")
            name = activity["name"]
            if not isinstance(name, str) or not name.strip():
                raise ApiError(400, "INVALID_ITINERARY", "El nombre de la actividad no puede estar vacío.")
            normalized_activities.append({"name": name.strip()})

        seen_days.add(day_number)
        normalized.append({"dayNumber": day_number, "activities": normalized_activities})

    return sorted(normalized, key=lambda item: item["dayNumber"])


def validate_reservation_type(value):
    allowed_types = {"flight", "hotel", "activity"}
    if not isinstance(value, str) or value not in allowed_types:
        raise ApiError(400, "INVALID_RESERVATION", "El tipo debe ser flight, hotel o activity.")
    return value


def validate_reservation_status(value):
    if not isinstance(value, str):
        raise ApiError(400, "INVALID_RESERVATION", "El estado de reserva no es válido.")
    if value == "CONFIRMADA":
        raise ApiError(
            409,
            "PROVIDER_CONFIRMATION_REQUIRED",
            "Una reserva solo puede confirmarse mediante un proveedor integrado.",
        )
    if value not in {"SIMULADA", "PENDIENTE"}:
        raise ApiError(400, "INVALID_RESERVATION", "El estado de reserva no es válido.")
    return value


def _validate_date(value, field):
    if not isinstance(value, str):
        raise ApiError(400, "INVALID_TRIP", f"{field} debe usar el formato YYYY-MM-DD.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ApiError(400, "INVALID_TRIP", f"{field} debe usar el formato YYYY-MM-DD.")
    if parsed.isoformat() != value:
        raise ApiError(400, "INVALID_TRIP", f"{field} debe usar el formato YYYY-MM-DD.")
    return value


def _validate_budget(value):
    if not isinstance(value, dict) or set(value) != {"amount", "currency"}:
        raise ApiError(400, "INVALID_TRIP", "budget requiere amount y currency.")
    amount = value["amount"]
    currency = value["currency"]
    if isinstance(amount, bool) or not isinstance(amount, (int, float, Decimal)):
        raise ApiError(400, "INVALID_TRIP", "budget.amount debe ser una cantidad no negativa.")
    try:
        amount = Decimal(str(amount))
    except InvalidOperation:
        raise ApiError(400, "INVALID_TRIP", "budget.amount debe ser una cantidad válida.")
    if not amount.is_finite() or amount < 0:
        raise ApiError(400, "INVALID_TRIP", "budget.amount debe ser una cantidad válida para DynamoDB.")
    exponent = amount.adjusted() if amount else 0
    if (
        len(amount.as_tuple().digits) > 38
        or exponent > 125
        or (amount and exponent < -130)
    ):
        raise ApiError(400, "INVALID_TRIP", "budget.amount debe ser una cantidad válida para DynamoDB.")
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        raise ApiError(400, "INVALID_TRIP", "budget.currency debe ser un código de tres letras.")
    return {"amount": amount, "currency": currency}
