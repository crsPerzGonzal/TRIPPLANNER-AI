import { useEffect, useRef, useState } from 'react'
import {
  createReservation,
  createTrip,
  getItinerary,
  getPreferences,
  getReservations,
  getTrips,
  saveItinerary,
  savePreferences,
  updateReservation,
} from './services/businessApi.js'
import { isCognitoConfigured, restoreSession, signOut } from './services/cognito.js'
import { invokeAgentCore, isAgentCoreConfigured } from './services/agentCore.js'
import AuthPage from './pages/auth/AuthPage.jsx'
import TalkingHeadAvatar from './pages/assistant/TalkingHeadAvatar.jsx'
import './App.css'

const navigation = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'assistant', label: 'Asistente', icon: 'message' },
  { id: 'flights', label: 'Vuelos', icon: 'plane' },
  { id: 'weather', label: 'Clima', icon: 'sun' },
  { id: 'trips', label: 'Mis viajes', icon: 'pin' },
  { id: 'reservations', label: 'Reservas', icon: 'ticket' },
  { id: 'preferences', label: 'Preferencias', icon: 'sliders' },
]

const pageDetails = {
  dashboard: { title: 'Dashboard', eyebrow: 'TU ESPACIO DE VIAJE' },
  assistant: { title: 'Asistente de viajes', eyebrow: 'PLANEA CON INTELIGENCIA' },
  flights: { title: 'Consulta de vuelos', eyebrow: 'ENCUENTRA TU RUTA' },
  weather: { title: 'Información meteorológica', eyebrow: 'EL CLIMA EN TU DESTINO' },
  trips: { title: 'Mis viajes e itinerarios', eyebrow: 'TUS PLANES, EN UN SOLO LUGAR' },
  reservations: { title: 'Gestión de reservas', eyebrow: 'TODO BAJO CONTROL' },
  preferences: { title: 'Preferencias de viaje', eyebrow: 'TU FORMA DE VIAJAR' },
}

const defaultTravelPreferences = {
  interests: [],
  travelPace: 'balanced',
  budgetStyle: 'balanced',
}

const travelInterestOptions = [
  { value: 'culture', label: 'Cultura e historia' },
  { value: 'nature', label: 'Naturaleza' },
  { value: 'gastronomy', label: 'Gastronomía' },
  { value: 'adventure', label: 'Aventura' },
  { value: 'relaxation', label: 'Descanso' },
  { value: 'shopping', label: 'Compras' },
]

const initialTripForm = {
  origin: '',
  destination: '',
  startDate: '',
  endDate: '',
  travelerCount: '1',
  budgetAmount: '',
  currency: 'COP',
}

const initialFlightSearch = {
  origin: 'Bogotá',
  destination: 'Cartagena',
  departureDate: '',
  returnDate: '',
  travelerCount: '1',
}

function normalizeFlightLabel(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function parseFlightOptions(response) {
  const flights = []
  let currentFlight = null
  const fieldAliases = {
    'aerolinea y vuelo': 'airline',
    aerolinea: 'airline',
    horario: 'schedule',
    duracion: 'duration',
    precio: 'price',
    escalas: 'stops',
    'asientos disponibles': 'seats',
  }

  for (const line of response.split(/\r?\n/)) {
    const heading = line.match(/^\s*#{2,4}\s*(?:opcion|option)\s*(\d+)?\s*:?\s*(.*)$/i)
    if (heading) {
      if (currentFlight) flights.push(currentFlight)
      currentFlight = {
        number: heading[1] || String(flights.length + 1),
        kind: heading[2]?.trim() || '',
      }
      continue
    }

    if (!currentFlight) continue
    const field = line.match(/^\s*[-*]\s*\*\*(.+?):\*\*\s*(.*?)\s*$/)
    if (!field) continue
    const key = fieldAliases[normalizeFlightLabel(field[1])]
    if (key && field[2]) currentFlight[key] = field[2]
  }

  if (currentFlight) flights.push(currentFlight)
  return flights.filter((flight) => flight.airline || flight.price || flight.schedule)
}

function parseWeatherReport(response, requestedDestination) {
  const report = {
    destination: requestedDestination,
    temperature: '',
    conditions: '',
    rain: '',
    days: [],
  }
  const aliases = {
    temperatura: 'temperature',
    'temperatura maxima': 'maxTemperature',
    'temperatura minima': 'minTemperature',
    condiciones: 'conditions',
    'probabilidad de lluvia': 'rain',
  }
  let currentDay = null

  for (const line of response.split(/\r?\n/)) {
    const heading = line.match(/^\s*#{1,4}\s*clima\s+en\s+(.+?)\s*$/i)
    if (heading) report.destination = heading[1].replace(/\*\*/g, '').trim()

    const dayHeading = line.match(/^\s*#{2,4}\s*d[ií]a\s*(\d+)?\s*[—–:-]\s*(.+?)\s*$/i)
    if (dayHeading) {
      currentDay = {
        label: dayHeading[2].replace(/\*\*/g, '').trim(),
        number: dayHeading[1] || String(report.days.length + 1),
        temperature: '',
        maxTemperature: '',
        minTemperature: '',
        conditions: '',
        rain: '',
      }
      report.days.push(currentDay)
    }

    const field = line.match(/^\s*[-*]\s*\*\*(.+?):\*\*\s*(.*?)\s*$/)
    if (!field) continue
    const key = aliases[normalizeFlightLabel(field[1])]
    if (key && field[2]) {
      if (currentDay) currentDay[key] = field[2]
      else report[key] = field[2]
    }
  }

  report.days = report.days.filter((day) => (
    day.temperature || day.maxTemperature || day.minTemperature || day.conditions || day.rain
  ))
  return report
}

function getTripDayCount(trip) {
  const start = Date.parse(`${trip.startDate}T00:00:00Z`)
  const end = Date.parse(`${trip.endDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.floor((end - start) / 86400000) + 1
}

function getBogotaDateKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function useDashboardData(activePage, enabled) {
  const [data, setData] = useState({ trips: [], upcomingTrips: [], nextTrip: null, itinerary: null, upcomingPlans: [], reservations: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let active = true
    if (!enabled) {
      setData({ trips: [], upcomingTrips: [], nextTrip: null, itinerary: null, upcomingPlans: [], reservations: [] })
      setIsLoading(false)
      setError('')
      return () => { active = false }
    }
    setIsLoading(true)
    setError('')

    const loadDashboard = async () => {
      try {
        const trips = await getTrips()
        const upcomingTrips = trips
          .filter((trip) => trip.endDate >= getBogotaDateKey())
          .sort((left, right) => left.startDate.localeCompare(right.startDate))
        const nextTrip = upcomingTrips[0] ?? null
        const loadReservationBatches = async () => {
          const results = []
          for (let offset = 0; offset < upcomingTrips.length && active; offset += 5) {
            const batch = await Promise.all(upcomingTrips.slice(offset, offset + 5).map((trip) => getReservations(trip.tripId).then(
              (reservations) => ({ trip, reservations }),
              (reason) => ({ trip, error: reason }),
            )))
            results.push(...batch)
          }
          return results
        }
        const [upcomingPlans, reservationResults] = await Promise.all([
          Promise.all(upcomingTrips.slice(0, 3).map((trip) => getItinerary(trip.tripId).then(
            (itinerary) => ({ trip, itinerary, error: null }),
            (reason) => ({ trip, itinerary: null, error: reason }),
          ))),
          loadReservationBatches(),
        ])

        if (!active) return
        const reservations = reservationResults
          .flatMap((result) => result.reservations ?? [])
          .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))
        const reservationError = reservationResults.find((result) => result.error)?.error
        const nextPlan = upcomingPlans.find((plan) => plan.trip.tripId === nextTrip?.tripId)
        setData({
          trips,
          upcomingTrips,
          nextTrip,
          itinerary: nextPlan?.itinerary ?? null,
          upcomingPlans,
          reservations,
          itineraryError: nextPlan?.error ?? null,
          reservationError: reservationError ?? null,
        })
      } catch (requestError) {
        if (active) {
          setData({ trips: [], upcomingTrips: [], nextTrip: null, itinerary: null, upcomingPlans: [], reservations: [] })
          setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar el Dashboard.')
        }
      } finally {
        if (active) setIsLoading(false)
      }
    }

    loadDashboard()
    return () => { active = false }
  }, [activePage, enabled, reloadCount])

  return { ...data, isLoading, error, reload: () => setReloadCount((count) => count + 1) }
}

function formatItineraryDay(startDate, dayNumber) {
  const date = new Date(`${startDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + dayNumber - 1)
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date)
}

function Icon({ name, size = 20, strokeWidth = 1.8 }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth,
  }

  const shapes = {
    grid: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.7" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.7" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.7" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.7" />
      </>
    ),
    message: (
      <>
        <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-5.5A7.5 7.5 0 1 1 20 11.5Z" />
        <path d="M8 11h8M8 14h5" />
      </>
    ),
    plane: <path d="m3 11 18-7-7 18-3-8-8-3Zm8 3 6-6" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </>
    ),
    weather: (
      <>
        <path d="M7.5 18h9a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 5.2 10.5 3.8 3.8 0 0 0 7.5 18Z" />
        <path d="m9 20-1 2m7-2-1 2" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    ticket: (
      <>
        <path d="M3 8a2 2 0 0 0 0 4v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 1 0-4V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2Z" />
        <path d="M13 5v2m0 4v2m0 4v2" />
      </>
    ),
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2.5" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>
    ),
    sliders: (
      <>
        <path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h9m4 0h3" />
        <circle cx="15" cy="6" r="2" />
        <circle cx="9" cy="12" r="2" />
        <circle cx="15" cy="18" r="2" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="10" cy="7" r="4" />
        <path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    arrow: <path d="M7 17 17 7M7 7h10v10" />,
    arrowRight: <path d="M5 12h14m-6-6 6 6-6 6" />,
    plus: <path d="M12 5v14m-7-7h14" />,
    sparkles: (
      <>
        <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" />
        <path d="m19 14 1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1L19 14Z" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m18 6-12 12M6 6l12 12" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...common}
    >
      {shapes[name] ?? shapes.sparkles}
    </svg>
  )
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Icon name="plane" size={21} strokeWidth={2} />
    </span>
  )
}

function PalmTree({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 64 100" fill="none" aria-hidden="true">
      <path d="M33 97C37 76 34 52 32 29" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
      <path d="M32 30C19 16 8 17 3 5c15-1 26 6 31 20M32 29C28 13 34 5 42 2c5 14 1 24-8 30M34 28c10-15 21-16 29-8-8 12-19 15-30 12M31 30C17 24 7 28 3 39c14 5 24 1 32-7M35 30c12-7 22-4 27 6-12 8-23 6-32-3" fill="currentColor" />
    </svg>
  )
}

function Sidebar({ activePage, onNavigate, user, onSignOut, nextTrip, isDashboardLoading }) {
  const userInitial = user.email.charAt(0).toUpperCase()

  return (
    <aside className="sidebar">
      <a className="brand" href="#dashboard" onClick={() => onNavigate('dashboard')}>
        <BrandMark />
        <span className="brand-copy">
          <strong>TripPlanner</strong>
          <span>AI TRAVEL COMPANION</span>
        </span>
      </a>

      <div className="nav-label">MENÚ PRINCIPAL</div>
      <nav className="main-nav" aria-label="Navegación principal">
        {navigation.map((item) => (
          <button
            className={`nav-item ${activePage === item.id ? 'active' : ''}`}
            key={item.id}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-trip-card">
        <div className="trip-card-topline">
          <span className="trip-card-icon"><Icon name="pin" size={16} /></span>
          <span>PRÓXIMO DESTINO</span>
        </div>
        <strong>{isDashboardLoading ? 'Cargando...' : nextTrip?.destination || 'Sin viaje próximo'}</strong>
        {nextTrip && <span className="sidebar-trip-meta">{getTripDayCount(nextTrip)} días · {nextTrip.travelerCount} viajeros</span>}
        <button className="sidebar-trip-link" onClick={() => onNavigate('trips')} type="button">
          Ver mi viaje <Icon name="arrowRight" size={15} />
        </button>
        <div className="trip-card-decoration" aria-hidden="true" />
      </div>

      <div className="sidebar-footer">
        <span className="avatar avatar-small">{userInitial}</span>
        <span className="profile-copy">
          <strong>{user.email}</strong>
          <span>Cuenta autenticada</span>
        </span>
        <button className="icon-button profile-more" onClick={onSignOut} type="button" aria-label="Cerrar sesión" title="Cerrar sesión">
          <Icon name="arrowRight" size={16} />
        </button>
      </div>
    </aside>
  )
}

function Topbar({ page, onNotice, largeText, onToggleTextSize, user, onSignOut }) {
  const details = pageDetails[page]
  return (
    <header className="topbar">
      <div className="topbar-heading">
        <span className="eyebrow">{details.eyebrow}</span>
        <h1>{details.title}</h1>
      </div>
      <div className="topbar-actions">
        <button
          className={`icon-button text-size-button ${largeText ? 'selected' : ''}`}
          type="button"
          aria-label={largeText ? 'Restablecer tamaño del texto' : 'Aumentar tamaño del texto'}
          aria-pressed={largeText}
          title={largeText ? 'Restablecer tamaño del texto' : 'Aumentar tamaño del texto'}
          onClick={onToggleTextSize}
        >
          A+
        </button>
        <label className="global-search">
          <Icon name="search" size={18} />
          <input aria-label="Buscar" placeholder="Busca un destino o viaje" />
          <kbd>⌘ K</kbd>
        </label>
        <button
          className="icon-button notification-button"
          type="button"
          aria-label="Notificaciones"
          onClick={() => onNotice('Las notificaciones estarán disponibles en una etapa posterior.')}
        >
          <Icon name="bell" size={19} />
          <span className="notification-dot" />
        </button>
        <span className="avatar">{user.email.charAt(0).toUpperCase()}</span>
        <button className="sign-out-button" onClick={onSignOut} type="button">Salir</button>
      </div>
    </header>
  )
}

function DemoLabel() {
  return (
    <div className="demo-label">
      <span className="demo-dot" />
      Prototipo visual · Contenido de ejemplo
    </div>
  )
}

function HeroArtwork() {
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="hero-art-orbit orbit-one" />
      <div className="hero-art-orbit orbit-two" />
      <div className="hero-sun" />
      <div className="hero-cloud cloud-one" />
      <div className="hero-cloud cloud-two" />
      <div className="hero-island">
        <PalmTree className="island-palm palm-one" />
        <PalmTree className="island-palm palm-two" />
      </div>
      <div className="hero-route-line" />
      <div className="hero-plane"><Icon name="plane" size={22} strokeWidth={2.2} /></div>
      <span className="art-coordinate coordinate-one">10° 23' N</span>
      <span className="art-coordinate coordinate-two">75° 29' O</span>
    </div>
  )
}

function Button({ children, variant = 'primary', icon, onClick, type = 'button', disabled = false }) {
  return (
    <button className={`button button-${variant}`} disabled={disabled} type={type} onClick={onClick}>
      {icon && <Icon name={icon} size={17} />}
      <span>{children}</span>
    </button>
  )
}

function Dashboard({ onNavigate, dashboardData }) {
  const {
    upcomingTrips,
    nextTrip,
    upcomingPlans,
    reservations,
    isLoading,
    error,
    reservationError,
    reload,
  } = dashboardData
  const budget = nextTrip?.budget
    ? new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: nextTrip.budget.currency,
        maximumFractionDigits: 0,
      }).format(Number(nextTrip.budget.amount))
    : 'No indicado'
  const travelers = upcomingTrips.reduce((total, trip) => total + Number(trip.travelerCount || 0), 0)
  const nextReservation = reservations[0]
  const reservationTrip = upcomingTrips.find((trip) => trip.tripId === nextReservation?.tripId)
  const reservationType = nextReservation?.type === 'flight'
    ? 'Vuelo'
    : nextReservation?.type === 'hotel' ? 'Hotel' : 'Actividad'
  const reservationStatus = nextReservation?.status === 'PENDIENTE'
    ? 'Pendiente'
    : nextReservation?.status === 'SIMULADA' ? 'Simulada' : 'Confirmada'

  return (
    <>
      {error && (
        <section className="panel trip-data-state trip-data-error" role="alert">
          <strong>No se pudo cargar el Dashboard</strong>
          <span>{error}</span>
          <Button variant="outline" onClick={reload}>Intentar de nuevo</Button>
        </section>
      )}
      <section className="welcome-hero">
        <div className="hero-copy">
          <span className="hero-kicker"><span className="hero-kicker-dot" /> TU PRÓXIMA AVENTURA</span>
          <h2>{isLoading ? <>Cargando tus<br /><span>viajes...</span></> : nextTrip ? <>{nextTrip.destination}<br /><span>te espera.</span></> : <>Tu próxima aventura<br /><span>comienza aquí.</span></>}</h2>
          <p>{nextTrip ? `${nextTrip.origin} a ${nextTrip.destination}, del ${nextTrip.startDate} al ${nextTrip.endDate}.` : 'Tus viajes guardados aparecerán aquí para que los tengas a mano.'}</p>
          <Button icon="arrowRight" onClick={() => onNavigate('trips')}>{nextTrip ? 'Explorar mi viaje' : 'Crear un viaje'}</Button>
          <div className="hero-caption">
            <span className="hero-caption-icon"><Icon name="sparkles" size={15} /></span>
            Planea a tu ritmo, desde un solo lugar
          </div>
        </div>
        <HeroArtwork />
        <div className="hero-index"><strong>01</strong><span>/</span><span>03</span></div>
      </section>

      <section className="stats-grid" aria-label="Resumen de viajes">
        <StatCard icon="pin" label="Viajes próximos" value={isLoading || error ? '—' : String(upcomingTrips.length).padStart(2, '0')} note={isLoading ? 'Cargando...' : 'En tu cuenta'} tone="teal" />
        <StatCard icon="calendar" label="Días del próximo viaje" value={isLoading || error ? '—' : String(nextTrip ? getTripDayCount(nextTrip) : 0).padStart(2, '0')} note={nextTrip?.destination || 'Sin viajes próximos'} tone="coral" />
        <StatCard icon="users" label="Viajeros" value={isLoading || error ? '—' : String(travelers).padStart(2, '0')} note="En tus viajes próximos" tone="lavender" />
        <StatCard icon="ticket" label="Reservas próximas" value={isLoading || error || reservationError ? '—' : String(reservations.length).padStart(2, '0')} note={reservationError ? 'No se pudieron cargar todas' : 'En tus viajes próximos'} tone="green" />
      </section>

      <div className="dashboard-grid">
        <section className="panel planner-panel">
          <div className="panel-heading">
            <div>
              <span className="section-eyebrow">TU ASISTENTE PERSONAL</span>
              <h3>¿Qué tienes en mente?</h3>
            </div>
            <span className="assistant-spark"><Icon name="sparkles" size={19} /></span>
          </div>
          <p className="panel-description">Cuéntame tu idea y empecemos a darle forma a tu próximo viaje.</p>
          <div className="prompt-grid">
            <button type="button" onClick={() => onNavigate('flights')} className="prompt-card">
              <span className="prompt-icon prompt-teal"><Icon name="plane" size={17} /></span>
              <span><strong>Quiero buscar vuelos</strong><small>Compara opciones para tu ruta</small></span>
              <Icon name="chevron" size={17} />
            </button>
            <button type="button" onClick={() => onNavigate('weather')} className="prompt-card">
              <span className="prompt-icon prompt-coral"><Icon name="sun" size={17} /></span>
              <span><strong>Consultar el clima</strong><small>Revisa el tiempo en tu destino</small></span>
              <Icon name="chevron" size={17} />
            </button>
          </div>
          <button className="text-link" type="button" onClick={() => onNavigate('assistant')}>
            Abrir asistente <Icon name="arrowRight" size={16} />
          </button>
        </section>

        <section className="panel next-trip-panel">
          <div className="panel-heading">
            <div>
              <span className="section-eyebrow">TU VIAJE MÁS PRÓXIMO</span>
              <h3>{nextTrip ? `${nextTrip.origin} a ${nextTrip.destination}` : 'Aún no hay viajes próximos'}</h3>
            </div>
            <button className="icon-button subtle-icon" type="button" aria-label="Ver viajes" onClick={() => onNavigate('trips')}>
              <Icon name="arrow" size={17} />
            </button>
          </div>
          {nextTrip ? (
            <>
              <div className="route-card">
                <div className="route-city">
                  <span className="route-code">{nextTrip.origin.slice(0, 3).toUpperCase()}</span>
                  <strong>{nextTrip.origin}</strong>
                  <small>Origen</small>
                </div>
                <div className="route-connector"><span /><Icon name="plane" size={17} /><span /></div>
                <div className="route-city destination">
                  <span className="route-code">{nextTrip.destination.slice(0, 3).toUpperCase()}</span>
                  <strong>{nextTrip.destination}</strong>
                  <small>Destino</small>
                </div>
              </div>
              <div className="trip-details-row">
                <span><Icon name="calendar" size={16} /> {nextTrip.startDate} — {nextTrip.endDate}</span>
                <span><Icon name="users" size={16} /> {nextTrip.travelerCount} viajeros</span>
              </div>
              <div className="budget-row">
                <div><span>Presupuesto indicado</span><strong>{budget}</strong></div>
              </div>
            </>
          ) : (
            <p className="itinerary-preview-state">{isLoading ? 'Buscando tus viajes...' : 'Cuando guardes un viaje, verás aquí sus fechas y detalles.'}</p>
          )}
        </section>

        <section className="panel itinerary-preview">
          <div className="panel-heading">
            <div>
              <span className="section-eyebrow">ORGANIZA TU EXPERIENCIA</span>
              <h3>Itinerario</h3>
            </div>
            <button className="text-link compact-link" type="button" onClick={() => onNavigate('trips')}>
              Ver viaje <Icon name="arrowRight" size={15} />
            </button>
          </div>
          {isLoading ? (
            <p className="itinerary-preview-state">Cargando el itinerario...</p>
          ) : upcomingPlans.length ? (
            <div className="dashboard-itinerary-days">
              {upcomingPlans.map(({ trip, itinerary: tripItinerary, error: tripItineraryError }) => (
                <div className="dashboard-itinerary-trip" key={trip.tripId}>
                  <strong>{trip.destination}</strong>
                  {tripItineraryError ? (
                    <span>No se pudo cargar el itinerario.</span>
                  ) : tripItinerary?.days?.length ? (
                    tripItinerary.days.slice(0, 2).map((day) => (
                      <span className="dashboard-itinerary-day" key={day.dayNumber}>
                        <b>Día {day.dayNumber}</b>
                        {day.activities.map((activity) => activity.name).join(' · ') || 'Sin actividades agregadas'}
                      </span>
                    ))
                  ) : (
                    <span>Este viaje aún no tiene itinerario.</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="itinerary-preview-state">No tienes viajes próximos con itinerarios.</p>
          )}
        </section>

        <section className="panel reservation-preview">
          <div className="panel-heading">
            <div>
              <span className="section-eyebrow">GESTIÓN DE RESERVAS</span>
              <h3>{reservations.length ? 'Reservas de tus viajes' : 'Sin reservas próximas'}</h3>
            </div>
            <button className="icon-button subtle-icon" type="button" aria-label="Ver reservas" onClick={() => onNavigate('reservations')}>
              <Icon name="arrow" size={17} />
            </button>
          </div>
          {nextReservation ? (
            <div className="reservation-mini">
              <span className="reservation-icon"><Icon name={nextReservation.type === 'flight' ? 'plane' : nextReservation.type === 'hotel' ? 'pin' : 'sparkles'} size={18} /></span>
              <div className="reservation-mini-copy"><strong>Reserva de {reservationType.toLowerCase()}</strong><span>{reservationTrip ? `${reservationTrip.origin} a ${reservationTrip.destination}` : 'Viaje guardado'}</span></div>
              <span className={`status-pill ${nextReservation.status === 'PENDIENTE' ? 'status-pending' : nextReservation.status === 'CONFIRMADA' ? 'status-confirmed' : 'status-simulated'}`}><span />{reservationStatus}</span>
            </div>
          ) : (
            <p className="itinerary-preview-state">{isLoading ? 'Cargando reservas...' : reservationError ? 'No se pudieron cargar las reservas.' : 'Las reservas de tus viajes próximos aparecerán aquí.'}</p>
          )}
          <button className="text-link" type="button" onClick={() => onNavigate('reservations')}>
            Ver todas las reservas <Icon name="arrowRight" size={16} />
          </button>
        </section>
      </div>
    </>
  )
}
function StatCard({ icon, label, value, note, tone }) {
  return (
    <article className="stat-card">
      <span className={`stat-icon stat-${tone}`}><Icon name={icon} size={19} /></span>
      <div className="stat-content"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
      <span className="stat-arrow"><Icon name="arrow" size={15} /></span>
    </article>
  )
}

function PageIntro({ label, title, description, action }) {
  return (
    <div className="page-intro">
      <div><span className="section-eyebrow">{label}</span><h2>{title}</h2><p>{description}</p></div>
      {action}
    </div>
  )
}

function AssistantPage({ onNavigate }) {
  const [messages, setMessages] = useState([{
    id: 'welcome',
    role: 'assistant',
    text: '¡Hola! Estoy aquí para ayudarte a organizar tu viaje. Cuéntame qué destino tienes en mente y lo planeamos paso a paso.',
  }])
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const chatBodyRef = useRef(null)
  const abortControllerRef = useRef(null)
  const sessionIdRef = useRef('')
  const agentReady = isAgentCoreConfigured() && isCognitoConfigured()

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => () => abortControllerRef.current?.abort(), [])

  const sendMessage = async (event) => {
    event.preventDefault()
    const prompt = draft.trim()
    if (!prompt || isSending) return

    if (!sessionIdRef.current) {
      const createSessionId = globalThis.crypto?.randomUUID
      if (typeof createSessionId !== 'function') {
        setChatError('Este navegador no permite crear una sesión segura para el asistente.')
        return
      }
      sessionIdRef.current = createSessionId.call(globalThis.crypto)
    }

    const createId = globalThis.crypto.randomUUID.bind(globalThis.crypto)
    const userMessageId = createId()
    const assistantMessageId = createId()
    const controller = new AbortController()

    setDraft('')
    setChatError('')
    setMessages((current) => [
      ...current,
      { id: userMessageId, role: 'user', text: prompt },
      { id: assistantMessageId, role: 'assistant', text: '', pending: true },
    ])
    setIsSending(true)
    abortControllerRef.current = controller

    try {
      const receivedText = await invokeAgentCore(prompt, sessionIdRef.current, {
        signal: controller.signal,
        onText: (chunk) => {
          setMessages((current) => current.map((message) => (
            message.id === assistantMessageId
              ? { ...message, text: message.text + chunk, pending: false }
              : message
          )))
        },
      })

      if (!receivedText) {
        throw new Error('El Orchestrator no devolvió texto para esta solicitud.')
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setChatError(error instanceof Error ? error.message : 'No se pudo completar la respuesta del asistente.')
        setMessages((current) => current.filter(
          (message) => message.id !== assistantMessageId || message.text,
        ))
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      if (!controller.signal.aborted) setIsSending(false)
    }
  }

  return (
    <>
      <DemoLabel />
      <PageIntro
        label="TU COMPAÑERO DE VIAJE"
        title="Hagamos espacio para tu próxima aventura."
        description="Conversa con el asistente para explorar ideas de viaje, vuelos y clima."
        action={<span className={`integration-pill ${agentReady ? 'integration-ready' : ''}`}><span />{agentReady ? 'Conectado con AgentCore' : 'Configuración pendiente'}</span>}
      />
      <div className="assistant-workspace">
        <section className="chat-panel panel">
          <div className="chat-header">
            <span className="chat-avatar"><Icon name="sparkles" size={20} /></span>
            <div><strong>TripPlanner Assistant</strong><span><i className={agentReady ? 'is-online' : ''} />{agentReady ? 'Streaming de AgentCore' : 'Asistente sin conexión'}</span></div>
            <span className="preview-tag">STREAMING</span>
          </div>
          <div className="chat-body" ref={chatBodyRef} role="log" aria-live="polite" aria-busy={isSending}>
            <div className="chat-date"><span /> INICIO DE LA CONVERSACIÓN <span /></div>
            {messages.map((message) => (
              message.role === 'user'
                ? <div className="user-message" key={message.id}>{message.text}</div>
                : (
                  <div className="assistant-message" key={message.id}>
                    <span className="message-avatar"><Icon name="sparkles" size={15} /></span>
                    <div className="message-content">
                      <span className="message-author">TripPlanner <small>{message.pending ? 'escribiendo...' : 'ahora'}</small></span>
                      <p>{message.text || (message.pending ? 'Pensando...' : '')}</p>
                      {!message.pending && message.text.includes('Itinerario guardado. Puedes verlo en Mis viajes.') && (
                        <div className="message-result-links">
                          <button onClick={() => onNavigate('trips')} type="button">
                            <Icon name="calendar" size={14} /> Ver en Mis viajes
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
            ))}
          </div>
          {chatError && <p className="chat-error" role="alert">{chatError}</p>}
          <form className="chat-composer" onSubmit={sendMessage}>
            <button className="composer-add" type="button" aria-label="Adjuntar" disabled><Icon name="plus" size={19} /></button>
            <input
              aria-label="Escribe tu mensaje"
              placeholder="Cuéntame qué viaje tienes en mente..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={isSending || !agentReady}
            />
            <span className="composer-hint">Enter para enviar</span>
            <button className="send-button" type="submit" aria-label="Enviar mensaje" disabled={isSending || !agentReady || !draft.trim()}>
              <Icon name="arrowRight" size={19} />
            </button>
          </form>
          <p className="chat-disclaimer">El chat usa Cognito y streaming directo a AgentCore. No compartas datos de pago.</p>
        </section>
        <aside className="assistant-side">
          <TalkingHeadAvatar />
          <section className="assistant-side-card capability-card">
            <span className="section-eyebrow">PUEDO AYUDARTE A</span>
            <button type="button" onClick={() => onNavigate('flights')}><span className="capability-icon teal"><Icon name="plane" size={16} /></span><span>Explorar vuelos</span><Icon name="chevron" size={16} /></button>
            <button type="button" onClick={() => onNavigate('weather')}><span className="capability-icon coral"><Icon name="sun" size={16} /></span><span>Consultar el clima</span><Icon name="chevron" size={16} /></button>
            <button type="button" onClick={() => onNavigate('trips')}><span className="capability-icon blue"><Icon name="calendar" size={16} /></span><span>Organizar un itinerario</span><Icon name="chevron" size={16} /></button>
          </section>
        </aside>
      </div>
    </>
  )
}

function FlightsPage() {
  const [search, setSearch] = useState(initialFlightSearch)
  const [flights, setFlights] = useState([])
  const [responseText, setResponseText] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const sessionIdRef = useRef('')
  const abortControllerRef = useRef(null)
  const agentReady = isAgentCoreConfigured() && isCognitoConfigured()

  useEffect(() => () => abortControllerRef.current?.abort(), [])

  const handleSearchChange = (event) => {
    const { name, value } = event.target
    setSearch((current) => ({ ...current, [name]: value }))
  }

  const handleFlightSearch = async (event) => {
    event.preventDefault()
    if (isSearching) return

    if (!sessionIdRef.current) {
      const createSessionId = globalThis.crypto?.randomUUID
      if (typeof createSessionId !== 'function') {
        setSearchError('Este navegador no permite crear una sesión segura para la búsqueda.')
        return
      }
      sessionIdRef.current = createSessionId.call(globalThis.crypto)
    }

    const prompt = [
      'Busca vuelos solo de ida con datos reales.',
      `Origen: ${search.origin.trim()}.`,
      `Destino: ${search.destination.trim()}.`,
      `Fecha de salida: ${search.departureDate}.`,
      search.returnDate ? `Fecha de regreso: ${search.returnDate}.` : 'Es un viaje solo de ida.',
      `Pasajeros: ${Number(search.travelerCount)} adultos.`,
      'Consulta únicamente al Flight Agent; no consultes clima y no crees reservas.',
      'Muestra solo opciones que devuelva la herramienta, máximo tres. Para cada una indica aerolínea y número de vuelo, horario, duración, precio y moneda, escalas y asientos disponibles cuando existan. No inventes campos faltantes.',
    ].join('\n')
    const controller = new AbortController()

    setIsSearching(true)
    setSearchError('')
    setFlights([])
    setResponseText('')
    setHasSearched(true)
    abortControllerRef.current = controller

    let streamedResponse = ''
    try {
      const receivedText = await invokeAgentCore(prompt, sessionIdRef.current, {
        signal: controller.signal,
        onText: (chunk) => { streamedResponse += chunk },
      })
      if (!receivedText || !streamedResponse.trim()) {
        throw new Error('El asistente no devolvió opciones de vuelo para esta búsqueda.')
      }
      setResponseText(streamedResponse.trim())
      setFlights(parseFlightOptions(streamedResponse))
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setSearchError(error instanceof Error ? error.message : 'No se pudo completar la búsqueda de vuelos.')
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      if (!controller.signal.aborted) setIsSearching(false)
    }
  }

  return (
    <>
      <PageIntro
        label="COMPARA OPCIONES"
        title="El viaje empieza con una ruta."
        description="Consulta vuelos y revisa sus horarios, aerolíneas y precios disponibles."
      />
      <section className="panel search-panel" aria-busy={isSearching}>
        <div className="search-panel-title"><span className="search-panel-icon"><Icon name="plane" size={19} /></span><div><strong>Busca tu vuelo</strong><span>Completa la ruta y las fechas de tu viaje</span></div></div>
        <form className="flight-form" onSubmit={handleFlightSearch}>
          <label className="field"><span>ORIGEN</span><div><Icon name="pin" size={16} /><input autoComplete="off" maxLength={100} name="origin" onChange={handleSearchChange} required value={search.origin} /></div></label>
          <span className="swap-route"><Icon name="arrowRight" size={17} /></span>
          <label className="field"><span>DESTINO</span><div><Icon name="pin" size={16} /><input autoComplete="off" maxLength={100} name="destination" onChange={handleSearchChange} required value={search.destination} /></div></label>
          <label className="field"><span>FECHA DE SALIDA</span><div><Icon name="calendar" size={16} /><input aria-label="Fecha de salida" name="departureDate" onChange={handleSearchChange} required type="date" value={search.departureDate} /></div></label>
          <label className="field"><span>REGRESO (OPCIONAL)</span><div><Icon name="calendar" size={16} /><input aria-label="Fecha de regreso (opcional)" min={search.departureDate || undefined} name="returnDate" onChange={handleSearchChange} type="date" value={search.returnDate} /></div></label>
          <label className="field"><span>PASAJEROS</span><div><Icon name="users" size={16} /><input aria-label="Número de pasajeros" min="1" max="9" name="travelerCount" onChange={handleSearchChange} required type="number" value={search.travelerCount} /></div></label>
          <Button disabled={!agentReady || isSearching} icon="search" type="submit">{isSearching ? 'Buscando...' : 'Buscar vuelos'}</Button>
        </form>
        {!agentReady && <p className="flight-search-note" role="status">Configura Cognito y AgentCore para buscar vuelos.</p>}
      </section>
      {searchError && <section className="flight-search-error" role="alert">{searchError}</section>}
      {isSearching && <section className="panel flight-search-state" role="status"><span className="flight-loading-dot" /> Consultando opciones reales con el Flight Agent...</section>}
      {hasSearched && !isSearching && !searchError && (
        <>
          <div className="results-heading"><div><span className="section-eyebrow">RESULTADOS REALES</span><h3>Opciones para tu ruta</h3></div><span className="sample-note">Datos devueltos por Flight Agent</span></div>
          {flights.length > 0
            ? <div className="flight-results">{flights.map((flight, index) => <FlightResultCard key={`${flight.number}-${index}`} flight={flight} index={index} />)}</div>
            : <section className="panel flight-search-state"><strong>No se pudieron organizar los resultados en tarjetas.</strong><p className="flight-agent-response">{responseText}</p></section>}
        </>
      )}
      <p className="page-footnote">Los vuelos, horarios y precios dependen de la información disponible en la consulta.</p>
    </>
  )
}

function FlightResultCard({ flight, index }) {
  return (
    <article className="flight-card flight-result-card panel">
      <div className="flight-airline-mark"><Icon name="plane" size={18} /></div>
      <div className="flight-airline"><span>AEROLÍNEA Y VUELO</span><strong>{flight.airline || `Opción ${index + 1}`}</strong><small>{flight.kind || 'Resultado del Flight Agent'}</small></div>
      <div className="flight-result-detail"><span>HORARIO</span><strong>{flight.schedule || 'No disponible'}</strong></div>
      <div className="flight-result-detail"><span>DURACIÓN</span><strong>{flight.duration || 'No disponible'}</strong></div>
      <div className="flight-price"><span>PRECIO</span><strong>{flight.price || 'No disponible'}</strong></div>
      {(flight.stops || flight.seats) && <div className="flight-result-meta">{flight.stops && <span>Escalas: {flight.stops}</span>}{flight.seats && <span>Asientos disponibles: {flight.seats}</span>}</div>}
    </article>
  )
}

function WeatherPage() {
  const [destination, setDestination] = useState('Cartagena')
  const [forecastDate, setForecastDate] = useState('')
  const [weatherReport, setWeatherReport] = useState(null)
  const [responseText, setResponseText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const sessionIdRef = useRef('')
  const abortControllerRef = useRef(null)
  const agentReady = isAgentCoreConfigured() && isCognitoConfigured()

  useEffect(() => () => abortControllerRef.current?.abort(), [])

  const handleWeatherSearch = async (event) => {
    event.preventDefault()
    if (isLoading) return

    if (!sessionIdRef.current) {
      const createSessionId = globalThis.crypto?.randomUUID
      if (typeof createSessionId !== 'function') {
        setError('Este navegador no permite crear una sesión segura para la consulta.')
        return
      }
      sessionIdRef.current = createSessionId.call(globalThis.crypto)
    }

    const prompt = [
      `Consulta el pronóstico meteorológico real para ${destination.trim()}.`,
      forecastDate ? `La fecha que me interesa es ${forecastDate}.` : 'Muéstrame el pronóstico disponible para los próximos días.',
      'Usa el Weather Agent y su herramienta meteorológica. No consultes vuelos ni herramientas de negocio.',
      'Presenta cada día que devuelva el MCP en un bloque separado, con un encabezado "### Día 1 — <día y fecha de la herramienta>" y sus temperaturas máxima/mínima, condiciones y probabilidad de lluvia si está disponible. Usa grados Celsius, no inventes datos ni días, y si el MCP no cubre la fecha solicitada, indícalo claramente.',
    ].join('\n')
    const controller = new AbortController()

    setIsLoading(true)
    setError('')
    setWeatherReport(null)
    setResponseText('')
    setHasSearched(true)
    abortControllerRef.current = controller

    let streamedResponse = ''
    try {
      const receivedText = await invokeAgentCore(prompt, sessionIdRef.current, {
        signal: controller.signal,
        onText: (chunk) => { streamedResponse += chunk },
      })
      if (!receivedText || !streamedResponse.trim()) {
        throw new Error('El Weather Agent no devolvió información para esta consulta.')
      }
      setResponseText(streamedResponse.trim())
      setWeatherReport(parseWeatherReport(streamedResponse, destination.trim()))
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') {
        setError(requestError instanceof Error ? requestError.message : 'No se pudo consultar el pronóstico.')
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }

  return (
    <>
      <PageIntro
        label="ANTES DE HACER LAS MALETAS"
        title="Conoce el clima de tu destino."
        description="Consulta el pronóstico real proporcionado por el Weather Agent y su MCP meteorológico."
      />
      <section className="panel weather-search" aria-busy={isLoading}>
        <form className="weather-search-form" onSubmit={handleWeatherSearch}>
          <label className="field"><span>DESTINO</span><div><Icon name="pin" size={16} /><input autoComplete="off" maxLength={100} onChange={(event) => setDestination(event.target.value)} required value={destination} /></div></label>
          <label className="field"><span>FECHA A CONSULTAR (OPCIONAL)</span><div><Icon name="calendar" size={16} /><input aria-label="Fecha a consultar (opcional)" onChange={(event) => setForecastDate(event.target.value)} type="date" value={forecastDate} /></div></label>
          <Button disabled={!agentReady || isLoading} icon="search" type="submit">{isLoading ? 'Consultando...' : 'Consultar clima'}</Button>
        </form>
        <p className="weather-source-note">El MCP ofrece pronóstico de hasta 3 días y no admite fechas específicas. Si la fecha elegida no está cubierta, el agente lo indicará.</p>
        {!agentReady && <p className="weather-source-note" role="status">Configura Cognito y AgentCore para consultar el pronóstico.</p>}
      </section>
      {error && <section className="weather-search-error" role="alert">{error}</section>}
      <section className="weather-preview panel">
        <div className="weather-preview-top">
          <div><span className="section-eyebrow">PRONÓSTICO DEL DESTINO</span><h3>{weatherReport?.destination || (hasSearched ? destination : 'Tu destino')}</h3><span className="weather-coordinates"><Icon name="pin" size={14} />{hasSearched && !error ? 'Consultado mediante Weather Agent' : 'Los datos aparecen después de consultar'}</span></div>
          <span className="weather-main-icon"><Icon name="sun" size={39} /></span>
        </div>
        {isLoading && <div className="weather-empty" role="status"><div className="weather-empty-orbit"><Icon name="sun" size={29} /></div><strong>Consultando el MCP meteorológico…</strong><p>Weather Agent está obteniendo el pronóstico disponible.</p></div>}
        {!isLoading && !hasSearched && <div className="weather-empty"><div className="weather-empty-orbit"><Icon name="sun" size={29} /></div><strong>Consulta el clima de tu destino</strong><p>El pronóstico real aparecerá aquí después de consultar al Weather Agent.</p></div>}
        {!isLoading && hasSearched && !error && weatherReport && (
          <>
            {weatherReport.days.length > 0 ? (
              <div className="weather-forecast-grid">
                {weatherReport.days.map((day, index) => (
                  <article className="weather-day-card" key={`${day.label}-${index}`}>
                    <div className="weather-day-heading">
                      <span className="weather-day-icon"><Icon name="sun" size={19} /></span>
                      <div><span>DÍA {day.number}</span><h4>{day.label}</h4></div>
                    </div>
                    <div className="weather-day-temperatures">
                      {(day.maxTemperature || day.minTemperature) ? (
                        <>
                          <div><span>Máxima</span><strong>{day.maxTemperature || 'No disponible'}</strong></div>
                          <div><span>Mínima</span><strong>{day.minTemperature || 'No disponible'}</strong></div>
                        </>
                      ) : (
                        <div><span>Temperatura</span><strong>{day.temperature || 'No disponible'}</strong></div>
                      )}
                    </div>
                    <div className="weather-day-condition"><span>CONDICIONES</span><strong>{day.conditions || 'No disponible'}</strong></div>
                    {day.rain && <div className="weather-day-rain"><Icon name="weather" size={15} /><span>Probabilidad de lluvia: <strong>{day.rain}</strong></span></div>}
                  </article>
                ))}
              </div>
            ) : (weatherReport.temperature || weatherReport.conditions || weatherReport.rain) ? (
              <div className="weather-summary-card">
                <span className="section-eyebrow">RESUMEN DEVUELTO POR EL AGENTE</span>
                <div className="weather-metrics">
                  <div><span className="metric-small-icon"><Icon name="sun" size={16} /></span><span>Temperatura</span><strong>{weatherReport.temperature || 'No disponible'}</strong></div>
                  <div><span className="metric-small-icon rain"><Icon name="weather" size={16} /></span><span>Probabilidad de lluvia</span><strong>{weatherReport.rain || 'No disponible'}</strong></div>
                  <div><span className="metric-small-icon"><Icon name="clock" size={16} /></span><span>Condiciones</span><strong>{weatherReport.conditions || 'No disponible'}</strong></div>
                </div>
                <p>El agente devolvió un resumen sin datos separados por día.</p>
              </div>
            ) : (
              <div className="weather-empty"><strong>El MCP no devolvió un pronóstico diario estructurado.</strong><p>Consulta la respuesta del Weather Agent para ver el detalle disponible.</p></div>
            )}
            <details className="weather-agent-response">
              <summary>Ver respuesta del Weather Agent</summary>
              <p>{responseText}</p>
            </details>
          </>
        )}
      </section>
    </>
  )
}

function PreferencesPage({ onNotice }) {
  const [preferences, setPreferences] = useState(defaultTravelPreferences)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setLoadError('')
    getPreferences()
      .then((savedPreferences) => {
        if (active) setPreferences(savedPreferences ?? defaultTravelPreferences)
      })
      .catch((requestError) => {
        if (active) setLoadError(requestError.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [reloadCount])

  const toggleInterest = (interest, checked) => {
    setPreferences((current) => ({
      ...current,
      interests: checked
        ? [...current.interests, interest]
        : current.interests.filter((value) => value !== interest),
    }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setError('')
    setIsSaving(true)
    try {
      const savedPreferences = await savePreferences(preferences)
      setPreferences(savedPreferences)
      onNotice('Tus preferencias de viaje se guardaron correctamente.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <PageIntro
        label="TU FORMA DE VIAJAR"
        title="Preferencias de viaje"
        description="Guarda tus intereses y estilo para adaptar futuros itinerarios a lo que disfrutas."
      />
      <section className="panel preferences-panel" aria-labelledby="travel-preferences-title">
        <div className="preferences-heading">
          <span className="preferences-icon"><Icon name="sliders" size={19} /></span>
          <div>
            <span className="section-eyebrow">PERFIL DE VIAJE</span>
            <h3 id="travel-preferences-title">¿Qué prefieres al viajar?</h3>
          </div>
        </div>
        {isLoading ? (
          <p className="preferences-state" role="status">Cargando tus preferencias...</p>
        ) : loadError ? (
          <div className="preferences-load-error" role="alert">
            <p>{loadError}</p>
            <Button variant="outline" onClick={() => setReloadCount((count) => count + 1)}>Intentar de nuevo</Button>
          </div>
        ) : (
          <form className="preferences-form" onSubmit={handleSave}>
            <fieldset className="preference-fieldset">
              <legend>Intereses</legend>
              <p>Elige los temas que te gustaría priorizar en tus itinerarios.</p>
              <div className="preference-options">
                {travelInterestOptions.map((interest) => (
                  <label className="preference-option" key={interest.value}>
                    <input
                      checked={preferences.interests.includes(interest.value)}
                      disabled={isSaving}
                      onChange={(event) => toggleInterest(interest.value, event.target.checked)}
                      type="checkbox"
                    />
                    <span>{interest.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="preference-selects">
              <label className="trip-form-field">
                <span>RITMO DEL VIAJE</span>
                <select disabled={isSaving} onChange={(event) => setPreferences((current) => ({ ...current, travelPace: event.target.value }))} value={preferences.travelPace}>
                  <option value="relaxed">Tranquilo · tiempo libre</option>
                  <option value="balanced">Equilibrado · variedad</option>
                  <option value="active">Activo · varias actividades</option>
                </select>
              </label>
              <label className="trip-form-field">
                <span>NIVEL DE PRESUPUESTO</span>
                <select disabled={isSaving} onChange={(event) => setPreferences((current) => ({ ...current, budgetStyle: event.target.value }))} value={preferences.budgetStyle}>
                  <option value="economy">Económico</option>
                  <option value="balanced">Intermedio</option>
                  <option value="comfort">Confort</option>
                </select>
              </label>
            </div>
            {error && <p className="preferences-error" role="alert">{error}</p>}
            <div className="preferences-actions">
              <span>Se guardan de forma privada en tu cuenta.</span>
              <button className="button button-primary" disabled={isSaving} type="submit">
                <Icon name="check" size={17} />
                <span>{isSaving ? 'Guardando...' : 'Guardar preferencias'}</span>
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  )
}

function TripsPage({ onNotice }) {
  const [trips, setTrips] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [tripForm, setTripForm] = useState(initialTripForm)
  const [createError, setCreateError] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [itineraryTripId, setItineraryTripId] = useState(null)

  useEffect(() => {
    let active = true

    setIsLoading(true)
    setError('')
    getTrips()
      .then((result) => {
        if (active) setTrips(result)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [reloadCount])

  const handleCreateTrip = async (event) => {
    event.preventDefault()
    setCreateError('')
    setIsCreating(true)

    try {
      const trip = await createTrip({
        origin: tripForm.origin.trim(),
        destination: tripForm.destination.trim(),
        startDate: tripForm.startDate,
        endDate: tripForm.endDate,
        travelerCount: Number(tripForm.travelerCount),
        budget: {
          amount: Number(tripForm.budgetAmount),
          currency: tripForm.currency,
        },
      })

      setTrips((currentTrips) => [trip, ...currentTrips])
      setTripForm(initialTripForm)
      setShowCreateForm(false)
      onNotice('Tu viaje se guardó correctamente.')
    } catch (requestError) {
      setCreateError(requestError.message)
    } finally {
      setIsCreating(false)
    }
  }

  const handleTripFormChange = (event) => {
    const { name, value } = event.target
    setTripForm((currentForm) => ({
      ...currentForm,
      [name]: name === 'currency' ? value.toUpperCase() : value,
    }))
  }

  const closeCreateForm = () => {
    setShowCreateForm(false)
    setTripForm(initialTripForm)
    setCreateError('')
  }

  return (
    <>
      <PageIntro
        label="DATOS GUARDADOS EN TU CUENTA"
        title="Mis viajes"
        description="Estos viajes se consultan desde la API y pertenecen a tu cuenta autenticada."
        action={(
          <Button
            icon={showCreateForm ? 'close' : 'plus'}
            disabled={isCreating}
            onClick={() => (showCreateForm ? closeCreateForm() : setShowCreateForm(true))}
          >
            {showCreateForm ? 'Cancelar' : 'Crear viaje'}
          </Button>
        )}
      />
      {showCreateForm && (
        <section className="panel trip-create-panel" aria-labelledby="create-trip-title">
          <div className="trip-create-heading">
            <div>
              <span className="section-eyebrow">NUEVO PLAN</span>
              <h3 id="create-trip-title">Cuéntanos sobre tu viaje</h3>
            </div>
            <span className="trip-create-icon"><Icon name="pin" size={18} /></span>
          </div>
          <form className="trip-create-form" onSubmit={handleCreateTrip}>
            <label className="trip-form-field">
              <span>ORIGEN</span>
              <input autoComplete="address-level2" maxLength={100} name="origin" onChange={handleTripFormChange} required value={tripForm.origin} />
            </label>
            <label className="trip-form-field">
              <span>DESTINO</span>
              <input autoComplete="off" maxLength={100} name="destination" onChange={handleTripFormChange} required value={tripForm.destination} />
            </label>
            <label className="trip-form-field">
              <span>FECHA DE INICIO</span>
              <input name="startDate" onChange={handleTripFormChange} required type="date" value={tripForm.startDate} />
            </label>
            <label className="trip-form-field">
              <span>FECHA DE REGRESO</span>
              <input min={tripForm.startDate || undefined} name="endDate" onChange={handleTripFormChange} required type="date" value={tripForm.endDate} />
            </label>
            <label className="trip-form-field">
              <span>NÚMERO DE VIAJEROS</span>
              <input min="1" name="travelerCount" onChange={handleTripFormChange} required step="1" type="number" value={tripForm.travelerCount} />
            </label>
            <div className="trip-budget-fields">
              <label className="trip-form-field">
                <span>PRESUPUESTO</span>
                <input min="0" name="budgetAmount" onChange={handleTripFormChange} required step="0.01" type="number" value={tripForm.budgetAmount} />
              </label>
              <label className="trip-form-field">
                <span>MONEDA</span>
                <input autoComplete="off" maxLength="3" name="currency" onChange={handleTripFormChange} pattern="[A-Z]{3}" required title="Escribe el código de tres letras, por ejemplo COP." value={tripForm.currency} />
              </label>
            </div>
            {createError && <p className="trip-create-error" role="alert">{createError}</p>}
            <div className="trip-create-actions">
              <button className="button button-outline" disabled={isCreating} onClick={closeCreateForm} type="button">Cancelar</button>
              <button className="button button-primary" disabled={isCreating} type="submit">
                <Icon name="check" size={17} />
                <span>{isCreating ? 'Guardando...' : 'Guardar viaje'}</span>
              </button>
            </div>
          </form>
        </section>
      )}
      {isLoading && <section className="panel trip-data-state" role="status">Cargando tus viajes...</section>}
      {!isLoading && error && (
        <section className="panel trip-data-state trip-data-error" role="alert">
          <strong>No pudimos cargar tus viajes.</strong>
          <span>{error}</span>
          <Button variant="outline" onClick={() => setReloadCount((count) => count + 1)}>Intentar de nuevo</Button>
        </section>
      )}
      {!isLoading && !error && trips.length === 0 && (
        <section className="panel trip-data-state">
          <span className="empty-icon"><Icon name="pin" size={20} /></span>
          <strong>Aún no tienes viajes guardados</strong>
          <span>Cuando crees un viaje, aparecerá aquí asociado a tu cuenta.</span>
        </section>
      )}
      {!isLoading && !error && trips.map((trip, index) => {
        const budget = new Intl.NumberFormat('es-CO', {
          style: 'currency',
          currency: trip.budget.currency,
          maximumFractionDigits: 0,
        }).format(Number(trip.budget.amount))

        return (
          <div className="trip-record" key={trip.tripId}>
            <article className="trip-large-card panel">
              <div className="trip-cover">
                <span className="cover-tag"><span /> VIAJE GUARDADO</span>
                <div className="cover-destination"><span>PLAN DE VIAJE</span><strong>{trip.destination}</strong><small>{trip.startDate} — {trip.endDate}</small></div>
                <div className="cover-art" aria-hidden="true"><div className="cover-sun" /><div className="cover-horizon" /><PalmTree className="cover-palm" /></div>
                <span className="cover-index">{String(index + 1).padStart(2, '0')}</span>
              </div>
              <div className="trip-large-details">
                <div className="trip-overview">
                  <div><span className="section-eyebrow">RESUMEN DEL VIAJE</span><h3>{trip.origin} <span>→</span> {trip.destination}</h3></div>
                  <span className="trip-status"><i /> En planificación</span>
                </div>
                <div className="trip-info-grid">
                  <div><span><Icon name="calendar" size={16} /> FECHAS</span><strong>{trip.startDate} — {trip.endDate}</strong></div>
                  <div><span><Icon name="users" size={16} /> VIAJEROS</span><strong>{trip.travelerCount} personas</strong></div>
                  <div><span><Icon name="ticket" size={16} /> PRESUPUESTO</span><strong>{budget}</strong></div>
                </div>
                <div className="trip-card-actions">
                  <span className="trip-data-note">Guardado en tu cuenta</span>
                  <Button
                    variant="outline"
                    icon="calendar"
                    onClick={() => setItineraryTripId((current) => current === trip.tripId ? null : trip.tripId)}
                  >
                    {itineraryTripId === trip.tripId ? 'Cerrar itinerario' : 'Ver itinerario'}
                  </Button>
                </div>
              </div>
            </article>
            {itineraryTripId === trip.tripId && <ItineraryEditor trip={trip} onNotice={onNotice} />}
          </div>
        )
      })}
    </>
  )
}

function ItineraryEditor({ trip, onNotice }) {
  const dayCount = getTripDayCount(trip)
  const [days, setDays] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let active = true

    setIsLoading(true)
    setError('')
    getItinerary(trip.tripId)
      .then((itinerary) => {
        if (active) setDays(itinerary?.days ?? [])
      })
      .catch((requestError) => {
        if (active) setError(requestError.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [trip.tripId, reloadCount])

  const addDay = () => {
    const existingDays = new Set(days.map((day) => day.dayNumber))
    let nextDayNumber = 1
    while (nextDayNumber <= dayCount && existingDays.has(nextDayNumber)) nextDayNumber += 1
    if (nextDayNumber > dayCount) return

    setDays((currentDays) => [...currentDays, { dayNumber: nextDayNumber, activities: [] }]
      .sort((left, right) => left.dayNumber - right.dayNumber))
    setSaveError('')
  }

  const removeDay = (dayNumber) => {
    setDays((currentDays) => currentDays.filter((day) => day.dayNumber !== dayNumber))
    setSaveError('')
  }

  const addActivity = (dayNumber) => {
    setDays((currentDays) => currentDays.map((day) => (
      day.dayNumber === dayNumber
        ? { ...day, activities: [...day.activities, { name: '' }] }
        : day
    )))
    setSaveError('')
  }

  const updateActivity = (dayNumber, activityIndex, name) => {
    setDays((currentDays) => currentDays.map((day) => (
      day.dayNumber === dayNumber
        ? {
            ...day,
            activities: day.activities.map((activity, index) => (
              index === activityIndex ? { ...activity, name } : activity
            )),
          }
        : day
    )))
    setSaveError('')
  }

  const removeActivity = (dayNumber, activityIndex) => {
    setDays((currentDays) => currentDays.map((day) => (
      day.dayNumber === dayNumber
        ? { ...day, activities: day.activities.filter((_, index) => index !== activityIndex) }
        : day
    )))
    setSaveError('')
  }

  const handleSave = async () => {
    setSaveError('')
    if (days.length === 0) {
      setSaveError('Agrega al menos un día para guardar el itinerario.')
      return
    }

    setIsSaving(true)
    const cleanDays = days.map((day) => ({
      dayNumber: day.dayNumber,
      activities: day.activities
        .map((activity) => activity.name.trim())
        .filter(Boolean)
        .map((name) => ({ name })),
    }))

    try {
      const itinerary = await saveItinerary(trip.tripId, cleanDays)
      setDays(itinerary.days)
      onNotice('El itinerario se guardó correctamente.')
    } catch (requestError) {
      setSaveError(requestError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="panel itinerary-editor" aria-label={`Itinerario de ${trip.destination}`}>
      <div className="itinerary-editor-heading">
        <div>
          <span className="section-eyebrow">PLAN POR DÍAS</span>
          <h3>Itinerario · {trip.destination}</h3>
        </div>
        <span className="itinerary-day-count">{dayCount} {dayCount === 1 ? 'día' : 'días'} de viaje</span>
      </div>

      {isLoading && <p className="itinerary-editor-state" role="status">Cargando itinerario...</p>}
      {!isLoading && error && (
        <div className="itinerary-editor-error" role="alert">
          <span>{error}</span>
          <Button variant="outline" onClick={() => setReloadCount((count) => count + 1)}>Intentar de nuevo</Button>
        </div>
      )}
      {!isLoading && !error && (
        <>
          {days.length === 0 && (
            <p className="itinerary-editor-state">Aún no hay días organizados. Añade un día para empezar.</p>
          )}
          <div className="itinerary-days">
            {days.map((day) => (
              <article className="itinerary-day" key={day.dayNumber}>
                <div className="itinerary-day-heading">
                  <div><strong>Día {day.dayNumber}</strong><span>{formatItineraryDay(trip.startDate, day.dayNumber)}</span></div>
                  <button
                    aria-label={`Quitar día ${day.dayNumber}`}
                    className="itinerary-remove-button"
                    disabled={isSaving}
                    onClick={() => removeDay(day.dayNumber)}
                    type="button"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
                {day.activities.map((activity, index) => (
                  <div className="itinerary-activity" key={`${day.dayNumber}-${index}`}>
                    <input
                      aria-label={`Actividad ${index + 1} del día ${day.dayNumber}`}
                      disabled={isSaving}
                      maxLength={200}
                      onChange={(event) => updateActivity(day.dayNumber, index, event.target.value)}
                      placeholder="Nombre de la actividad"
                      value={activity.name}
                    />
                    <button
                      aria-label={`Quitar actividad ${index + 1} del día ${day.dayNumber}`}
                      className="itinerary-remove-button"
                      disabled={isSaving}
                      onClick={() => removeActivity(day.dayNumber, index)}
                      type="button"
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                ))}
                <button className="itinerary-add-activity" disabled={isSaving} onClick={() => addActivity(day.dayNumber)} type="button">
                  <Icon name="plus" size={15} /> Añadir actividad
                </button>
              </article>
            ))}
          </div>
          {saveError && <p className="trip-create-error" role="alert">{saveError}</p>}
          <div className="itinerary-editor-actions">
            <button
              className="button button-outline"
              disabled={isSaving || days.length >= dayCount}
              onClick={addDay}
              type="button"
            >
              <Icon name="plus" size={16} />
              <span>Añadir día</span>
            </button>
            <button
              className="button button-primary"
              disabled={isSaving || isLoading || Boolean(error) || days.length === 0}
              onClick={handleSave}
              type="button"
            >
              <Icon name="check" size={17} />
              <span>{isSaving ? 'Guardando...' : 'Guardar itinerario'}</span>
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function ReservationsPage({ onNotice, onNavigate }) {
  const [trips, setTrips] = useState([])
  const [selectedTripId, setSelectedTripId] = useState('')
  const [reservations, setReservations] = useState([])
  const [reservationType, setReservationType] = useState('flight')
  const [isLoadingTrips, setIsLoadingTrips] = useState(true)
  const [isLoadingReservations, setIsLoadingReservations] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [updatingReservationId, setUpdatingReservationId] = useState('')
  const [tripsError, setTripsError] = useState('')
  const [reservationsError, setReservationsError] = useState('')
  const [tripReloadCount, setTripReloadCount] = useState(0)
  const [reservationReloadCount, setReservationReloadCount] = useState(0)
  const [reservationActionError, setReservationActionError] = useState('')

  useEffect(() => {
    let active = true

    setIsLoadingTrips(true)
    setTripsError('')
    getTrips()
      .then((result) => {
        if (!active) return
        setTrips(result)
        setSelectedTripId((currentTripId) => (
          result.some((trip) => trip.tripId === currentTripId)
            ? currentTripId
            : result[0]?.tripId || ''
        ))
      })
      .catch((requestError) => {
        if (active) setTripsError(requestError.message)
      })
      .finally(() => {
        if (active) setIsLoadingTrips(false)
      })

    return () => {
      active = false
    }
  }, [tripReloadCount])

  useEffect(() => {
    if (!selectedTripId) {
      setReservations([])
      setReservationsError('')
      setIsLoadingReservations(false)
      return undefined
    }

    let active = true

    setIsLoadingReservations(true)
    setReservationsError('')
    getReservations(selectedTripId)
      .then((result) => {
        if (active) setReservations(result)
      })
      .catch((requestError) => {
        if (active) setReservationsError(requestError.message)
      })
      .finally(() => {
        if (active) setIsLoadingReservations(false)
      })

    return () => {
      active = false
    }
  }, [selectedTripId, reservationReloadCount])

  const handleCreateReservation = async (event) => {
    event.preventDefault()
    setReservationActionError('')
    setIsCreating(true)

    try {
      const reservation = await createReservation(selectedTripId, reservationType)
      setReservations((currentReservations) => [reservation, ...currentReservations])
      onNotice('La reserva simulada se guardó correctamente.')
    } catch (requestError) {
      setReservationActionError(requestError.message)
    } finally {
      setIsCreating(false)
    }
  }

  const handleStatusChange = async (reservation, status) => {
    setReservationActionError('')
    setUpdatingReservationId(reservation.reservationId)

    try {
      const updatedReservation = await updateReservation(
        selectedTripId,
        reservation.reservationId,
        status,
      )
      setReservations((currentReservations) => currentReservations.map((currentReservation) => (
        currentReservation.reservationId === updatedReservation.reservationId
          ? updatedReservation
          : currentReservation
      )))
      onNotice('El estado de la reserva se actualizó.')
    } catch (requestError) {
      setReservationActionError(requestError.message)
    } finally {
      setUpdatingReservationId('')
    }
  }

  const selectedTrip = trips.find((trip) => trip.tripId === selectedTripId)
  const simulatedCount = reservations.filter((reservation) => reservation.status === 'SIMULADA').length
  const pendingCount = reservations.filter((reservation) => reservation.status === 'PENDIENTE').length
  const confirmedCount = reservations.filter((reservation) => reservation.status === 'CONFIRMADA').length

  return (
    <>
      <PageIntro
        label="RESERVAS DE TU VIAJE"
        title="Tus reservas, bien organizadas."
        description="Registra reservas simuladas y consulta su estado por viaje."
      />
      {isLoadingTrips && <section className="panel trip-data-state" role="status">Cargando tus viajes...</section>}
      {!isLoadingTrips && tripsError && (
        <section className="panel trip-data-state trip-data-error" role="alert">
          <strong>No pudimos cargar tus viajes.</strong>
          <span>{tripsError}</span>
          <Button variant="outline" onClick={() => setTripReloadCount((count) => count + 1)}>Intentar de nuevo</Button>
        </section>
      )}
      {!isLoadingTrips && !tripsError && trips.length === 0 && (
        <section className="panel trip-data-state">
          <span className="empty-icon"><Icon name="pin" size={20} /></span>
          <strong>Primero crea un viaje</strong>
          <span>Las reservas deben estar asociadas a uno de tus viajes.</span>
          <Button variant="outline" onClick={() => onNavigate('trips')}>Ir a mis viajes</Button>
        </section>
      )}
      {!isLoadingTrips && !tripsError && trips.length > 0 && (
        <>
          <section className="panel reservation-create-panel">
            <form className="reservation-create-form" onSubmit={handleCreateReservation}>
              <label className="reservation-select-field">
                <span>VIAJE</span>
                <select
                  disabled={isCreating || Boolean(updatingReservationId)}
                  onChange={(event) => {
                    setSelectedTripId(event.target.value)
                    setReservationActionError('')
                  }}
                  value={selectedTripId}
                >
                  {trips.map((trip) => (
                    <option key={trip.tripId} value={trip.tripId}>
                      {trip.origin} → {trip.destination}
                    </option>
                  ))}
                </select>
              </label>
              <label className="reservation-select-field">
                <span>TIPO DE RESERVA SIMULADA</span>
                <select
                  disabled={isCreating}
                  onChange={(event) => setReservationType(event.target.value)}
                  value={reservationType}
                >
                  <option value="flight">Vuelo</option>
                  <option value="hotel">Hotel</option>
                  <option value="activity">Actividad</option>
                </select>
              </label>
              <button className="button button-primary" disabled={isCreating || !selectedTripId} type="submit">
                <Icon name="plus" size={17} />
                <span>{isCreating ? 'Guardando...' : 'Registrar reserva'}</span>
              </button>
            </form>
            <p className="reservation-create-note">Se registra como simulada; no contacta proveedores ni solicita datos de pago.</p>
          </section>

          <section className="reservation-summary-grid">
            <div className="summary-status"><span className="summary-status-icon status-simulated-icon"><Icon name="ticket" size={18} /></span><span>Simuladas</span><strong>{String(simulatedCount).padStart(2, '0')}</strong></div>
            <div className="summary-status"><span className="summary-status-icon status-pending-icon"><Icon name="clock" size={18} /></span><span>Pendientes</span><strong>{String(pendingCount).padStart(2, '0')}</strong></div>
            <div className="summary-status"><span className="summary-status-icon status-confirmed-icon"><Icon name="check" size={18} /></span><span>Confirmadas</span><strong>{String(confirmedCount).padStart(2, '0')}</strong></div>
          </section>

          <section className="panel reservations-table-panel">
            <div className="table-heading">
              <div><span className="section-eyebrow">LISTADO</span><h3>{selectedTrip ? `${selectedTrip.origin} → ${selectedTrip.destination}` : 'Reservas del viaje'}</h3></div>
              <span className="table-filter">{reservations.length} {reservations.length === 1 ? 'reserva' : 'reservas'}</span>
            </div>
            {reservationsError && (
              <div className="reservation-error" role="alert">
                <span>{reservationsError}</span>
                <Button variant="outline" onClick={() => setReservationReloadCount((count) => count + 1)}>Volver a cargar</Button>
              </div>
            )}
            {reservationActionError && <p className="reservation-error-message" role="alert">{reservationActionError}</p>}
            {isLoadingReservations && <p className="reservation-list-state" role="status">Cargando reservas...</p>}
            {!isLoadingReservations && !reservationsError && reservations.length === 0 && (
              <p className="reservation-list-state">Este viaje aún no tiene reservas.</p>
            )}
            {!isLoadingReservations && !reservationsError && reservations.length > 0 && (
              <div className="reservation-table-wrap">
                <table className="reservation-table">
                  <thead><tr><th>RESERVA</th><th>TIPO</th><th>ESTADO</th><th>ACTUALIZAR ESTADO</th></tr></thead>
                  <tbody>
                    {reservations.map((reservation) => (
                      <tr key={reservation.reservationId}>
                        <td>
                          <span className="table-booking">
                            <span className="table-booking-icon"><Icon name={reservation.type === 'flight' ? 'plane' : reservation.type === 'hotel' ? 'pin' : 'sparkles'} size={17} /></span>
                            <span><strong>Reserva simulada</strong><small>{reservation.reservationId.slice(0, 8)}</small></span>
                          </span>
                        </td>
                        <td><span className="type-pill">{reservation.type === 'flight' ? 'Vuelo' : reservation.type === 'hotel' ? 'Hotel' : 'Actividad'}</span></td>
                        <td>
                          <span className={`status-pill ${reservation.status === 'PENDIENTE' ? 'status-pending' : 'status-simulated'}`}>
                            <span />{reservation.status === 'PENDIENTE' ? 'Pendiente' : reservation.status === 'SIMULADA' ? 'Simulada' : 'Confirmada'}
                          </span>
                        </td>
                        <td>
                          <select
                            aria-label={`Cambiar estado de la reserva ${reservation.reservationId.slice(0, 8)}`}
                            className="reservation-status-select"
                            disabled={Boolean(updatingReservationId)}
                            onChange={(event) => handleStatusChange(reservation, event.target.value)}
                            value={reservation.status}
                          >
                            <option value="SIMULADA">Simulada</option>
                            <option value="PENDIENTE">Pendiente</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className="reservation-note"><span className="reservation-note-icon"><Icon name="sparkles" size={17} /></span><p><strong>Reserva simulada</strong> significa que fue registrada por el sistema sin intervención de un proveedor externo. La confirmación real queda deshabilitada hasta integrar un proveedor.</p></div>
        </>
      )}
    </>
  )
}

function Toast({ message, onClose }) {
  if (!message) return null
  return (
    <div className="toast" role="status">
      <span className="toast-icon"><Icon name="sparkles" size={17} /></span>
      <span>{message}</span>
      <button type="button" aria-label="Cerrar aviso" onClick={onClose}><Icon name="close" size={16} /></button>
    </div>
  )
}

function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [notice, setNotice] = useState('')
  const [largeText, setLargeText] = useState(false)
  const [authUser, setAuthUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const dashboardData = useDashboardData(activePage, Boolean(authUser))

  useEffect(() => {
    let active = true

    if (!isCognitoConfigured()) {
      setAuthReady(true)
      return () => {
        active = false
      }
    }

    restoreSession()
      .then((user) => {
        if (active) setAuthUser(user)
      })
      .catch((error) => {
        if (active) setAuthError(`No se pudo restaurar la sesión: ${error.message}`)
      })
      .finally(() => {
        if (active) setAuthReady(true)
      })

    return () => {
      active = false
    }
  }, [])

  const showNotice = (message) => {
    setNotice(message)
    window.clearTimeout(showNotice.timeout)
    showNotice.timeout = window.setTimeout(() => setNotice(''), 4200)
  }

  const handleSignOut = () => {
    signOut()
    setAuthUser(null)
    setActivePage('dashboard')
  }

  if (!authReady) {
    return <main className="auth-page" role="status"><p>Comprobando tu sesión...</p></main>
  }

  if (!authUser) {
    return (
      <AuthPage
        configured={isCognitoConfigured()}
        initialError={authError}
        onAuthenticated={(user) => {
          setAuthError('')
          setAuthUser(user)
        }}
      />
    )
  }

  return (
    <div className={`app-shell ${largeText ? 'font-large' : ''}`}>
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        user={authUser}
        onSignOut={handleSignOut}
        nextTrip={dashboardData.nextTrip}
        isDashboardLoading={dashboardData.isLoading}
      />
      <main className="main-area">
        <Topbar
          page={activePage}
          onNotice={showNotice}
          largeText={largeText}
          onToggleTextSize={() => setLargeText((current) => !current)}
          user={authUser}
          onSignOut={handleSignOut}
        />
        <div className="page-content">
          {activePage === 'dashboard' && <Dashboard onNavigate={setActivePage} dashboardData={dashboardData} />}
          {activePage === 'assistant' && <AssistantPage onNavigate={setActivePage} />}
          {activePage === 'flights' && <FlightsPage />}
          {activePage === 'weather' && <WeatherPage />}
          {activePage === 'trips' && <TripsPage onNotice={showNotice} />}
          {activePage === 'reservations' && <ReservationsPage onNavigate={setActivePage} onNotice={showNotice} />}
          {activePage === 'preferences' && <PreferencesPage onNotice={showNotice} />}
          <footer className="page-footer"><span>TripPlanner AI</span><span>Planea, organiza y disfruta el camino.</span></footer>
        </div>
      </main>
      <Toast message={notice} onClose={() => setNotice('')} />
    </div>
  )
}

export default App
