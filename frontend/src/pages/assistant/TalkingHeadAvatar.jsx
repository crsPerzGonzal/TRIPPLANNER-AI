import { useEffect, useRef, useState } from 'react'
import './TalkingHeadAvatar.css'

const avatarUrl = '/avatars/brunette.glb'

function TalkingHeadAvatar() {
  const containerRef = useRef(null)
  const avatarRef = useRef(null)
  const [mood, setMood] = useState('neutral')
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false
    let avatar

    async function loadAvatar() {
      try {
        const { TalkingHead } = await import('@met4citizen/talkinghead')
        if (cancelled) return

        avatar = new TalkingHead(containerRef.current, {
          avatarMute: true,
          lipsyncModules: [],
          cameraRotateEnable: false,
          cameraPanEnable: false,
          cameraZoomEnable: false,
          cameraView: 'upper',
          modelFPS: 24,
          modelPixelRatio: 1,
        })
        avatarRef.current = avatar

        await avatar.showAvatar({
          url: avatarUrl,
          body: 'F',
          avatarMood: 'neutral',
        })

        if (!cancelled) {
          setStatus('ready')
        }
      } catch (error) {
        if (!cancelled) {
          console.error('No se pudo cargar el avatar de TalkingHead.', error)
          setStatus('error')
        }
      }
    }

    void loadAvatar()

    return () => {
      cancelled = true
      avatarRef.current = null
      avatar?.dispose()
    }
  }, [])

  useEffect(() => {
    if (status === 'ready') {
      const avatar = avatarRef.current
      if (!avatar) return

      avatar.setMood(mood)
      if (mood === 'happy') {
        avatar.setBaselineValue('mouthSmile', 0.62)
      }
    }
  }, [mood, status])

  return (
    <section className="assistant-side-card talking-head-card">
      <div className="talking-head-heading">
        <div>
          <span className="section-eyebrow">TU COMPAÑERO DE VIAJE</span>
          <h3>TripPlanner</h3>
        </div>
        <span className="avatar-mode-badge">Solo expresiones</span>
      </div>

      <div className="talking-head-stage">
        <div className="avatar-orbit avatar-orbit-outer" aria-hidden="true" />
        <div className="avatar-orbit avatar-orbit-inner" aria-hidden="true" />
        <div
          ref={containerRef}
          className="talking-head-canvas"
          role="img"
          aria-label={`Avatar del asistente con expresión ${mood === 'happy' ? 'alegre' : 'neutral'}`}
        />
        {status === 'loading' && (
          <div className="avatar-stage-message" role="status">
            Preparando el avatar 3D…
          </div>
        )}
        {status === 'error' && (
          <div className="avatar-stage-message avatar-stage-error" role="status">
            No se pudo cargar el avatar. El asistente sigue disponible en modo texto.
          </div>
        )}
        <span className="avatar-mood-indicator">
          <span />
          {mood === 'happy' ? 'Alegre' : 'Neutral'}
        </span>
      </div>

      <div className="avatar-controls">
        <span>Expresión de prueba</span>
        <div className="mood-switch" role="group" aria-label="Cambiar expresión del avatar">
          <button
            type="button"
            className={mood === 'neutral' ? 'selected' : ''}
            aria-pressed={mood === 'neutral'}
            disabled={status !== 'ready'}
            onClick={() => setMood('neutral')}
          >
            Neutral
          </button>
          <button
            type="button"
            className={mood === 'happy' ? 'selected' : ''}
            aria-pressed={mood === 'happy'}
            disabled={status !== 'ready'}
            onClick={() => setMood('happy')}
          >
            Alegre
          </button>
        </div>
      </div>

      <p className="avatar-disclaimer">
        Avatar de prueba. No usa voz ni sincronización labial.
      </p>
    </section>
  )
}

export default TalkingHeadAvatar
