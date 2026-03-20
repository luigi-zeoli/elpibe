export const config = { api: { bodyParser: true } };

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://elpibe.vercel.app/api/google';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ── AUTH: Login redirect ──────────────────────
  if (action === 'login') {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'openid', 'email', 'profile'
    ].join(' ');

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI + '?action=callback')}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `access_type=offline&prompt=consent`;

    return res.redirect(authUrl);
  }

  // ── AUTH: OAuth callback ──────────────────────
  if (action === 'callback') {
    const { code, error } = req.query;
    if (error) return res.redirect('/?error=' + encodeURIComponent(error));
    if (!code) return res.redirect('/?error=no_code');

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI + '?action=callback',
          grant_type: 'authorization_code'
        })
      });
      const tokens = await tokenRes.json();
      if (tokens.error) return res.redirect('/?error=' + encodeURIComponent(tokens.error));

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const user = await userRes.json();

      const params = new URLSearchParams({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || '',
        expires_in: tokens.expires_in || 3600,
        email: user.email || '',
        name: user.name || ''
      });
      return res.redirect('/?' + params.toString());
    } catch (err) {
      return res.redirect('/?error=' + encodeURIComponent(err.message));
    }
  }

  // ── AUTH: Refresh token ───────────────────────
  if (action === 'refresh' && req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: body.refresh_token,
          client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
          grant_type: 'refresh_token'
        })
      });
      return res.status(200).json(await tokenRes.json());
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── CHAT: Claude API ──────────────────────────
  if (action === 'chat' && req.method === 'POST') {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key not configured' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: body.model || 'claude-sonnet-4-20250514',
          max_tokens: body.max_tokens || 1500,
          system: body.system,
          messages: body.messages
        })
      });
      return res.status(response.status).json(await response.json());
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GMAIL ─────────────────────────────────────
  if (action === 'gmail' && req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { access_token, gmail_action, messageId, to, subject, message } = body;
    if (!access_token) return res.status(401).json({ error: 'No access token' });
    const headers = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };

    try {
      if (gmail_action === 'list') {
        const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&labelIds=INBOX', { headers });
        const listData = await listRes.json();
        if (!listData.messages) return res.json({ emails: [] });
        const emails = await Promise.all(listData.messages.slice(0,10).map(async (msg) => {
          const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers });
          const msgData = await msgRes.json();
          const hdrs = msgData.payload?.headers || [];
          return {
            id: msg.id,
            from: hdrs.find(h=>h.name==='From')?.value||'',
            subject: hdrs.find(h=>h.name==='Subject')?.value||'(sin asunto)',
            date: hdrs.find(h=>h.name==='Date')?.value||'',
            snippet: msgData.snippet||''
          };
        }));
        return res.json({ emails });
      }
      if (gmail_action === 'send') {
        const emailContent = [`To: ${to}`,`Subject: ${subject}`,'Content-Type: text/plain; charset=utf-8','',message].join('\n');
        const encoded = Buffer.from(emailContent).toString('base64url');
        const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method:'POST', headers, body: JSON.stringify({ raw: encoded }) });
        return res.json(await sendRes.json());
      }
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── CALENDAR ──────────────────────────────────
  if (action === 'calendar' && req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { access_token, cal_action, event } = body;
    if (!access_token) return res.status(401).json({ error: 'No access token' });
    const headers = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };

    try {
      if (cal_action === 'list') {
        const now = new Date().toISOString();
        const weekLater = new Date(Date.now() + 7*24*60*60*1000).toISOString();

        // Get all calendars
        const calListRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers });
        const calList = await calListRes.json();
        const calendars = (calList.items||[]).filter(c => c.accessRole !== 'none');

        // Fetch events from all calendars
        const allEvents = await Promise.all(calendars.map(async (cal) => {
          try {
            const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${now}&timeMax=${weekLater}&singleEvents=true&orderBy=startTime&maxResults=15`, { headers });
            const d = await r.json();
            return (d.items||[]).map(e => ({
              title: e.summary||'(sin título)',
              calendar: cal.summary||cal.id,
              start: e.start?.dateTime||e.start?.date||'',
              end: e.end?.dateTime||e.end?.date||'',
              description: e.description||'',
              location: e.location||''
            }));
          } catch { return []; }
        }));

        const events = allEvents.flat().sort((a,b) => a.start.localeCompare(b.start));
        return res.json({ events });
      }
      if (cal_action === 'create') {
        const createRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method:'POST', headers, body: JSON.stringify(event) });
        return res.json(await createRes.json());
      }
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
