module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    let body = JSON.parse(rawBody);

    // Extract the URL from the message
    const userMsg = body.messages?.[0]?.content || '';
    const urlMatch = userMsg.match(/https?:\/\/[^\s"]+/);
    const url = urlMatch ? urlMatch[0] : null;

    let recipeText = '';
    if (url) {
      try {
        const pageRes = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)' }
        });
        const html = await pageRes.text();
        // Strip HTML tags and collapse whitespace
        recipeText = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 8000);
      } catch(e) {
        console.error('Fetch page error:', e.message);
      }
    }

    // Build clean request without tools
    const cleanBody = {
      model: body.model || 'claude-sonnet-4-6',
      max_tokens: body.max_tokens || 1000,
      messages: [{
        role: 'user',
        content: `Extrahiere das Rezept aus folgendem Webseiteninhalt und antworte NUR mit einem JSON-Objekt ohne Markdown:

URL: ${url}

Seiteninhalt:
${recipeText || 'Kein Inhalt verfügbar - bitte aus der URL ableiten.'}

Antworte ausschließlich mit diesem JSON:
{"name":"Rezeptname","category":"vegan|vegetarisch|fleisch|suess","description":"Kurze Beschreibung","ingredients":["200g Zutat 1","1 EL Zutat 2"],"steps":["Schritt 1","Schritt 2"],"time":"30 Minuten","servings":"4","emoji":"🍝"}

Kategorien: vegan=keine tierischen Produkte, vegetarisch=kein Fleisch/Fisch aber Milch/Eier ok, fleisch=Fleisch oder Fisch, suess=Desserts/Kuchen/Süßspeisen.`
      }]
    };

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(cleanBody)
    });

    const data = await anthropicRes.json();
    console.log('Anthropic status:', anthropicRes.status, JSON.stringify(data).substring(0, 200));
    return res.status(anthropicRes.status).json(data);

  } catch (e) {
    console.error('Proxy error:', e.message);
    return res.status(500).json({ error: 'Proxy error', detail: e.message });
  }
};
