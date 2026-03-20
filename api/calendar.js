export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { access_token, action, event } = body;

  if (!access_token) return res.status(401).json({ error: 'No access token' });

  const headers = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };

  try {
    if (action === 'list') {
      const now = new Date().toISOString();
      const weekLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // Get all calendars first
      const calListRes = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
        { headers }
      );
      const calList = await calListRes.json();
      const calendars = (calList.items || []).filter(c => c.selected !== false);

      // Fetch events from all calendars in parallel
      const allEvents = await Promise.all(
        calendars.map(async (cal) => {
          try {
            const res = await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${now}&timeMax=${weekLater}&singleEvents=true&orderBy=startTime&maxResults=10`,
              { headers }
            );
            const data = await res.json();
            return (data.items || []).map(e => ({
              id: e.id,
              title: e.summary || '(sin título)',
              calendar: cal.summary || cal.id,
              start: e.start?.dateTime || e.start?.date || '',
              end: e.end?.dateTime || e.end?.date || '',
              description: e.description || '',
              location: e.location || ''
            }));
          } catch { return []; }
        })
      );

      // Flatten and sort by start time
      const events = allEvents.flat().sort((a, b) => a.start.localeCompare(b.start));
      return res.json({ events });
    }

    if (action === 'create') {
      const createRes = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        { method: 'POST', headers, body: JSON.stringify(event) }
      );
      const createData = await createRes.json();
      return res.json(createData);
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
