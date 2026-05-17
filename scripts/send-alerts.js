// Runs nightly via GitHub Actions
// Compares today's cache vs yesterday's — emails subscribers about new comps via Gmail

const fs = require('fs')
const path = require('path')
const nodemailer = require('nodemailer')

const CACHE_FILE = path.join(__dirname, '../public/wcif-cache.json')
const PREV_CACHE_FILE = path.join(__dirname, '../public/wcif-cache-prev.json')
const GMAIL_USER = process.env.GMAIL_USER
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD
const SHEET_ID = process.env.GOOGLE_SHEET_ID
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
const APP_URL = 'https://wca-comptrack.vercel.app'

const EVENT_SHORT = {
  '333':'3x3','222':'2x2','444':'4x4','555':'5x5','666':'6x6','777':'7x7',
  '333bf':'3BLD','333fm':'FMC','333oh':'OH','444bf':'4BLD','555bf':'5BLD',
  '333mbf':'MBLD','clock':'Clock','minx':'Mega','pyram':'Pyra','skewb':'Skewb','sq1':'Sq-1',
}

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  })
}

async function getSubscribers() {
  const { GoogleSpreadsheet } = require('google-spreadsheet')
  const { JWT } = require('google-auth-library')
  const jwt = new JWT({ email: CLIENT_EMAIL, key: PRIVATE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  const doc = new GoogleSpreadsheet(SHEET_ID, jwt)
  await doc.loadInfo()
  const sheet = doc.sheetsByTitle['Subscribers']
  if (!sheet) return []
  const rows = await sheet.getRows()
  return rows
    .filter(r => r.get('active') === 'TRUE')
    .map(r => ({
      email: r.get('email'),
      token: r.get('token'),
      countries: r.get('countries')?.split(',').filter(Boolean) || [],
      events: r.get('events')?.split(',').filter(Boolean) || [],
      alertAnnounced: r.get('alert_announced') === 'TRUE',
      alertRegOpen: r.get('alert_reg_open') === 'TRUE',
      alertRegClosing: r.get('alert_reg_closing') === 'TRUE',
    }))
}

function compMatchesSubscriber(comp, sub) {
  if (!sub.countries.includes(comp.country_iso2)) return false
  if (sub.events.length > 0) {
    const compEvents = comp.event_ids || []
    if (!sub.events.some(e => compEvents.includes(e))) return false
  }
  return true
}

function compCard(comp) {
  const d = new Date(comp.start_date + 'T12:00:00')
  const day = d.getDate()
  const mon = d.toLocaleString('en-US', { month: 'short' })
  const events = (comp.event_ids || []).map(e => EVENT_SHORT[e] || e)
  const regOpen = comp.registration_open
    ? new Date(comp.registration_open).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  const wcaUrl = comp.url || `https://www.worldcubeassociation.org/competitions/${comp.id}`
  return `
<div style="border:1px solid #e0e0e0;border-radius:6px;margin-bottom:10px;overflow:hidden;">
  <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;">
    <div style="background:#004d40;color:#fff;border-radius:5px;padding:6px 10px;text-align:center;min-width:44px;flex-shrink:0;">
      <div style="font-size:18px;font-weight:700;line-height:1;">${day}</div>
      <div style="font-size:10px;opacity:0.8;">${mon}</div>
    </div>
    <div style="flex:1;">
      <div style="font-size:13px;font-weight:700;color:#003f88;">${comp.name}</div>
      <div style="font-size:11px;color:#555;margin-top:2px;">${comp.country_iso2} · ${comp.city || ''}</div>
    </div>
  </div>
  <div style="background:#f9f9f9;border-top:1px solid #e0e0e0;padding:7px 14px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
    ${events.slice(0, 8).map(e => `<span style="background:#e0f2f1;color:#004d40;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;">${e}</span>`).join('')}
    ${regOpen ? `<span style="margin-left:auto;font-size:11px;color:#555;">Reg opens: ${regOpen}</span>` : ''}
    <a href="${wcaUrl}" style="font-size:11px;color:#003f88;text-decoration:none;">View on WCA ↗</a>
  </div>
</div>`
}

function buildEmail(subscriber, newComps, regOpenComps, regClosingComps) {
  const sections = []
  if (newComps.length > 0 && subscriber.alertAnnounced)
    sections.push({ title: `🆕 ${newComps.length} new competition${newComps.length > 1 ? 's' : ''} announced`, comps: newComps })
  if (regOpenComps.length > 0 && subscriber.alertRegOpen)
    sections.push({ title: '📋 Registration now open', comps: regOpenComps })
  if (regClosingComps.length > 0 && subscriber.alertRegClosing)
    sections.push({ title: '⏰ Registration closing in 7 days', comps: regClosingComps })
  if (sections.length === 0) return null

  const totalCount = sections.reduce((n, s) => n + s.comps.length, 0)
  const subject = `🏆 ${totalCount} WCA competition alert${totalCount > 1 ? 's' : ''} · ${subscriber.countries.join(', ')}`
  const unsubUrl = `${APP_URL}/api/unsubscribe?token=${subscriber.token}`
  const sectionsHtml = sections.map(s =>
    `<h3 style="font-size:13px;font-weight:700;color:#333;margin:16px 0 8px;">${s.title}</h3>${s.comps.map(compCard).join('')}`
  ).join('')

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;">
  <div style="background:#003f88;padding:20px 24px;color:#fff;">
    <h1 style="margin:0;font-size:18px;">${totalCount} competition alert${totalCount > 1 ? 's' : ''}</h1>
    <p style="margin:4px 0 0;font-size:12px;opacity:0.7;">Matching: ${subscriber.countries.join(', ')}${subscriber.events.length > 0 ? ' · ' + subscriber.events.map(e => EVENT_SHORT[e] || e).join(', ') : ''}</p>
  </div>
  <div style="padding:16px 24px;">${sectionsHtml}
    <div style="text-align:center;padding:16px 0 8px;">
      <a href="${APP_URL}" style="display:inline-block;background:#00695c;color:#fff;font-size:13px;font-weight:700;padding:10px 24px;border-radius:6px;text-decoration:none;">View on WCA-CompTrack ↗</a>
    </div>
  </div>
  <div style="padding:14px 24px 20px;border-top:1px solid #eee;text-align:center;font-size:11px;color:#aaa;">
    You're receiving this because you subscribed to WCA CompAlert.<br>
    <a href="${APP_URL}/subscribe" style="color:#003f88;">Manage preferences</a> &nbsp;·&nbsp;
    <a href="${unsubUrl}" style="color:#003f88;">Unsubscribe</a>
  </div>
</div></body></html>`

  return { subject, html }
}

async function main() {
  const today = new Date()
  const curr = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  const prev = fs.existsSync(PREV_CACHE_FILE)
    ? JSON.parse(fs.readFileSync(PREV_CACHE_FILE, 'utf8'))
    : { wcifMap: {} }

  const currComps = Object.values(curr.wcifMap).map(d => d.comp)
  const prevIds = new Set(Object.keys(prev.wcifMap))

  const newlyAnnounced = currComps.filter(c => !prevIds.has(c.id))

  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const regJustOpened = currComps.filter(c => {
    if (!c.registration_open) return false
    const t = new Date(c.registration_open)
    return t >= yesterday && t <= today
  })

  const in7days = new Date(today); in7days.setDate(in7days.getDate() + 7)
  const in8days = new Date(today); in8days.setDate(in8days.getDate() + 8)
  const regClosingSoon = currComps.filter(c => {
    if (!c.registration_close) return false
    const t = new Date(c.registration_close)
    return t >= in7days && t < in8days
  })

  console.log(`New: ${newlyAnnounced.length}, Reg opened: ${regJustOpened.length}, Closing soon: ${regClosingSoon.length}`)

  if (!newlyAnnounced.length && !regJustOpened.length && !regClosingSoon.length) {
    console.log('Nothing to alert.')
    fs.copyFileSync(CACHE_FILE, PREV_CACHE_FILE)
    return
  }

  console.log('Loading subscribers...')
  const subscribers = await getSubscribers()
  console.log(`${subscribers.length} active subscribers`)

  const transporter = createTransport()
  let sent = 0

  for (const sub of subscribers) {
    const matchNew = newlyAnnounced.filter(c => compMatchesSubscriber(c, sub))
    const matchRegOpen = regJustOpened.filter(c => compMatchesSubscriber(c, sub))
    const matchClosing = regClosingSoon.filter(c => compMatchesSubscriber(c, sub))
    const email = buildEmail(sub, matchNew, matchRegOpen, matchClosing)
    if (!email) continue

    try {
      await transporter.sendMail({
        from: `WCA CompAlert <${GMAIL_USER}>`,
        to: sub.email,
        subject: email.subject,
        html: email.html,
      })
      console.log(`  Sent to ${sub.email}`)
      sent++
    } catch (e) {
      console.error(`  Failed ${sub.email}:`, e.message)
    }
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`Sent ${sent} alert emails.`)
  fs.copyFileSync(CACHE_FILE, PREV_CACHE_FILE)
}

main().catch(e => { console.error(e); process.exit(1) })
