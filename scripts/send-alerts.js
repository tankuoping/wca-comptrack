// Runs nightly via GitHub Actions
// Compares today's cache vs yesterday's - emails subscribers about new comps via Gmail
// Tracks alerted comps in Google Sheet to prevent duplicate alerts

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

async function getSheet(doc, title, headers) {
    let sheet = doc.sheetsByTitle[title]
    if (!sheet) sheet = await doc.addSheet({ title, headerValues: headers })
    return sheet
}

async function getAlertedComps(doc) {
    const sheet = await getSheet(doc, 'AlertedComps', ['comp_id', 'type', 'alerted_at'])
    const rows = await sheet.getRows()
    const alerted = new Set(rows.map(r => r.get('comp_id') + '|' + r.get('type')))
    return { sheet, alerted }
}

async function markAlerted(sheet, compId, type) {
    await sheet.addRow({ comp_id: compId, type, alerted_at: new Date().toISOString() })
}

async function getSubscribers(doc) {
    const sheet = await getSheet(doc, 'Subscribers', ['token','email','countries','events','alert_announced','alert_reg_open','alert_reg_closing','subscribed_at','active'])
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

async function main() {
    const { GoogleSpreadsheet } = require('google-spreadsheet')
    const { JWT } = require('google-auth-library')
    const jwt = new JWT({ email: CLIENT_EMAIL, key: PRIVATE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
    const doc = new GoogleSpreadsheet(SHEET_ID, jwt)
    await doc.loadInfo()

  const today = new Date()
    const curr = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    const prev = fs.existsSync(PREV_CACHE_FILE) ? JSON.parse(fs.readFileSync(PREV_CACHE_FILE, 'utf8')) : { wcifMap: {} }

        const currComps = Object.values(curr.wcifMap).map(d => d.comp)
    const prevIds = new Set(Object.keys(prev.wcifMap))
    const now = new Date()

  const { sheet: alertedSheet, alerted } = await getAlertedComps(doc)

  const newlyAnnounced = currComps.filter(c =>
        !prevIds.has(c.id) &&
        !alerted.has(c.id + '|announced') &&
        (!c.registration_close || new Date(c.registration_close) > now)
                                            )

  const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const regJustOpened = currComps.filter(c => {
          if (!c.registration_open) return false
          if (alerted.has(c.id + '|reg_open')) return false
          const t = new Date(c.registration_open)
          return t >= yesterday && t <= today
    })

  const in7days = new Date(today)
    in7days.setDate(in7days.getDate() + 7)
    const in8days = new Date(today)
    in8days.setDate(in8days.getDate() + 8)
    const regClosingSoon = currComps.filter(c => {
          if (!c.registration_close) return false
          if (alerted.has(c.id + '|reg_closing')) return false
          const t = new Date(c.registration_close)
          return t >= in7days && t < in8days
    })

  console.log('New: ' + newlyAnnounced.length + ', Reg opened: ' + regJustOpened.length + ', Closing soon: ' + regClosingSoon.length)

  if (!newlyAnnounced.length && !regJustOpened.length && !regClosingSoon.length) {
        console.log('Nothing to alert.')
        fs.copyFileSync(CACHE_FILE, PREV_CACHE_FILE)
        return
  }

  const subscribers = await getSubscribers(doc)
    console.log(subscribers.length + ' active subscribers')

  const transporter = createTransport()
    let sent = 0

  for (const sub of subscribers) {
        const matchNew = newlyAnnounced.filter(c => compMatchesSubscriber(c, sub))
        const matchRegOpen = regJustOpened.filter(c => compMatchesSubscriber(c, sub))
        const matchClosing = regClosingSoon.filter(c => compMatchesSubscriber(c, sub))
        if (!matchNew.length && !matchRegOpen.length && !matchClosing.length) continue

      try {
              await transporter.sendMail({
                        from: 'WCA CompAlert <' + GMAIL_USER + '>',
                        to: sub.email,
                        subject: 'WCA competition alert - ' + sub.countries.join(', '),
                        html: '<p>New competitions found matching your preferences. Visit WCA-CompTrack for details.</p>'
              })
              console.log('  Sent to ' + sub.email)
              sent++
      } catch (e) {
              console.error('  Failed ' + sub.email + ': ' + e.message)
      }
        await new Promise(r => setTimeout(r, 300))
  }

  for (const c of newlyAnnounced) await markAlerted(alertedSheet, c.id, 'announced')
    for (const c of regJustOpened) await markAlerted(alertedSheet, c.id, 'reg_open')
    for (const c of regClosingSoon) await markAlerted(alertedSheet, c.id, 'reg_closing')

  console.log('Sent ' + sent + ' alert emails.')
    fs.copyFileSync(CACHE_FILE, PREV_CACHE_FILE)
}

main().catch(e => { console.error(e); process.exit(1) })
