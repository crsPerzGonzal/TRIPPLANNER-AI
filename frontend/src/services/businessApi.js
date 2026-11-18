import { restoreSession } from './cognito.js'

const apiBaseUrl = import.meta.env.VITE_BUSINESS_API_URL

class BusinessApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.name = 'BusinessApiError'
    this.status = status
    this.code = code
  }
}

async function request(path, { method = 'GET', body } = {}) {
  if (!apiBaseUrl) {
    throw new Error('Configura VITE_BUSINESS_API_URL en frontend/.env.local.')
  }

  const user = await restoreSession()
  if (!user) {
    throw new Error('No hay una sesión activa de Cognito. Inicia sesión nuevamente para continuar.')
  }

  const headers = {
    Accept: 'application/json',
    Authorization: user.idToken,
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, '')}${path}`, {
    method,
    headers: {
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('La API devolvió una respuesta que no es JSON.')
  }

  if (!response.ok) {
    throw new BusinessApiError(
      result.error?.message
        || result.message
        || `La solicitud no se pudo completar (HTTP ${response.status}).`,
      response.status,
      result.error?.code,
    )
  }

  return result
}

export async function getTrips() {
  const result = await request('/trips')
  if (!Array.isArray(result.trips)) {
    throw new Error('La API devolvió una lista de viajes con formato no válido.')
  }

  return result.trips
}

export async function createTrip(trip) {
  const result = await request('/trips', { method: 'POST', body: trip })
  if (!result.trip || typeof result.trip.tripId !== 'string') {
    throw new Error('La API no devolvió el viaje creado con el formato esperado.')
  }

  return result.trip
}

export async function getItinerary(tripId) {
  try {
    const result = await request(`/trips/${encodeURIComponent(tripId)}/itinerary`)
    if (!Array.isArray(result.itinerary?.days)) {
      throw new Error('La API devolvió un itinerario con formato no válido.')
    }

    return result.itinerary
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 404 && error.code === 'ITINERARY_NOT_FOUND') {
      return null
    }

    throw error
  }
}

export async function saveItinerary(tripId, days) {
  const result = await request(`/trips/${encodeURIComponent(tripId)}/itinerary`, {
    method: 'PUT',
    body: { days },
  })

  if (!Array.isArray(result.itinerary?.days)) {
    throw new Error('La API no devolvió el itinerario guardado con el formato esperado.')
  }

  return result.itinerary
}

export async function getReservations(tripId) {
  const result = await request(`/trips/${encodeURIComponent(tripId)}/reservations`)
  if (!Array.isArray(result.reservations)) {
    throw new Error('La API devolvió una lista de reservas con formato no válido.')
  }

  return result.reservations
}

export async function createReservation(tripId, type) {
  const result = await request(`/trips/${encodeURIComponent(tripId)}/reservations`, {
    method: 'POST',
    body: { type },
  })

  if (!result.reservation || typeof result.reservation.reservationId !== 'string') {
    throw new Error('La API no devolvió la reserva creada con el formato esperado.')
  }

  return result.reservation
}

export async function updateReservation(tripId, reservationId, status) {
  const result = await request(
    `/trips/${encodeURIComponent(tripId)}/reservations/${encodeURIComponent(reservationId)}`,
    {
      method: 'PATCH',
      body: { status },
    },
  )

  if (!result.reservation || result.reservation.reservationId !== reservationId) {
    throw new Error('La API no devolvió la reserva actualizada con el formato esperado.')
  }

  return result.reservation
}

export async function getPreferences() {
  const result = await request('/preferences')
  if (result.preferences !== null && (
    !result.preferences
    || !Array.isArray(result.preferences.interests)
    || typeof result.preferences.travelPace !== 'string'
    || typeof result.preferences.budgetStyle !== 'string'
  )) {
    throw new Error('La API devolvió preferencias con formato no válido.')
  }

  return result.preferences
}

export async function savePreferences(preferences) {
  const result = await request('/preferences', {
    method: 'PUT',
    body: {
      interests: preferences.interests,
      travelPace: preferences.travelPace,
      budgetStyle: preferences.budgetStyle,
    },
  })
  if (
    !result.preferences
    || !Array.isArray(result.preferences.interests)
    || typeof result.preferences.travelPace !== 'string'
    || typeof result.preferences.budgetStyle !== 'string'
  ) {
    throw new Error('La API no devolvió las preferencias guardadas con el formato esperado.')
  }

  return result.preferences
}
