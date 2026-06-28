module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Read raw body from stream
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    console.log('Raw body length:', rawBody.length);
    console.log('Raw body preview:', rawBody.substring(0, 200));

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch(parseErr) {
      console.error('JSON parse error:', parseErr.message);
      return res.status(400).json({ error: 'Invalid JSON body', detail: parseErr.message });
    }

    // Add web_search tool
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

    console.log('Calling Anthropic, model:', body.model);

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body)
    });

    const data = await anthropicRes.json();
    console.log('Anthropic status:', anthropicRes.status);
    return res.status(anthropicRes.status).json(data);

  } catch (e) {
    console.error('Proxy error:', e.message, e.stack);
    return res.status(500).json({ error: 'Proxy error', detail: e.message });
  }
};
