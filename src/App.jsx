import { useState, useCallback } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────

const WCA_BASE = 'https://www.worldcubeassociation.org/api/v0'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const EVENT_SHORT = {
  '333': '3x3', '222': '2x2', '444': '4x4', '555': '5x5',
  '666': '6x6', '777': '7x7', '333bf': '3BLD', '333fm': 'FMC',
  '333oh': 'OH', '444bf': '4BLD', '555bf': '5BLD', '333mbf': 'MBLD',
  'clock': 'Clock', 'minx': 'Mega', 'pyram': 'Pyra', 'skewb': 'Skewb', 'sq1': 'Sq-1',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function isWcaId(q) {
  return /^\d{4}[A-Z]{4}\d{2}$/i.test(q.trim())
}

function formatTime(dtStr, timezone) {
  if (!dtStr) return null
  try {
    const dt = new Date(dtStr)
    return dt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    })
  } catch {
    return null
  }
}

function formatDate(dtStr, timezone) {
  if (!dtStr) return null
  try {
    const dt = new Date(dtStr)
    return {
      day: dt.toLocaleDateString('en-US', { day: 'numeric', timeZone: timezone }),
      month: dt.toLocaleDateString('en-US', { month: 'short', timeZone: timezone }),
    }
  } catch {
    return null
  }
}

function buildGCalUrl(name, startDateStr, startTime, endDateStr, location, wcaUrl) {
  // Build Google Calendar URL
  // startTime is like "9:00 AM", startDateStr is "2026-05-24"
  // We'll use all-day if no time available
  try {
    const start = new Date(startDateStr + 'T00:00:00')
    const end = new Date(endDateStr + 'T00:00:00')
    end.setDate(end.getDate() + 1) // end is exclusive for all-day

    const pad = n => String(n).padStart(2, '0')
    const fmt = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`

    const dates = `${fmt(start)}/${fmt(end)}`
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: name,
      dates,
      details: `WCA Competition\n${wcaUrl}`,
      location,
    })
    return `https://calendar.google.com/calendar/render?${params.toString()}`
  } catch {
    return null
  }
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function searchPersons(query) {
  if (isWcaId(query)) {
    const res = await fetch(`${WCA_BASE}/persons/${query.toUpperCase()}`)
    if (!res.ok) throw new Error(`No profile found for "${query.toUpperCase()}"`)
    const data = await res.json()
    const p = data.person
    return [{ wca_id: p.wca_id, name: p.name, country_iso2: p.country_iso2 }]
  } else {
    const res = await fetch(`${WCA_BASE}/search/users?q=${encodeURIComponent(query)}&persons_table=true`)
    if (!res.ok) throw new Error('Search failed')
    const data = await res.json()
    const users = (data.result || []).filter(u => u.wca_id)
    if (!users.length) throw new Error(`No competitors found for "${query}"`)
    return users.map(u => ({ wca_id: u.wca_id, name: u.name, country_iso2: u.country_iso2 }))
  }
}

async function fetchUpcomingComps(wcaId) {
  const today = new Date().toISOString().split('T')[0]
  const end = new Date()
  end.setMonth(end.getMonth() + 6)
  const endStr = end.toISOString().split('T')[0]

  // Step 1: Fetch all upcoming comps in date range across multiple pages
  const allComps = []
  let page = 1
  while (true) {
    const res = await fetch(`${WCA_BASE}/competitions?start=${today}&end=${endStr}&per_page=100&page=${page}`)
    if (!res.ok) break
    const data = await res.json()
    const comps = Array.isArray(data) ? data : (data.competitions || [])
    if (!comps.length) break
    allComps.push(...comps)
    if (comps.length < 100) break
    page++
  }

  if (!allComps.length) return []

  // Step 2: For each comp, hit /registrations (lightweight) to check if person is accepted
  const CHUNK = 8
  const matchedComps = []

  for (let i = 0; i < allComps.length; i += CHUNK) {
    const chunk = allComps.slice(i, i + CHUNK)
    const results = await Promise.all(
      chunk.map(async comp => {
        try {
          const regRes = await fetch(`${WCA_BASE}/competitions/${comp.id}/registrations`)
          if (!regRes.ok) return null
          const regs = await regRes.json()
          const myReg = (Array.isArray(regs) ? regs : []).find(
            r => r.wca_id === wcaId && r.competing?.registration_status === 'accepted'
          )
          if (!myReg) return null
          return { comp, myReg }
        } catch {
          return null
        }
      })
    )
    results.filter(Boolean).forEach(r => matchedComps.push(r))
  }

  if (!matchedComps.length) return []

  // Step 3: For matched comps only, fetch WCIF for schedule + exact events
  const registered = await Promise.all(
    matchedComps.map(async ({ comp, myReg }) => {
      try {
        const wcifRes = await fetch(`${WCA_BASE}/competitions/${comp.id}/wcif/public`)
        if (!wcifRes.ok) {
          return {
            comp,
            wcifInfo: {
              eventIds: myReg.competing?.event_ids || [],
              firstStart: null,
              timezone: 'UTC',
            }
          }
        }
        const wcif = await wcifRes.json()
        const timezone = wcif.schedule?.venues?.[0]?.timezone || 'UTC'
        const person = (wcif.persons || []).find(p => p.wcaId === wcaId)
        const eventIds = person?.registration?.eventIds || myReg.competing?.event_ids || []

        let firstStart = null
        for (const venue of (wcif.schedule?.venues || [])) {
          for (const room of (venue.rooms || [])) {
            for (const activity of (room.activities || [])) {
              if (!firstStart || new Date(activity.startTime) < new Date(firstStart)) {
                firstStart = activity.startTime
              }
              for (const child of (activity.childActivities || [])) {
                if (!firstStart || new Date(child.startTime) < new Date(firstStart)) {
                  firstStart = child.startTime
                }
              }
            }
          }
        }

        return { comp, wcifInfo: { eventIds, firstStart, timezone } }
      } catch {
        return {
          comp,
          wcifInfo: {
            eventIds: myReg.competing?.event_ids || [],
            firstStart: null,
            timezone: 'UTC',
          }
        }
      }
    })
  )

  return registered.sort((a, b) => new Date(a.comp.start_date) - new Date(b.comp.start_date))
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  app: {
    fontFamily: "'Inter', sans-serif",
    background: '#fff',
    minHeight: '100vh',
    padding: '0 0 40px',
  },
  header: {
    background: '#003f88',
    padding: '14px 20px',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { color: '#fff', fontSize: '18px', fontWeight: 700 },
  headerSub: { color: 'rgba(255,255,255,0.6)', fontSize: '10px', letterSpacing: '0.1em', marginTop: '2px' },
  logoWrap: {
    display: 'flex', alignItems: 'center', gap: '6px',
    textDecoration: 'none', background: 'rgba(255,255,255,0.15)',
    borderRadius: '8px', padding: '6px 10px',
  },
  inner: { maxWidth: '460px', margin: '0 auto', padding: '0 16px' },
  lbl: {
    fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em',
    textTransform: 'uppercase', color: '#004d40', marginBottom: '6px',
  },
  searchBox: {
    background: '#fff', border: '1.5px solid #80cbc4',
    borderRadius: '8px', padding: '8px 12px',
    marginBottom: '4px', display: 'flex', gap: '8px', alignItems: 'center',
  },
  searchInput: {
    flex: 1, border: 'none', outline: 'none',
    fontFamily: "'Inter', sans-serif", fontSize: '14px',
    fontWeight: 600, color: '#222', background: 'transparent',
  },
  searchBtn: {
    background: '#00695c', border: 'none', borderRadius: '6px',
    padding: '6px 14px', color: '#fff', fontSize: '12px',
    fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  hint: { fontSize: '10px', color: '#80cbc4', marginBottom: '14px' },
  warn: {
    fontSize: '11px', color: '#b71c1c', background: '#ffebee',
    border: '1px solid #ef9a9a', borderRadius: '6px',
    padding: '6px 10px', marginBottom: '10px',
  },
  sep: { display: 'flex', alignItems: 'center', gap: '8px', margin: '14px 0 10px' },
  sepLine: { flex: 1, height: '1px', background: '#e0f2f1' },
  sepTxt: {
    fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: '#80cbc4', whiteSpace: 'nowrap',
  },
  resultItem: (sel) => ({
    background: sel ? '#00695c' : '#e0f2f1',
    border: `1.5px solid ${sel ? '#00695c' : '#80cbc4'}`,
    borderRadius: '8px', padding: '9px 12px', marginBottom: '6px',
    display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
  }),
  av: {
    width: '32px', height: '32px', borderRadius: '50%',
    background: '#00695c', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: '11px', fontWeight: 700,
    color: '#fff', flexShrink: 0,
  },
  avSel: { background: 'rgba(255,255,255,0.2)' },
  rName: (sel) => ({ fontSize: '13px', fontWeight: 700, color: sel ? '#fff' : '#004d40' }),
  rMeta: (sel) => ({ fontSize: '10px', color: sel ? 'rgba(255,255,255,0.65)' : '#00796b', marginTop: '1px' }),
  rAction: { marginLeft: 'auto', fontSize: '10px', fontWeight: 700, color: '#00796b', flexShrink: 0 },
  checkmark: {
    width: '18px', height: '18px', borderRadius: '50%',
    background: '#fff', display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0, marginLeft: 'auto',
  },
  divider: { height: '1px', background: '#e0f2f1', margin: '16px 0' },
  progBar: { height: '3px', background: '#e0f2f1', borderRadius: '2px', marginBottom: '14px', overflow: 'hidden' },
  progFill: (w) => ({ height: '100%', background: '#003f88', borderRadius: '2px', width: `${w}%`, transition: 'width 0.4s' }),
  compCard: {
    background: '#b2dfdb', border: '1.5px solid #80cbc4',
    borderRadius: '10px', padding: '10px 12px', marginBottom: '8px',
    display: 'flex', gap: '10px',
  },
  dateBox: {
    background: '#00695c', borderRadius: '8px', padding: '7px 8px',
    textAlign: 'center', minWidth: '48px', flexShrink: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center',
  },
  dateDay: { fontSize: '18px', fontWeight: 700, color: '#fff', lineHeight: 1 },
  dateMon: { fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '1px' },
  dateDow: { fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginTop: '1px' },
  dateTime: {
    fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.55)',
    borderTop: '1px solid rgba(255,255,255,0.2)',
    marginTop: '3px', paddingTop: '3px', width: '100%', textAlign: 'center',
  },
  compBody: { flex: 1, minWidth: 0 },
  compNameLink: {
    fontSize: '13px', fontWeight: 700, color: '#004d40',
    margin: '0 0 2px', textDecoration: 'none', display: 'block',
  },
  compLoc: {
    fontSize: '11px', color: '#00796b', margin: '0 0 7px',
    textDecoration: 'none', display: 'block',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  pills: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  pill: {
    background: 'rgba(255,255,255,0.6)', border: '1px solid #80cbc4',
    borderRadius: '20px', padding: '2px 8px', fontSize: '10px',
    fontWeight: 600, color: '#004d40',
  },
  compRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px', flexShrink: 0 },
  tagReg: {
    background: '#003f88', color: '#fff', fontSize: '10px',
    fontWeight: 700, padding: '3px 7px', borderRadius: '5px',
    textTransform: 'uppercase', whiteSpace: 'nowrap',
  },
  groupsLink: {
    fontSize: '10px', fontWeight: 700, color: '#003f88',
    textDecoration: 'none', whiteSpace: 'nowrap',
    background: 'rgba(0,63,136,0.08)', border: '1px solid rgba(0,63,136,0.25)',
    borderRadius: '20px', padding: '2px 8px',
  },
  gcalLink: {
    fontSize: '10px', fontWeight: 700, color: '#00695c',
    textDecoration: 'none', whiteSpace: 'nowrap',
    background: 'rgba(0,105,92,0.08)', border: '1px solid rgba(0,105,92,0.25)',
    borderRadius: '20px', padding: '2px 8px',
    display: 'flex', alignItems: 'center', gap: '3px',
  },
  liveLink: {
    fontSize: '10px', fontWeight: 700, color: '#c2185b',
    textDecoration: 'none', whiteSpace: 'nowrap',
    background: 'rgba(194,24,91,0.08)', border: '1px solid rgba(194,24,91,0.3)',
    borderRadius: '20px', padding: '2px 8px',
    display: 'flex', alignItems: 'center', gap: '3px',
  },
  liveLinkDisabled: {
    fontSize: '10px', fontWeight: 700, color: '#aaa',
    whiteSpace: 'nowrap', cursor: 'not-allowed',
    background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.1)',
    borderRadius: '20px', padding: '2px 8px',
    display: 'flex', alignItems: 'center', gap: '3px',
  },
  loading: { textAlign: 'center', padding: '20px', color: '#80cbc4', fontSize: '13px', fontWeight: 600 },
  empty: { textAlign: 'center', padding: '20px', color: '#80cbc4', fontSize: '12px' },
  clearBtn: {
    width: '100%', padding: '12px', backgroundColor: '#ff7043',
    border: 'none', borderRadius: '8px', color: '#fff',
    fontFamily: "'Inter', sans-serif", fontSize: '13px',
    fontWeight: 600, cursor: 'pointer', letterSpacing: '0.03em',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    marginTop: '6px',
  },
  footer: { textAlign: 'center', fontSize: '10px', color: '#80cbc4', marginTop: '16px', letterSpacing: '0.05em' },
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: '14px', height: '14px',
      border: '2px solid #e0f2f1', borderTopColor: '#00695c',
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
      marginRight: '8px', verticalAlign: 'middle',
    }} />
  )
}

function CalIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00695c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function DotIcon({ color }) {
  return <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill={color} /></svg>
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  )
}

// ── CompCard ──────────────────────────────────────────────────────────────────

function CompCard({ comp, wcifInfo }) {
  const startDate = comp.start_date
  const endDate = comp.end_date || comp.start_date
  const timezone = wcifInfo?.timezone || 'UTC'
  const eventIds = wcifInfo?.eventIds || comp.event_ids || []
  const firstTime = wcifInfo?.firstStart ? formatTime(wcifInfo.firstStart, timezone) : null

  // Date display in competition's local timezone
  const dateInfo = formatDate(startDate + 'T12:00:00', timezone)
  const day = dateInfo?.day || new Date(startDate + 'T00:00:00').getDate()
  const month = dateInfo?.month || MONTHS[new Date(startDate + 'T00:00:00').getMonth()]

  // Day of week
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dow = DAYS[new Date(startDate + 'T12:00:00').getDay()]

  // WCA Live — active if today >= start_date
  const today = new Date().toISOString().split('T')[0]
  const liveActive = startDate <= today
  const liveUrl = `https://live.worldcubeassociation.org/competitions/${comp.id}`

  // Location — country · venue (truncated), links to Google Maps
  const venueName = comp.venue || comp.venue_address || comp.name
  const truncateVenue = (str, max = 28) => str && str.length > max ? str.slice(0, max).trimEnd() + '…' : str
  const country = comp.country_iso2 || ''
  const venueShort = truncateVenue(venueName)
  const locDisplay = [country, venueShort].filter(Boolean).join(' · ')
  const mapsQuery = encodeURIComponent([venueName, comp.city, comp.country_iso2].filter(Boolean).join(', '))
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`

  // For Google Cal location field still use city + country
  const loc = [comp.city, comp.country_iso2].filter(Boolean).join(', ') || comp.city || ''

  // Google Cal URL
  const gcalUrl = buildGCalUrl(
    comp.name,
    startDate,
    firstTime,
    endDate,
    loc,
    comp.url || `https://www.worldcubeassociation.org/competitions/${comp.id}`
  )

  const wcaUrl = comp.url || `https://www.worldcubeassociation.org/competitions/${comp.id}`
  const groupsUrl = `https://www.competitiongroups.com/competitions/${comp.id}/psych-sheet`

  return (
    <div style={S.compCard}>
      <div style={S.dateBox}>
        <div style={S.dateDay}>{day}</div>
        <div style={S.dateMon}>{month}</div>
        <div style={S.dateDow}>({dow})</div>
        {firstTime && <div style={S.dateTime}>{firstTime}</div>}
      </div>
      <div style={S.compBody}>
        <a href={wcaUrl} target="_blank" rel="noopener noreferrer" style={S.compNameLink}>{comp.name}</a>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={S.compLoc}>{locDisplay}</a>
        <div style={S.pills}>
          {eventIds.map(id => (
            <span key={id} style={S.pill}>{EVENT_SHORT[id] || id}</span>
          ))}
        </div>
      </div>
      <div style={S.compRight}>
        <span style={S.tagReg}>Registered</span>
        <a href={groupsUrl} target="_blank" rel="noopener noreferrer" style={S.groupsLink}>
          competitiongroups ↗
        </a>
        {gcalUrl && (
          <a href={gcalUrl} target="_blank" rel="noopener noreferrer" style={S.gcalLink}>
            <CalIcon />
            add to Google Cal
          </a>
        )}
        {liveActive ? (
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={S.liveLink}>
            <DotIcon color="#c2185b" />
            WCA Live ↗
          </a>
        ) : (
          <span style={S.liveLinkDisabled}>
            <DotIcon color="#ccc" />
            WCA Live
          </span>
        )}
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [persons, setPersons] = useState([])
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [comps, setComps] = useState([])
  const [compsLoading, setCompsLoading] = useState(false)
  const [compsError, setCompsError] = useState('')
  const [progress, setProgress] = useState(0)
  const [showComps, setShowComps] = useState(false)

  const doSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) { setError('Please enter a name or WCA ID.'); return }
    setError('')
    setSearching(true)
    setPersons([])
    setSelectedPerson(null)
    setComps([])
    setShowComps(false)
    setProgress(0)
    try {
      const results = await searchPersons(q)
      setPersons(results)
      // Auto-select if only one result
      if (results.length === 1) await selectPerson(results[0])
    } catch (e) {
      setError(e.message)
    }
    setSearching(false)
  }, [query])

  const selectPerson = useCallback(async (person) => {
    setSelectedPerson(person)
    setComps([])
    setCompsError('')
    setShowComps(true)
    setCompsLoading(true)
    setProgress(30)
    try {
      const results = await fetchUpcomingComps(person.wca_id)
      setProgress(100)
      setComps(results)
    } catch (e) {
      setCompsError(e.message)
    }
    setCompsLoading(false)
  }, [])

  const clearAll = () => {
    setQuery('')
    setError('')
    setPersons([])
    setSelectedPerson(null)
    setComps([])
    setCompsLoading(false)
    setCompsError('')
    setShowComps(false)
    setProgress(0)
  }

  const handleKey = (e) => { if (e.key === 'Enter') doSearch() }

  return (
    <div style={S.app}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        a.comp-name:hover { text-decoration: underline !important; }
      `}</style>

      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.headerTitle}>WCA-CompTrack</div>
          <div style={S.headerSub}>UPCOMING · BY COMPETITOR</div>
        </div>
        <a href="https://www.worldcubeassociation.org" target="_blank" rel="noopener noreferrer" style={S.logoWrap}>
          <img
            src="https://assets.worldcubeassociation.org/assets/570b6bc/assets/WCA Logo-4ef000323c6a9a407cdf07647a31c0ef4dc847f2352a9a136ef3e809e95bdeab.svg"
            alt="WCA"
            style={{ height: '28px', width: 'auto' }}
            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block' }}
          />
          <span style={{ display: 'none', color: '#fff', fontSize: '11px', fontWeight: 700 }}>WCA</span>
        </a>
      </div>

      <div style={S.inner}>

        {/* Search */}
        <div style={S.lbl}>Search competitor</div>
        <div style={S.searchBox}>
          <input
            style={S.searchInput}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder='e.g. "luis tan" or "2023YILU01"'
          />
          <button
            style={{ ...S.searchBtn, opacity: searching ? 0.6 : 1 }}
            onClick={doSearch}
            disabled={searching}
          >
            {searching ? '...' : 'Search'}
          </button>
        </div>
        <div style={S.hint}>e.g. "luis tan" or "2023YILU01"</div>

        {error && <div style={S.warn}>{error}</div>}

        {/* Results */}
        {persons.length > 0 && (
          <>
            <div style={S.sep}>
              <div style={S.sepLine} />
              <div style={S.sepTxt}>
                {persons.length === 1 ? '1 result' : `${persons.length} results — pick one`}
              </div>
              <div style={S.sepLine} />
            </div>

            {persons.map(p => {
              const sel = selectedPerson?.wca_id === p.wca_id
              return (
                <div key={p.wca_id} style={S.resultItem(sel)} onClick={() => selectPerson(p)}>
                  <div style={{ ...S.av, ...(sel ? S.avSel : {}) }}>{initials(p.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.rName(sel)}>{p.name}</div>
                    <div style={S.rMeta(sel)}>{[p.country_iso2, p.wca_id].filter(Boolean).join(' · ')}</div>
                  </div>
                  {sel ? (
                    <div style={S.checkmark}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="#00695c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  ) : (
                    <div style={S.rAction}>SELECT</div>
                  )}
                </div>
              )
            })}
          </>
        )}

        {/* Competitions */}
        {showComps && (
          <>
            <div style={S.divider} />
            <div style={S.progBar}>
              <div style={S.progFill(progress)} />
            </div>

            <div style={S.lbl}>
              {compsLoading
                ? 'Upcoming competitions'
                : `Upcoming competitions (${comps.length})`}
            </div>

            {compsLoading && (
              <div style={S.loading}><Spinner />Scanning upcoming competitions…</div>
            )}

            {compsError && <div style={S.warn}>{compsError}</div>}

            {!compsLoading && !compsError && comps.length === 0 && (
              <div style={S.empty}>No upcoming competitions found for this competitor.</div>
            )}

            {!compsLoading && comps.map(({ comp, wcifInfo }) => (
              <CompCard key={comp.id} comp={comp} wcifInfo={wcifInfo} />
            ))}
          </>
        )}

        {/* Clear */}
        {(persons.length > 0 || showComps) && (
          <button style={S.clearBtn} onClick={clearAll}>
            <TrashIcon />
            Clear / New Search
          </button>
        )}

        <div style={S.footer}>
          WCA-CompTrack · by tankuoping@gmail.com<br />
          Chief tester: Jovan Susanto
        </div>

      </div>
    </div>
  )
}
