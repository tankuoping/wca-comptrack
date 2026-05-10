import { useState, useCallback, useEffect } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────

const WCA_BASE = 'https://www.worldcubeassociation.org/api/v0'
const CACHE_URL = '/wcif-cache.json'

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
    return new Date(dtStr).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone,
    })
  } catch { return null }
}

function buildGCalUrl(name, startDateStr, endDateStr, location, wcaUrl) {
  try {
    const start = new Date(startDateStr + 'T00:00:00')
    const end = new Date(endDateStr + 'T00:00:00')
    end.setDate(end.getDate() + 1)
    const pad = n => String(n).padStart(2, '0')
    const fmt = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    const params = new URLSearchParams({
      action: 'TEMPLATE', text: name,
      dates: `${fmt(start)}/${fmt(end)}`,
      details: `WCA Competition\n${wcaUrl}`, location,
    })
    return `https://calendar.google.com/calendar/render?${params.toString()}`
  } catch { return null }
}

function formatCacheAge(builtAt) {
  if (!builtAt) return 'unknown'
  const diff = Date.now() - new Date(builtAt).getTime()
  const hours = Math.floor(diff / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (hours > 48) return `${Math.floor(hours / 24)}d ago`
  if (hours > 0) return `${hours}h ${mins}m ago`
  return `${mins}m ago`
}

function formatCacheDateTime(builtAt) {
  if (!builtAt) return null
  try {
    return new Date(builtAt).toLocaleString('en-SG', {
      timeZone: 'Asia/Singapore',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }) + ' SGT'
  } catch {
    return new Date(builtAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  }
}

// ── Cache loader ──────────────────────────────────────────────────────────────

const cacheState = {
  status: 'idle',   // 'idle' | 'loading' | 'ready' | 'error'
  wcifMap: {},
  builtAt: null,
  totalComps: 0,
  scannedComps: 0,
  listeners: [],
}

function notifyListeners() {
  cacheState.listeners.forEach(fn => fn({ ...cacheState }))
}

async function loadCache() {
  if (cacheState.status === 'loading') return
  cacheState.status = 'loading'
  notifyListeners()
  try {
    // Cache-bust so we always get the latest from the server
    const res = await fetch(`${CACHE_URL}?t=${Date.now()}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    cacheState.wcifMap = data.wcifMap || {}
    cacheState.builtAt = data.builtAt || null
    cacheState.totalComps = data.totalComps || 0
    cacheState.scannedComps = data.scannedComps || 0
    cacheState.status = 'ready'
  } catch (e) {
    console.error('[Cache] Load failed:', e)
    cacheState.status = 'error'
  }
  notifyListeners()
}

function subscribeToCache(fn) {
  cacheState.listeners.push(fn)
  fn({ ...cacheState })
  return () => { cacheState.listeners = cacheState.listeners.filter(l => l !== fn) }
}

function findCompsForPerson(wcaId) {
  return Object.values(cacheState.wcifMap)
    .filter(d => d.registrants?.some(r => r.wcaId === wcaId))
    .map(d => {
      const reg = d.registrants.find(r => r.wcaId === wcaId)
      return { comp: d.comp, wcifInfo: { eventIds: reg.eventIds, firstStart: d.firstStart, timezone: d.timezone } }
    })
    .sort((a, b) => new Date(a.comp.start_date) - new Date(b.comp.start_date))
}

// Load cache immediately on module load
loadCache()

// ── Person search ─────────────────────────────────────────────────────────────

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

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  app: { fontFamily: "'Inter', sans-serif", background: '#fff', minHeight: '100vh', padding: '0 0 40px' },
  header: {
    background: '#003f88', padding: '14px 20px', marginBottom: '16px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle: { color: '#fff', fontSize: '18px', fontWeight: 700 },
  headerSub: { color: 'rgba(255,255,255,0.6)', fontSize: '10px', letterSpacing: '0.1em', marginTop: '2px' },
  logoWrap: {
    display: 'flex', alignItems: 'center', gap: '6px',
    textDecoration: 'none', background: 'rgba(255,255,255,0.15)',
    borderRadius: '8px', padding: '6px 10px',
  },
  inner: { maxWidth: '460px', margin: '0 auto', padding: '0 16px' },
  cacheBanner: (status) => ({
    background: status === 'error' ? '#fff3e0' : status === 'loading' ? '#e8f5e9' : '#e0f2f1',
    border: `1px solid ${status === 'error' ? '#ffcc80' : status === 'loading' ? '#a5d6a7' : '#80cbc4'}`,
    borderRadius: '8px', padding: '8px 12px', marginBottom: '12px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: '11px', color: '#004d40',
  }),
  lbl: {
    fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em',
    textTransform: 'uppercase', color: '#004d40', marginBottom: '6px',
  },
  searchBox: {
    background: '#fff', border: '1.5px solid #80cbc4', borderRadius: '8px',
    padding: '8px 12px', marginBottom: '4px', display: 'flex', gap: '8px', alignItems: 'center',
  },
  searchInput: {
    flex: 1, border: 'none', outline: 'none',
    fontFamily: "'Inter', sans-serif", fontSize: '14px', fontWeight: 600,
    color: '#222', background: 'transparent',
  },
  searchBtn: {
    background: '#00695c', border: 'none', borderRadius: '6px',
    padding: '6px 14px', color: '#fff', fontSize: '12px', fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  hint: { fontSize: '11px', color: '#aaa', marginBottom: '12px' },
  warn: {
    background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: '6px',
    padding: '8px 12px', fontSize: '12px', color: '#e65100', marginBottom: '8px',
  },
  sep: { display: 'flex', alignItems: 'center', gap: '8px', margin: '14px 0 8px' },
  sepLine: { flex: 1, height: '1px', background: '#e0f2f1' },
  sepTxt: { fontSize: '10px', color: '#80cbc4', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' },
  resultItem: sel => ({
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '10px 12px', borderRadius: '8px', marginBottom: '6px',
    border: sel ? '1.5px solid #00695c' : '1.5px solid #b2dfdb',
    background: sel ? '#e0f2f1' : '#fff', cursor: 'pointer',
  }),
  av: {
    width: '34px', height: '34px', borderRadius: '50%',
    background: '#b2dfdb', color: '#004d40', fontSize: '12px',
    fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avSel: { background: '#00695c', color: '#fff' },
  rName: sel => ({ fontSize: '13px', fontWeight: 700, color: sel ? '#00695c' : '#222' }),
  rMeta: sel => ({ fontSize: '11px', color: sel ? '#00897b' : '#888', marginTop: '1px' }),
  checkmark: {
    width: '20px', height: '20px', borderRadius: '50%',
    background: '#e0f2f1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  rAction: { fontSize: '10px', fontWeight: 700, color: '#00695c', letterSpacing: '0.08em' },
  divider: { height: '1px', background: '#e0f2f1', margin: '16px 0 12px' },
  empty: { fontSize: '13px', color: '#888', padding: '12px 0' },
  compCard: {
    border: '1.5px solid #80cbc4', borderRadius: '10px',
    marginBottom: '10px', display: 'flex', overflow: 'hidden',
    background: '#fff',
  },
  dateBox: {
    background: '#004d40', color: '#fff', minWidth: '70px',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', padding: '10px 8px', gap: '1px',
  },
  dateDay: { fontSize: '22px', fontWeight: 800, lineHeight: 1 },
  dateMon: { fontSize: '11px', fontWeight: 600, opacity: 0.8 },
  dateDow: { fontSize: '10px', opacity: 0.6 },
  dateTime: { fontSize: '9px', opacity: 0.7, marginTop: '2px' },
  compBody: { flex: 1, padding: '8px 10px', minWidth: 0 },
  compNameLink: {
    fontSize: '13px', fontWeight: 700, color: '#003f88',
    textDecoration: 'none', display: 'block', marginBottom: '2px',
  },
  compLoc: {
    fontSize: '10px', color: '#00695c', textDecoration: 'none',
    display: 'block', marginBottom: '5px', whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis',
  },
  pills: { display: 'flex', flexWrap: 'wrap', gap: '3px' },
  pill: {
    fontSize: '9px', fontWeight: 700, padding: '2px 6px',
    borderRadius: '4px', background: '#e0f2f1', color: '#004d40',
  },
  compRight: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
    padding: '8px 10px', gap: '4px', minWidth: '110px',
  },
  tagReg: {
    fontSize: '9px', fontWeight: 800, letterSpacing: '0.06em',
    background: '#003f88', color: '#fff', padding: '2px 7px', borderRadius: '4px',
  },
  groupsLink: { fontSize: '10px', color: '#003f88', textDecoration: 'none', fontWeight: 600 },
  gcalLink: {
    fontSize: '10px', color: '#fff', textDecoration: 'none', fontWeight: 600,
    background: '#00695c', padding: '3px 7px', borderRadius: '4px',
    display: 'flex', alignItems: 'center', gap: '3px',
  },
  liveLink: { fontSize: '10px', color: '#c2185b', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' },
  liveLinkDisabled: { fontSize: '10px', color: '#bbb', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' },
  clearBtn: {
    width: '100%', marginTop: '16px', background: '#ff7043', border: 'none',
    borderRadius: '8px', padding: '12px', color: '#fff', fontSize: '13px',
    fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: '6px',
  },
  refreshBtn: (loading) => ({
    width: '100%', marginTop: '8px', background: loading ? '#90a4ae' : '#003f88',
    border: 'none', borderRadius: '8px', padding: '12px', color: '#fff',
    fontSize: '13px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    transition: 'background 0.2s',
  }),
  footer: { textAlign: 'center', fontSize: '11px', color: '#aaa', marginTop: '24px', lineHeight: 1.6 },
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function Spinner({ size = 14, color = '#00695c' }) {
  return (
    <div style={{
      width: size, height: size, border: `2px solid ${color}33`,
      borderTopColor: color, borderRadius: '50%',
      animation: 'spin 0.8s linear infinite', flexShrink: 0,
    }} />
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
    </svg>
  )
}

function CalIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

function DotIcon({ color }) {
  return <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
}

// ── CompCard ──────────────────────────────────────────────────────────────────

function CompCard({ comp, wcifInfo }) {
  const startDate = comp.start_date
  const endDate = comp.end_date || comp.start_date
  const timezone = wcifInfo?.timezone || 'UTC'
  const eventIds = wcifInfo?.eventIds || comp.event_ids || []
  const firstTime = wcifInfo?.firstStart ? formatTime(wcifInfo.firstStart, timezone) : null

  const d = new Date(startDate + 'T12:00:00')
  const day = d.getDate()
  const month = d.toLocaleString('en-US', { month: 'short' })
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]

  const today = new Date().toISOString().split('T')[0]
  const liveActive = startDate <= today
  const liveUrl = `https://live.worldcubeassociation.org/competitions/${comp.id}`
  const groupsUrl = `https://www.competitiongroups.com/competitions/${comp.id}/psych-sheet`
  const wcaUrl = comp.url || `https://www.worldcubeassociation.org/competitions/${comp.id}`
  const gcalUrl = buildGCalUrl(comp.name, startDate, endDate, comp.venue || comp.city || '', wcaUrl)

  const rawLoc = `${comp.country_iso2} · ${comp.venue || comp.city || ''}`
  const locDisplay = rawLoc.length > 30 ? rawLoc.slice(0, 28) + '…' : rawLoc
  const lat = comp.latitude_degrees, lng = comp.longitude_degrees
  const mapsUrl = lat && lng
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(comp.venue_address || comp.venue || comp.city || '')}`

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
          {eventIds.map(id => <span key={id} style={S.pill}>{EVENT_SHORT[id] || id}</span>)}
        </div>
      </div>
      <div style={S.compRight}>
        <span style={S.tagReg}>Registered</span>
        <a href={groupsUrl} target="_blank" rel="noopener noreferrer" style={S.groupsLink}>competitiongroups ↗</a>
        {gcalUrl && (
          <a href={gcalUrl} target="_blank" rel="noopener noreferrer" style={S.gcalLink}>
            <CalIcon />add to Google Cal
          </a>
        )}
        {liveActive
          ? <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={S.liveLink}><DotIcon color="#c2185b" />WCA Live ↗</a>
          : <span style={S.liveLinkDisabled}><DotIcon color="#ccc" />WCA Live</span>}
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
  const [showComps, setShowComps] = useState(false)
  const [cache, setCache] = useState({ status: cacheState.status, builtAt: cacheState.builtAt, scannedComps: cacheState.scannedComps })

  useEffect(() => subscribeToCache(s => setCache({ status: s.status, builtAt: s.builtAt, scannedComps: s.scannedComps })), [])

  const doSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) { setError('Please enter a name or WCA ID.'); return }
    setError('')
    setSearching(true)
    setPersons([])
    setSelectedPerson(null)
    setComps([])
    setShowComps(false)
    try {
      const results = await searchPersons(q)
      setPersons(results)
      if (results.length === 1) doSelectPerson(results[0])
    } catch (e) { setError(e.message) }
    setSearching(false)
  }, [query])

  function doSelectPerson(person) {
    setSelectedPerson(person)
    setShowComps(true)
    const results = findCompsForPerson(person.wca_id)
    setComps(results)
  }

  const clearAll = () => {
    setQuery(''); setError(''); setPersons([])
    setSelectedPerson(null); setComps([]); setShowComps(false)
  }

  const handleKey = (e) => { if (e.key === 'Enter') doSearch() }

  const handleRefresh = () => {
    // Reset cache state and reload
    cacheState.status = 'idle'
    cacheState.wcifMap = {}
    loadCache()
    // If a person is selected, re-query after cache loads
    if (selectedPerson) {
      const unsub = subscribeToCache(s => {
        if (s.status === 'ready') {
          setComps(findCompsForPerson(selectedPerson.wca_id))
          unsub()
        }
      })
    }
  }

  const cacheLoading = cache.status === 'loading'

  return (
    <div style={S.app}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.headerTitle}>WCA-CompTrack</div>
          <div style={S.headerSub}>UPCOMING · BY COMPETITOR</div>
        </div>
        <a href="https://www.worldcubeassociation.org" target="_blank" rel="noopener noreferrer" style={S.logoWrap}>
          <img src="https://assets.worldcubeassociation.org/assets/570b6bc/assets/WCA Logo-4ef000323c6a9a407cdf07647a31c0ef4dc847f2352a9a136ef3e809e95bdeab.svg"
            alt="WCA" style={{ height: '28px', width: 'auto' }}
            onError={e => { e.target.style.display = 'none' }} />
        </a>
      </div>

      <div style={S.inner}>

        {/* Cache status banner */}
        <div style={S.cacheBanner(cache.status)}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: cache.builtAt ? '2px' : 0 }}>
              {cache.status === 'loading' && '⏳ Loading competition data…'}
              {cache.status === 'ready' && `✓ ${cache.scannedComps} comps cached · updated ${formatCacheAge(cache.builtAt)}`}
              {cache.status === 'error' && '⚠ Cache unavailable — try refreshing below'}
              {cache.status === 'idle' && 'Initialising…'}
            </div>
            {cache.status === 'ready' && cache.builtAt && (
              <div style={{ opacity: 0.75, fontSize: '10px' }}>
                Last updated: {formatCacheDateTime(cache.builtAt)}
              </div>
            )}
          </div>
          {cacheLoading && <Spinner size={12} color="#00695c" />}
        </div>

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
          <button style={{ ...S.searchBtn, opacity: searching ? 0.6 : 1 }} onClick={doSearch} disabled={searching}>
            {searching ? '…' : 'Search'}
          </button>
        </div>
        <div style={S.hint}>e.g. "luis tan" or "2023YILU01"</div>

        {error && <div style={S.warn}>{error}</div>}

        {/* Results */}
        {persons.length > 0 && (
          <>
            <div style={S.sep}>
              <div style={S.sepLine} />
              <div style={S.sepTxt}>{persons.length === 1 ? '1 result' : `${persons.length} results — pick one`}</div>
              <div style={S.sepLine} />
            </div>
            {persons.map(p => {
              const sel = selectedPerson?.wca_id === p.wca_id
              return (
                <div key={p.wca_id} style={S.resultItem(sel)} onClick={() => doSelectPerson(p)}>
                  <div style={{ ...S.av, ...(sel ? S.avSel : {}) }}>{initials(p.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.rName(sel)}>{p.name}</div>
                    <div style={S.rMeta(sel)}>{[p.country_iso2, p.wca_id].filter(Boolean).join(' · ')}</div>
                  </div>
                  {sel
                    ? <div style={S.checkmark}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="#00695c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    : <div style={S.rAction}>SELECT</div>}
                </div>
              )
            })}
          </>
        )}

        {/* Competitions */}
        {showComps && (
          <>
            <div style={S.divider} />
            <div style={S.lbl}>Upcoming competitions ({comps.length})</div>
            {comps.length === 0 && (
              <div style={S.empty}>
                {cache.status === 'loading'
                  ? 'Cache is still loading — try again in a moment.'
                  : 'No upcoming registered competitions found.'}
              </div>
            )}
            {comps.map(({ comp, wcifInfo }) => (
              <CompCard key={comp.id} comp={comp} wcifInfo={wcifInfo} />
            ))}
          </>
        )}

        {/* Action buttons */}
        {(persons.length > 0 || showComps) && (
          <button style={S.clearBtn} onClick={clearAll}>
            <TrashIcon />Clear / New Search
          </button>
        )}

        {/* Refresh Cache button — always visible */}
        <button style={S.refreshBtn(cacheLoading)} onClick={handleRefresh} disabled={cacheLoading}>
          {cacheLoading ? <><Spinner size={14} color="#fff" /> Refreshing cache…</> : <><RefreshIcon /> Refresh Cache</>}
        </button>

        <div style={S.footer}>
          WCA-CompTrack · by tankuoping@gmail.com<br />
          Chief tester: Jovan Susanto
        </div>
      </div>
    </div>
  )
}
