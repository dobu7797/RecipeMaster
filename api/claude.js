module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Try req.body first (Vercel auto-parses JSON)
    let url;
    if (req.body && req.body.url) {
      url = req.body.url;
      console.log('Got URL from req.body:', url);
    } else {
      // Fallback: read raw stream
      const rawBody = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk.toString(); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      console.log('Raw body:', rawBody.substring(0, 300));
      const parsed = JSON.parse(rawBody);
      url = parsed.url;
    }

    if (!url) {
      console.error('No URL found in body');
      return res.status(400).json({ error: 'No URL provided' });
    }

    console.log('Fetching URL:', url);

    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-DE,de;q=0.9'
      }
    });

    console.log('Page status:', pageRes.status);
    const html = await pageRes.text();
    console.log('HTML length:', html.length);

    // Extract JSON-LD
    const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
    console.log('JSON-LD blocks found:', jsonLdMatches.length);

    let recipe = null;
    for (const block of jsonLdMatches) {
      try {
        const inner = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
        const parsed = JSON.parse(inner);
        const items = Array.isArray(parsed) ? parsed : (parsed['@graph'] ? parsed['@graph'] : [parsed]);
        for (const item of items) {
          const type = item['@type'];
          if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
            recipe = item;
            break;
          }
        }
        if (recipe) break;
      } catch(e) { console.log('JSON-LD parse error:', e.message); }
    }

    if (!recipe) {
      console.log('No recipe schema found');
      return res.status(404).json({ error: 'Kein Rezept auf dieser Seite gefunden. Bitte manuell eingeben.' });
    }

    console.log('Recipe found:', recipe.name);

    const ingredients = (recipe.recipeIngredient || []).map(i => String(i).trim()).filter(Boolean);

    let steps = [];
    const instr = recipe.recipeInstructions || [];
    if (typeof instr === 'string') {
      steps = instr.split(/\n|\.(?=\s)/).map(s => s.trim()).filter(s => s.length > 5);
    } else if (Array.isArray(instr)) {
      steps = instr.map(s => typeof s === 'string' ? s.trim() : (s.text || s.name || '').trim()).filter(Boolean);
    }

    const parseDuration = iso => {
      if (!iso) return '';
      const h = (iso.match(/(\d+)H/) || [])[1];
      const m = (iso.match(/(\d+)M/) || [])[1];
      if (h && m) return `${h} Std. ${m} Min.`;
      if (h) return `${h} Stunde${h > 1 ? 'n' : ''}`;
      if (m) return `${m} Minuten`;
      return '';
    };

    const time = parseDuration(recipe.totalTime || recipe.cookTime || recipe.prepTime);
    const servings = String(recipe.recipeYield || recipe.yield || '').replace(/\D/g, '') || '';

    const allText = [...ingredients, String(recipe.keywords || ''), String(recipe.name || ''), String(recipe.description || '')].join(' ').toLowerCase();
    const meatWords = ['fleisch','hack','rind','schwein','huhn','hähnchen','pute','fisch','lachs','thunfisch','garnelen','speck','wurst','salami','schinken','chicken','beef'];
    const sweetWords = ['kuchen','torte','dessert','pudding','eis','schokolad','brownie','muffin','keks','waffel','pfannkuchen','palatschinken','tiramisu'];
    const dairyWords = ['ei','milch','käse','butter','sahne','joghurt','quark'];
    let category = 'vegan';
    if (sweetWords.some(w => allText.includes(w))) category = 'suess';
    else if (meatWords.some(w => allText.includes(w))) category = 'fleisch';
    else if (dairyWords.some(w => allText.includes(w))) category = 'vegetarisch';

    const emojis = { vegan:'🥬', vegetarisch:'🥗', fleisch:'🥩', suess:'🍰' };

    return res.status(200).json({
      name: String(recipe.name || 'Rezept').trim(),
      category,
      description: String(recipe.description || '').replace(/<[^>]+>/g, '').trim().substring(0, 300),
      ingredients,
      steps,
      time,
      servings,
      emoji: emojis[category]
    });

  } catch(e) {
    console.error('Error:', e.message, e.stack);
    return res.status(500).json({ error: 'Fehler: ' + e.message });
  }
};
