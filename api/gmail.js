export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { access_token, action, messageId, to, subject, message } = body;

  if (!access_token) return res.status(401).json({ error: 'No access token' });

  const headers = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };

  try {
    if (action === 'list') {
      // Get last 10 emails
      const listRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&labelIds=INBOX',
        { headers }
      );
      const listData = await listRes.json();

      if (!listData.messages) return res.json({ emails: [] });

      // Get details for each email
      const emails = await Promise.all(
        listData.messages.slice(0, 10).map(async (msg) => {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers }
          );
          const msgData = await msgRes.json();
          const hdrs = msgData.payload?.headers || [];
          return {
            id: msg.id,
            from: hdrs.find(h => h.name === 'From')?.value || '',
            subject: hdrs.find(h => h.name === 'Subject')?.value || '(sin asunto)',
            date: hdrs.find(h => h.name === 'Date')?.value || '',
            snippet: msgData.snippet || ''
          };
        })
      );
      return res.json({ emails });
    }

    if (action === 'read') {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
        { headers }
      );
      const msgData = await msgRes.json();
      const hdrs = msgData.payload?.headers || [];

      // Extract body
      let body = '';
      const parts = msgData.payload?.parts || [];
      const textPart = parts.find(p => p.mimeType === 'text/plain') || msgData.payload;
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }

      return res.json({
        from: hdrs.find(h => h.name === 'From')?.value || '',
        subject: hdrs.find(h => h.name === 'Subject')?.value || '',
        date: hdrs.find(h => h.name === 'Date')?.value || '',
        body: body.slice(0, 3000)
      });
    }

    if (action === 'send') {
      const emailContent = [
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        message
      ].join('\n');

      const encoded = Buffer.from(emailContent).toString('base64url');
      const sendRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        { method: 'POST', headers, body: JSON.stringify({ raw: encoded }) }
      );
      const sendData = await sendRes.json();
      return res.json(sendData);
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
