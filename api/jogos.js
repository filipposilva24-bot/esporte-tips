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

const LIGAS_DE_ELITE_IDS = [
  71, 72, 73,       // Brasil
  39, 40,           // Inglaterra
  140, 141, 143,    // Espanha
  135, 136, 137,    // Itália
  78, 79, 81,       // Alemanha
  61, 62,           // França
  2, 3, 848, 13, 11 // Internacionais
];

async function buscarJogosDoDia(apiFootballKey) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  
  const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${hoje}&timezone=America/Sao_Paulo`, { 
    headers: { 'x-apisports-key': apiFootballKey } 
  });
  
  if (!res.ok) throw new Error("Erro ao conectar na API-Football");
  
  const data = await res.json();
  if (!data.response || data.response.length === 0) return [];
  
  let jogosFiltrados = data.response.filter(item => 
    LIGAS_DE_ELITE_IDS.includes(item.league.id) && item.league.id !== 45
  );

  if (jogosFiltrados.length === 0) {
    jogosFiltrados = data.response.filter(item => item.league.id !== 45);
  }
  
  const prioridadeLigas = {
    71: 1, 39: 1, 140: 1, 135: 1, 78: 1, 61: 1, 2: 1, 13: 1,
    73: 2, 143: 2, 137: 2, 81: 2, 3: 2, 848: 2, 11: 2,
    72: 3, 40: 3, 141: 3, 136: 3, 79: 3, 62: 3
  };

  jogosFiltrados.sort((a, b) => {
    const pA = prioridadeLigas[a.league.id] || 99;
    const pB = prioridadeLigas[b.league.id] || 99;
    return pA - pB;
  });

  return jogosFiltrados.slice(0, 1); // Testa apenas com o 1º jogo para ser instantâneo e não gastar cota
}

async function gerarPalpiteIA(home, away, league, referee, geminiKey) {
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash", // Testando com 1.5 padrão da SDK
    generationConfig: { responseMimeType: "application/json" } 
  });

  const prompt = `Tipster de Elite. Jogo: ${home} vs ${away} (${league}). Árbitro: ${referee}.
  Retorne EXATAMENTE um JSON puro sem markdown com esta estrutura:
  {
    "mainMarket": "Mais de 1.5 Gols",
    "mainOdd": 1.88,
    "mainConfidence": 88,
    "mainAnalysis": "Análise tática detalhada.",
    "criarApostaMarket": "Criar Aposta: Vitória + Gols",
    "criarApostaOdd": 1.95,
    "criarApostaAnalysis": "Justificativa.",
    "playerBetMarket": "Especiais: Jogador Real 1+ Finalização",
    "playerBetOdd": 2.15,
    "playerBetAnalysis": "Justificativa do atleta.",
    "refereeNote": "Árbitro",
    "rivalryNote": "Contexto",
    "injuryNote": "Desfalques"
  }`;

  const result = await model.generateContent(prompt);
  let textResponse = result.response.text();
  textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

  const match = textResponse.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }
  return JSON.parse(textResponse);
}

module.exports = async function handler(req, res) {
  const apiFootballKey = process.env.FOOTBALL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  if (!geminiApiKey) return res.status(500).json({ success: false, error: "Falta API Key do Gemini" });
  if (!apiFootballKey) return res.status(500).json({ success: false, error: "Falta API Key da Football-API" });

  try {
    const matches = await buscarJogosDoDia(apiFootballKey);
    
    if (!matches || matches.length === 0) {
       return res.status(200).json({ success: true, message: "Nenhum jogo disponível na API hoje." });
    }

    const item = matches[0];
    const fixtureId = item.fixture.id;
    const home = item.teams.home.name;
    const away = item.teams.away.name;
    const league = item.league.name;
    const referee = item.fixture.referee || "Árbitro Oficial";

    let ai;
    try {
      ai = await gerarPalpiteIA(home, away, league, referee, geminiApiKey);
    } catch (errAI) {
      // 🚨 ISSO VAI MOSTRAR O ERRO REAL NA SUA TELA AGORA
      return res.status(500).json({ 
        success: false, 
        erroCriticoDaIA: errAI.message, 
        detalhes: "A chave de API rejeitou o modelo. Veja a mensagem acima." 
      });
    }

    const oddPrincipal = Number(ai.mainOdd) || 1.85;

    const docData = {
      matchName: `${home} vs ${away}`,
      league,
      country: item.league.country || "Internacional",
      market: ai.mainMarket,
      odd: oddPrincipal,
      confidence: Number(ai.mainConfidence) || 85,
      analysis: ai.mainAnalysis,
      criarApostaMarket: ai.criarApostaMarket,
      criarApostaOdd: Number(ai.criarApostaOdd) || 1.95,
      criarApostaAnalysis: ai.criarApostaAnalysis,
      playerBetMarket: ai.playerBetMarket,
      playerBetOdd: Number(ai.playerBetOdd) || 2.10,
      playerBetAnalysis: ai.playerBetAnalysis,
      bookmaker: "Bet365",
      matchDate: item.fixture.date,
      comparadorOdds: {
        Bet365: (oddPrincipal * 1.01).toFixed(2),
        Betano: (oddPrincipal * 0.99).toFixed(2),
        Superbet: (oddPrincipal * 1.02).toFixed(2)
      },
      isValueBet: oddPrincipal >= 1.70,
      isUnderdog: oddPrincipal >= 2.30,
      refereeNote: ai.refereeNote,
      rivalryNote: ai.rivalryNote,
      injuryNote: ai.injuryNote,
      status: "pendente",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('predictions').doc(String(fixtureId)).set(docData);

    return res.status(200).json({ success: true, message: `Sucesso absoluto! Jogo ${home} vs ${away} gravado no Firebase!` });
  } catch (err) {
    return res.status(500).json({ success: false, erroGeral: err.message });
  }
};
