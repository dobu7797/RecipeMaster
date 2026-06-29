module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

    const { url } = JSON.parse(rawBody);
    if (!url) return res.status(400).json({ error: 'No URL provided' });

    // Fetch the recipe page
    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
        'Accept-Language': 'de-DE,de;q=0.9'
      }
    });
    const html = await pageRes.text();

    // Try JSON-LD schema.org/Recipe (used by most recipe sites)
    const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
    let recipe = null;

    for (const block of jsonLdMatches) {
      try {
        const inner = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '').trim();
        const parsed = JSON.parse(inner);
        const items = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
        for (const item of items) {
          if (item['@type'] === 'Recipe' || (Array.isArray(item['@type']) && item['@type'].includes('Recipe'))) {
            recipe = item;
            break;
          }
        }
        if (recipe) break;
      } catch(e) {}
    }

    if (!recipe) return res.status(404).json({ error: 'No recipe found on this page. Try manual entry.' });

    // Parse ingredients
    const ingredients = (recipe.recipeIngredient || []).map(i => String(i).trim()).filter(Boolean);

    // Parse steps
    let steps = [];
    const instructions = recipe.recipeInstructions || [];
    if (typeof instructions === 'string') {
      steps = instructions.split('\n').map(s => s.trim()).filter(Boolean);
    } else if (Array.isArray(instructions)) {
      steps = instructions.map(s => {
        if (typeof s === 'string') return s.trim();
        return (s.text || s.name || '').trim();
      }).filter(Boolean);
    }

    // Parse time
    const parseDuration = (iso) => {
      if (!iso) return '';
      const h = iso.match(/(\d+)H/)?.[1];
      const m = iso.match(/(\d+)M/)?.[1];
      if (h && m) return `${h} Std. ${m} Min.`;
      if (h) return `${h} Stunde${h>1?'n':''}`;
      if (m) return `${m} Minuten`;
      return '';
    };
    const time = parseDuration(recipe.totalTime || recipe.cookTime || recipe.prepTime);

    // Parse servings
    const servings = String(recipe.recipeYield || recipe.yield || '').replace(/[^\d]/g, '') || '';

    // Detect category
    const allText = [...ingredients, ...(recipe.keywords||'').split(','), recipe.name||'', recipe.description||''].join(' ').toLowerCase();
    let category = 'fleisch';
    const meatWords = ['fleisch','hack','rind','schwein','huhn','hähnchen','pute','fisch','lachs','thunfisch','garnelen','speck','wurst','salami','schinken','beef','chicken'];
    const meatFound = meatWords.some(w => allText.includes(w));
    const sweetWords = ['kuchen','torte','dessert','pudding','eis','schokolad','süß','brownie','muffin','keks','waffel','palatschinken','pfannkuchen'];
    const sweetFound = sweetWords.some(w => allText.includes(w));
    const meatIngredients = ['fleisch','hack','rind','schwein','huhn','hähnchen','pute','fisch','lachs','thunfisch','garnelen','speck','wurst','salami','schinken'];
    const hasMeat = ingredients.some(i => meatIngredients.some(w => i.toLowerCase().includes(w)));
    const hasEggDairy = allText.includes('ei') || allText.includes('milch') || allText.includes('käse') || allText.includes('butter') || allText.includes('sahne') || allText.includes('joghurt');

    if (sweetFound) category = 'suess';
    else if (hasMeat || meatFound) category = 'fleisch';
    else if (hasEggDairy) category = 'vegetarisch';
    else category = 'vegan';

    // Emoji by category
    const emojis = { vegan:'🥬', vegetarisch:'🥗', fleisch:'🥩', suess:'🍰' };

    return res.status(200).json({
      name: recipe.name || 'Unbekanntes Rezept',
      category,
      description: (recipe.description || '').replace(/<[^>]+>/g,'').trim().substring(0, 300),
      ingredients,
      steps,
      time,
      servings,
      emoji: emojis[category]
    });

  } catch (e) {
    console.error('Scraper error:', e.message);
    return res.status(500).json({ error: 'Scraper error', detail: e.message });
  }
};
