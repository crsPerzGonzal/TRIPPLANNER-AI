import { useState } from 'react'
import {
  confirmSignUp,
  resendConfirmationCode,
  signIn,
  signUp,
} from '../../services/cognito.js'
import './AuthPage.css'

const authErrorMessages = {
  CodeMismatchException: 'El código no coincide. Revisa el correo e inténtalo de nuevo.',
  ExpiredCodeException: 'El código venció. Solicita uno nuevo para continuar.',
  InvalidPasswordException: 'La contraseña debe tener al menos 12 caracteres e incluir mayúscula, minúscula, número y símbolo.',
  LimitExceededException: 'Se alcanzó el límite de intentos. Espera un momento antes de volver a intentarlo.',
  NotAuthorizedException: 'El correo o la contraseña no son correctos.',
  TooManyRequestsException: 'Hay demasiadas solicitudes. Espera un momento y vuelve a intentarlo.',
  UserNotConfirmedException: 'Confirma tu correo con el código que te enviamos.',
  UsernameExistsException: 'Ya existe una cuenta con ese correo. Inicia sesión o confirma tu cuenta.',
}

function getErrorMessage(error) {
  return authErrorMessages[error?.code] || error?.message || 'No se pudo completar la solicitud. Inténtalo de nuevo.'
}

function BrandMark() {
  return (
    <span className="auth-brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="m3 11 18-7-7 18-3-8-8-3Zm8 3 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    </span>
  )
}

function AuthPage({ configured, initialError, onAuthenticated }) {
  const [mode, setMode] = useState('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState(initialError || '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const runAction = async (action) => {
    setError('')
    setMessage('')
    setIsSubmitting(true)

    try {
      await action()
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()

    if (mode === 'signIn') {
      runAction(async () => {
        const user = await signIn(email, password)
        setPassword('')
        onAuthenticated(user)
      })
      return
    }

    if (mode === 'signUp') {
      runAction(async () => {
        await signUp(email, password)
        setPassword('')
        setMode('confirm')
        setMessage('Te enviamos un código de verificación a tu correo.')
      })
      return
    }

    runAction(async () => {
      await confirmSignUp(email, code)
      setCode('')
      setMode('signIn')
      setMessage('Correo verificado. Ya puedes iniciar sesión.')
    })
  }

  const handleResendCode = () => {
    runAction(async () => {
      await resendConfirmationCode(email)
      setMessage('Enviamos un nuevo código de verificación.')
    })
  }

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setError('')
    setMessage('')
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <a className="auth-brand" href="#inicio">
          <BrandMark />
          <span><strong>TripPlanner</strong><small>AI TRAVEL COMPANION</small></span>
        </a>

        <div className="auth-heading">
          <span className="auth-eyebrow">TU PRÓXIMA AVENTURA</span>
          <h1 id="auth-title">
            {mode === 'signUp' ? 'Crea tu cuenta' : mode === 'confirm' ? 'Verifica tu correo' : 'Qué bueno verte'}
          </h1>
          <p>
            {mode === 'signUp'
              ? 'Regístrate para empezar a organizar tus viajes.'
              : mode === 'confirm'
                ? `Ingresa el código que enviamos a ${email}.`
                : 'Inicia sesión para continuar con tus planes de viaje.'}
          </p>
        </div>

        {!configured && (
          <div className="auth-alert auth-error" role="alert">
            Faltan las variables de Cognito en <code>frontend/.env.local</code>. Reinicia Vite después de configurarlas.
          </div>
        )}
        {error && <div className="auth-alert auth-error" role="alert">{error}</div>}
        {message && <div className="auth-alert auth-success" role="status">{message}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode !== 'confirm' && (
            <label>
              <span>Correo electrónico</span>
              <input
                autoComplete="email"
                autoFocus
                disabled={!configured || isSubmitting}
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
          )}

          {mode !== 'confirm' && (
            <label>
              <span>Contraseña</span>
              <input
                autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                disabled={!configured || isSubmitting}
                minLength={mode === 'signUp' ? 12 : undefined}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
              {mode === 'signUp' && (
                <small className="auth-hint">Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo.</small>
              )}
            </label>
          )}

          {mode === 'confirm' && (
            <>
              <label>
                <span>Correo electrónico</span>
                <input autoComplete="email" disabled value={email} />
              </label>
              <label>
                <span>Código de verificación</span>
                <input
                  autoComplete="one-time-code"
                  disabled={!configured || isSubmitting}
                  inputMode="numeric"
                  onChange={(event) => setCode(event.target.value)}
                  required
                  value={code}
                />
              </label>
            </>
          )}

          <button className="auth-submit" disabled={!configured || isSubmitting} type="submit">
            {isSubmitting
              ? 'Un momento...'
              : mode === 'signUp'
                ? 'Crear cuenta'
                : mode === 'confirm'
                  ? 'Verificar correo'
                  : 'Iniciar sesión'}
          </button>
        </form>

        {mode === 'confirm' && (
          <button className="auth-text-button" disabled={!configured || isSubmitting} onClick={handleResendCode} type="button">
            Reenviar código
          </button>
        )}

        {mode !== 'confirm' && (
          <p className="auth-switch">
            {mode === 'signUp' ? '¿Ya tienes una cuenta?' : '¿Aún no tienes una cuenta?'}
            <button
              disabled={isSubmitting}
              onClick={() => switchMode(mode === 'signUp' ? 'signIn' : 'signUp')}
              type="button"
            >
              {mode === 'signUp' ? 'Inicia sesión' : 'Regístrate'}
            </button>
          </p>
        )}

        <p className="auth-footnote">Tu contraseña se envía directamente a Amazon Cognito y no se guarda en TripPlanner.</p>
      </section>
    </main>
  )
}

export default AuthPage
