import { useState } from 'react'

const COUNTRIES = [
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'PH', name: 'Philippines' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'CN', name: 'China' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'XW', name: 'Worldwide (XW)' },
  { code: 'XA', name: 'Asia (XA)' },
]

const EVENTS = [
  { id: '333', label: '3x3' },
  { id: '222', label: '2x2' },
  { id: '444', label: '4x4' },
  { id: '555', label: '5x5' },
  { id: '666', label: '6x6' },
  { id: '777', label: '7x7' },
  { id: '333bf', label: '3BLD' },
  { id: '333fm', label: 'FMC' },
  { id: '333oh', label: 'OH' },
  { id: '444bf', label: '4BLD' },
  { id: '555bf', label: '5BLD' },
  { id: '333mbf', label: 'MBLD' },
  { id: 'clock', label: 'Clock' },
  { id: 'minx', label: 'Mega' },
  { id: 'pyram', label: 'Pyra' },
  { id: 'skewb', label: 'Skewb' },
  { id: 'sq1', label: 'Sq-1' },
]

const S = {
  app: { fontFamily: "'Inter', sans-serif", background: '#fff', minHeight: '100vh', paddingBottom: '40px' },
  header: {
    background: '#003f88', padding: '14px 20px', marginBottom: '16px',
    display: 'flex', alignItems: 'center',
  },
  headerTitle: { color: '#fff', fontSize: '18px', fontWeight: 700 },
  headerSub: { color: 'rgba(255,255,255,0.6)', fontSize: '10px', letterSpacing: '0.1em', marginTop: '2px' },
  inner: { maxWidth: '460px', margin: '0 auto', padding: '0 16px' },
  lbl: {
    fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em',
    textTransform: 'uppercase', color: '#004d40', marginBottom: '8px',
  },
  pillGroup: { display: 'flex', flexWrap: 'wrap', gap: '7px', marginBottom: '18px' },
  pill: (sel) => ({
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '5px 11px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', border: sel ? '1.5px solid #003f88' : '1.5px solid #b2dfdb',
    background: sel ? '#003f88' : '#fff', color: sel ? '#fff' : '#555',
    userSelect: 'none', transition: 'all 0.1s',
  }),
  input: {
    width: '100%', border: '1.5px solid #80cbc4', borderRadius: '8px',
    padding: '10px 12px', fontSize: '14px', fontFamily: "'Inter', sans-serif",
    outline: 'none', marginBottom: '18px', boxSizing: 'border-box',
  },
  checkRow: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', marginBottom: '8px', cursor: 'pointer' },
  submitBtn: (loading) => ({
    width: '100%', background: loading ? '#90a4ae' : '#003f88',
    border: 'none', borderRadius: '8px', padding: '13px',
    color: '#fff', fontSize: '14px', fontWeight: 700,
    cursor: loading ? 'not-allowed' : 'pointer', marginTop: '8px',
  }),
  success: {
    background: '#e0f2f1', border: '1.5px solid #80cbc4', borderRadius: '10px',
    padding: '20px', textAlign: 'center', marginTop: '12px',
  },
  warn: {
    background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: '8px',
    padding: '10px 14px', fontSize: '13px', color: '#e65100', marginTop: '8px',
  },
  divider: { height: '1px', background: '#e0f2f1', margin: '18px 0' },
  backLink: {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    fontSize: '12px', color: '#00695c', textDecoration: 'none',
    fontWeight: 600, marginBottom: '16px',
  },
  hint: { fontSize: '11px', color: '#aaa', marginTop: '6px', marginBottom: '18px' },
}

export default function Subscribe() {
  const [email, setEmail] = useState('')
  const [countries, setCountries] = useState(['SG', 'MY'])
  const [events, setEvents] = useState([])
  const [alerts, setAlerts] = useState({ announced: true, regOpen: true, regClosing: false })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const toggle = (arr, setArr, val) =>
    setArr(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val])

  const handleSubmit = async () => {
    if (!email.includes('@')) { setError('Please enter a valid email address.'); return }
    if (countries.length === 0) { setError('Please select at least one country.'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, countries, events, alerts }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong')
      setDone(true)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  return (
    <div style={S.app}>
      <div style={S.header}>
        <div>
          <div style={S.headerTitle}>WCA-CompTrack</div>
          <div style={S.headerSub}>COMPETITION ALERTS · EMAIL</div>
        </div>
      </div>

      <div style={S.inner}>
        <a href="/" style={S.backLink}>← Back to search</a>

        {done ? (
          <div style={S.success}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>✓</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#004d40', marginBottom: '6px' }}>
              You're subscribed!
            </div>
            <div style={{ fontSize: '13px', color: '#00695c' }}>
              Check your inbox for a confirmation email.<br />
              You can unsubscribe anytime from any alert email.
            </div>
          </div>
        ) : (
          <>
            {/* Email */}
            <div style={S.lbl}>Your email</div>
            <input
              style={S.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />

            {/* Countries */}
            <div style={S.lbl}>Alert me for competitions in</div>
            <div style={S.pillGroup}>
              {COUNTRIES.map(c => (
                <div key={c.code} style={S.pill(countries.includes(c.code))}
                  onClick={() => toggle(countries, setCountries, c.code)}>
                  {c.name}
                </div>
              ))}
            </div>

            {/* Events */}
            <div style={S.lbl}>Only if these events are included</div>
            <div style={S.pillGroup}>
              {EVENTS.map(e => (
                <div key={e.id} style={S.pill(events.includes(e.id))}
                  onClick={() => toggle(events, setEvents, e.id)}>
                  {e.label}
                </div>
              ))}
            </div>
            <div style={S.hint}>Leave all unselected to get alerts for any competition regardless of events.</div>

            {/* Alert timing */}
            <div style={S.lbl}>Alert me when</div>
            <label style={S.checkRow}>
              <input type="checkbox" checked={alerts.announced}
                onChange={e => setAlerts({ ...alerts, announced: e.target.checked })} />
              A new competition is announced
            </label>
            <label style={S.checkRow}>
              <input type="checkbox" checked={alerts.regOpen}
                onChange={e => setAlerts({ ...alerts, regOpen: e.target.checked })} />
              Registration opens
            </label>
            <label style={S.checkRow}>
              <input type="checkbox" checked={alerts.regClosing}
                onChange={e => setAlerts({ ...alerts, regClosing: e.target.checked })} />
              7 days before registration closes (reminder)
            </label>

            <div style={S.divider} />

            {error && <div style={S.warn}>{error}</div>}

            <button style={S.submitBtn(loading)} onClick={handleSubmit} disabled={loading}>
              {loading ? 'Subscribing…' : '🔔 Subscribe to alerts'}
            </button>

            <div style={{ textAlign: 'center', fontSize: '11px', color: '#aaa', marginTop: '12px' }}>
              You can unsubscribe anytime — one click in any alert email.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
