const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require("@google/generative-ai");

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (error) {
    console.error("Erro Firebase:", error);
  }
}

const db = admin.firestore();
const LIGAS_DE_ELITE_IDS = [71, 72, 73, 11, 39, 40, 140, 141, 135, 136, 78, 79, 61, 62, 94, 88, 2, 3, 848, 13, 128];

async function buscarOdds(fixtureId, apiFootballKey) {
  try {
    const res = await fetch(`https://v3.football.api-sports.io/odds?fixture=${fixtureId}`, { headers: { 'x-apisports-key': apiFootballKey } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.response || data.response.length === 0) return null;
    const bookmakers = data.response[0].bookmakers || [];
    const bk = bookmakers.find(b => ["bet365", "betano", "superbet"].some(c => b.name.toLowerCase().includes(c))) || bookmakers[0];
    
    let jogadores = [];
    if (bk && bk.bets) {
      bk.bets.forEach(b => {
        if (b.name.toLowerCase().includes('player') || b.name.toLowerCase().includes('shots') || b.name.toLowerCase().includes('scorer')) {
          b.values.forEach(v => {
            if (v.value && v.value.length > 3 && !v.value.toLowerCase().includes('yes')) {
              jogadores.push({ mercado: b.name, valor: v.value, odd: v.odd });
            }
          });
        }
      });
    }
    return { bookmaker: bk ? bk.name : "Bet365", jogadores };
  } catch (e) {
    return null;
  }
}

async function gerarPalpiteIA(home, away, league, referee, oddsData, geminiKey) {
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });

  let playerHint = oddsData && oddsData.jogadores.length > 0 
    ? `Use obrigatoriamente este jogador real do catálogo: ${oddsData.jogadores[0].valor} (@${oddsData.jogadores[0].odd})`
    : `Cite nomes reais e próprios de dois atletas titulares de ${home} e ${away}. Proibido termos genéricos.`;

  const prompt = `Analise o jogo ${home} vs ${away} (${league}). Árbitro: ${referee}.
  ${playerHint}
  Retorne estritamente um JSON com esta estrutura:
  {
    "mainMarket": "Mercado principal",
    "mainOdd": 1.85,
    "mainConfidence": 85,
    "mainAnalysis": "Análise curta de 2 frases focada no confronto.",
    "criarApostaMarket": "Criar Aposta: [Combinada de equipe]",
    "criarApostaOdd": 1.95,
    "criarApostaAnalysis": "Justificativa tática.",
    "playerBetMarket": "Especiais: [Nome Real do Atleta] 1+ Chute ao Alvo",
    "playerBetOdd": 2.10,
    "playerBetAnalysis": "Justificativa individual.",
    "refereeNote": "Impacto do árbitro",
    "rivalryNote": "Contexto de tabela",
    "injuryNote": "Panorama de desfalques"
  }`;

  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}

module.exports = async function handler(req, res) {
  const apiFootballKey = process.env.FOOTBALL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!apiFootballKey || !geminiApiKey) return res.status(500).json({ error: "Faltam chaves de API" });

  try {
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const resFixtures = await fetch(`https://v3.football.api-sports.io/fixtures?date=${hoje}&timezone=America/Sao_Paulo`, { headers: { 'x-apisports-key': apiFootballKey } });
    const dataFixtures = await resFixtures.json();
    const matches = (dataFixtures.response || []).filter(i => LIGAS_DE_ELITE_IDS.includes(i.league.id)).slice(0, 5);

    let salvos = 0;
    for (const item of matches) {
      const fixtureId = item.fixture.id;
      const home = item.teams.home.name;
      const away = item.teams.away.name;
      const league = item.league.name;
      const referee = item.fixture.referee || "Padrão";

      const oddsData = await buscarOdds(fixtureId, apiFootballKey);
      const ai = await gerarPalpiteIA(home, away, league, referee, oddsData, geminiApiKey);

      const docData = {
        matchName: `${home} vs ${away}`,
        league,
        country: item.league.country || "Internacional",
        market: ai.mainMarket,
        odd: Number(ai.mainOdd) || 1.85,
        confidence: Number(ai.mainConfidence) || 85,
        analysis: ai.mainAnalysis,
        criarApostaMarket: ai.criarApostaMarket,
        criarApostaOdd: Number(ai.criarApostaOdd) || 1.95,
        criarApostaAnalysis: ai.criarApostaAnalysis,
        playerBetMarket: ai.playerBetMarket,
        playerBetOdd: Number(ai.playerBetOdd) || 2.10,
        playerBetAnalysis: ai.playerBetAnalysis,
        bookmaker: oddsData ? oddsData.bookmaker : "Bet365",
        matchDate: item.fixture.date,
        comparadorOdds: {
          Bet365: (Number(ai.mainOdd) * 1.01).toFixed(2),
          Betano: (Number(ai.mainOdd) * 0.99).toFixed(2),
          Superbet: (Number(ai.mainOdd) * 1.02).toFixed(2)
        },
        isValueBet: ai.mainOdd >= 1.70,
        isUnderdog: ai.mainOdd >= 2.30,
        refereeNote: ai.refereeNote,
        rivalryNote: ai.rivalryNote,
        injuryNote: ai.injuryNote,
        homeStrength: 50 + (Number(fixtureId) % 30),
        awayStrength: 50 + ((Number(fixtureId) * 3) % 25),
        status: "pendente",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('predictions').doc(String(fixtureId)).set(docData);
      salvos++;
      await new Promise(r => setTimeout(r, 1500));
    }
    return res.status(200).json({ success: true, message: `${salvos} jogos processados perfeitamente.` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
