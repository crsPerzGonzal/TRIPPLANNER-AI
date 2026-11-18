import json
import os
from typing import Any
from urllib.parse import quote

from strands import tool
from strands.types.tools import ToolContext

from business_api import BusinessApiError, call_business_api


def _call_business_api(
    method: str,
    path: str,
    tool_context: ToolContext,
    payload: dict | None = None,
) -> str:
    token = tool_context.invocation_state.get("business_id_token")
    try:
        result = call_business_api(
            os.environ.get("TRIPPLANNER_BUSINESS_API_URL", ""),
            path,
            method,
            token,
            payload,
        )
    except BusinessApiError as error:
        return json.dumps(
            {
                "ok": False,
                "error": {
                    "status": error.status_code,
                    "code": error.code,
                    "message": error.message,
                },
            },
            ensure_ascii=False,
        )
    return json.dumps({"ok": True, "result": result}, ensure_ascii=False)


@tool(context=True)
def create_trip(
    origin: str,
    destination: str,
    start_date: str,
    end_date: str,
    traveler_count: int,
    budget_amount: float,
    budget_currency: str,
    tool_context: ToolContext,
) -> str:
    """Crea un viaje con los datos proporcionados explícitamente por el usuario."""
    return _call_business_api(
        "POST",
        "/trips",
        tool_context,
        {
            "origin": origin,
            "destination": destination,
            "startDate": start_date,
            "endDate": end_date,
            "travelerCount": traveler_count,
            "budget": {"amount": budget_amount, "currency": budget_currency},
        },
    )


@tool(context=True)
def get_trips(tool_context: ToolContext) -> str:
    """Consulta los viajes del usuario autenticado, incluidos destino y fechas para seleccionar uno."""
    return _call_business_api("GET", "/trips", tool_context)


@tool(context=True)
def get_travel_preferences(tool_context: ToolContext) -> str:
    """Consulta los intereses, ritmo y nivel de presupuesto preferidos por el usuario autenticado."""
    return _call_business_api("GET", "/preferences", tool_context)


@tool(context=True)
def save_travel_preferences(
    interests: list[str],
    travel_pace: str,
    budget_style: str,
    tool_context: ToolContext,
) -> str:
    """Guarda las preferencias de viaje del usuario autenticado cuando lo solicita explícitamente."""
    return _call_business_api(
        "PUT",
        "/preferences",
        tool_context,
        {
            "interests": interests,
            "travelPace": travel_pace,
            "budgetStyle": budget_style,
        },
    )


@tool(context=True)
def update_trip(
    trip_id: str,
    tool_context: ToolContext,
    origin: str | None = None,
    destination: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    traveler_count: int | None = None,
    budget_amount: float | None = None,
    budget_currency: str | None = None,
) -> str:
    """Actualiza los campos proporcionados de un viaje del usuario."""
    payload: dict[str, Any] = {}
    for argument, field in (
        (origin, "origin"),
        (destination, "destination"),
        (start_date, "startDate"),
        (end_date, "endDate"),
        (traveler_count, "travelerCount"),
    ):
        if argument is not None:
            payload[field] = argument

    if (budget_amount is None) != (budget_currency is None):
        return json.dumps(
            {
                "ok": False,
                "error": {
                    "code": "INVALID_BUDGET",
                    "message": "Para actualizar el presupuesto se requieren amount y currency.",
                },
            },
            ensure_ascii=False,
        )
    if budget_amount is not None and budget_currency is not None:
        payload["budget"] = {
            "amount": budget_amount,
            "currency": budget_currency,
        }
    if not payload:
        return json.dumps(
            {
                "ok": False,
                "error": {
                    "code": "EMPTY_UPDATE",
                    "message": "Indica al menos un campo para actualizar.",
                },
            },
            ensure_ascii=False,
        )

    return _call_business_api(
        "PATCH",
        f"/trips/{quote(trip_id, safe='')}",
        tool_context,
        payload,
    )


@tool(context=True)
def get_itinerary(trip_id: str, tool_context: ToolContext) -> str:
    """Consulta el itinerario guardado antes de generar uno; ITINERARY_NOT_FOUND significa que aún no existe."""
    return _call_business_api(
        "GET",
        f"/trips/{quote(trip_id, safe='')}/itinerary",
        tool_context,
    )


@tool(context=True)
def create_itinerary(
    trip_id: str,
    days: list[dict[str, Any]],
    tool_context: ToolContext,
) -> str:
    """Guarda el primer itinerario de un viaje. days debe contener objetos con dayNumber y activities; cada actividad solo lleva name."""
    return _call_business_api(
        "PUT",
        f"/trips/{quote(trip_id, safe='')}/itinerary",
        tool_context,
        {"days": days},
    )


@tool(context=True)
def update_itinerary(
    trip_id: str,
    days: list[dict[str, Any]],
    tool_context: ToolContext,
) -> str:
    """Reemplaza el itinerario existente de un viaje. days debe contener objetos con dayNumber y activities; cada actividad solo lleva name."""
    return _call_business_api(
        "PUT",
        f"/trips/{quote(trip_id, safe='')}/itinerary",
        tool_context,
        {"days": days},
    )


@tool(context=True)
def create_reservation(
    trip_id: str,
    reservation_type: str,
    tool_context: ToolContext,
) -> str:
    """Registra una reserva simulada asociada a un viaje."""
    return _call_business_api(
        "POST",
        f"/trips/{quote(trip_id, safe='')}/reservations",
        tool_context,
        {"type": reservation_type},
    )


@tool(context=True)
def get_reservations(trip_id: str, tool_context: ToolContext) -> str:
    """Consulta las reservas de un viaje."""
    return _call_business_api(
        "GET",
        f"/trips/{quote(trip_id, safe='')}/reservations",
        tool_context,
    )


@tool(context=True)
def update_reservation(
    trip_id: str,
    reservation_id: str,
    status: str,
    tool_context: ToolContext,
) -> str:
    """Actualiza el estado permitido de una reserva del usuario."""
    return _call_business_api(
        "PATCH",
        f"/trips/{quote(trip_id, safe='')}/reservations/{quote(reservation_id, safe='')}",
        tool_context,
        {"status": status},
    )
