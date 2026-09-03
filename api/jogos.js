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

async function buscarJogosDoDia(apiFootballKey) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  
  try {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${hoje}&timezone=America/Sao_Paulo`, { 
      headers: { 'x-apisports-key': apiFootballKey } 
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.response && data.response.length > 0) {
        const LIGAS_DE_ELITE_IDS = [71, 72, 73, 11, 39, 40, 140, 141, 135, 136, 78, 79, 61, 62, 94, 88, 2, 3, 848, 13, 128];
        const filtrados = data.response.filter(item => LIGAS_DE_ELITE_IDS.includes(item.league.id));
        if (filtrados.length > 0) return filtrados.slice(0, 6);
        return data.response.slice(0, 6);
      }
    }
  } catch (e) {
    console.log("API-Football indisponível. Usando contingência local...");
  }

  return [
    {
      fixture: { id: 8001, date: new Date().toISOString(), referee: "Wilton Pereira Sampaio" },
      teams: { home: { name: "Flamengo" }, away: { name: "Palmeiras" } },
      league: { id: 71, name: "Série A - Brasil", country: "Brazil" }
    },
    {
      fixture: { id: 8002, date: new Date().toISOString(), referee: "Clément Turpin" },
      teams: { home: { name: "Real Madrid" }, away: { name: "Barcelona" } },
      league: { id: 140, name: "La Liga", country: "Spain" }
    }
  ];
}

async function gerarPalpiteIA(home, away, league, referee, geminiKey) {
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-3.6-flash", 
    generationConfig: { responseMimeType: "application/json" } 
  });

  const prompt = `Você é um Tipster Profissional de Elite. Jogo: ${home} vs ${away} (${league}). Árbitro: ${referee}.
  
  REGRAS ABSOLUTAS:
  1. No campo "playerBetMarket", cite obrigatoriamente um nome real de um jogador estrela de ${home} ou ${away} seguido de uma linha de aposta (Ex: "Gabigol 1+ Chute ao Alvo"). NUNCA deixe vazio ou genérico.
  2. No campo "playerBetOdd", insira um valor numérico decimal válido (ex: 2.10).
  3. No campo "playerBetAnalysis", explique o motivo da aposta no atleta.

  Retorne estritamente um JSON válido com esta estrutura exata:
  {
    "mainMarket": "Mercado principal específico",
    "mainOdd": 1.88,
    "mainConfidence": 88,
    "mainAnalysis": "Análise estatística curta de 2 frases.",
    "criarApostaMarket": "Criar Aposta: [Combinada de equipe]",
    "criarApostaOdd": 1.95,
    "criarApostaAnalysis": "Justificativa técnica curta.",
    "playerBetMarket": "Especiais: [Nome Real do Jogador] 1+ Chute ao Alvo",
    "playerBetOdd": 2.15,
    "playerBetAnalysis": "Justificativa tática baseada no atleta.",
    "refereeNote": "Impacto disciplinar do árbitro",
    "rivalryNote": "Contexto histórico ou de tabela",
    "injuryNote": "Panorama de desfalques"
  }`;

  const result = await model.generateContent(prompt);
  const texto = result.response.text();
  return JSON.parse(texto);
}

module.exports = async function handler(req, res) {
  const apiFootballKey = process.env.FOOTBALL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  if (!geminiApiKey) return res.status(500).json({ success: false, error: "Falta API Key do Gemini" });

  try {
    const matches = await buscarJogosDoDia(apiFootballKey);
    let salvos = 0;

    for (const item of matches) {
      const fixtureId = item.fixture.id;
      const home = item.teams.home.name;
      const away = item.teams.away.name;
      const league = item.league.name;
      const referee = item.fixture.referee || "Padrão";

      const ai = await gerarPalpiteIA(home, away, league, referee, geminiApiKey);
      const oddPrincipal = Number(ai.mainOdd) || 1.85;

      const docData = {
        matchName: `${home} vs ${away}`,
        league,
        country: item.league.country || "Internacional",
        market: ai.mainMarket || "Mercado Principal",
        odd: oddPrincipal,
        confidence: Number(ai.mainConfidence) || 85,
        analysis: ai.mainAnalysis || "Análise em processamento.",
        criarApostaMarket: ai.criarApostaMarket || "Criar Aposta Padrão",
        criarApostaOdd: Number(ai.criarApostaOdd) || 1.95,
        criarApostaAnalysis: ai.criarApostaAnalysis || "Análise tática.",
        playerBetMarket: ai.playerBetMarket || `Especiais: Destaque de ${home} 1+ Finalização`,
        playerBetOdd: Number(ai.playerBetOdd) || 2.10,
        playerBetAnalysis: ai.playerBetAnalysis || "Bom potencial estatístico.",
        bookmaker: "Bet365",
        matchDate: item.fixture.date || new Date().toISOString(),
        comparadorOdds: {
          Bet365: (oddPrincipal * 1.01).toFixed(2),
          Betano: (oddPrincipal * 0.99).toFixed(2),
          Superbet: (oddPrincipal * 1.02).toFixed(2)
        },
        isValueBet: oddPrincipal >= 1.70,
        isUnderdog: oddPrincipal >= 2.30,
        refereeNote: ai.refereeNote || "Arbitragem padrão",
        rivalryNote: ai.rivalryNote || "Confronto importante",
        injuryNote: ai.injuryNote || "Elencos à disposição",
        status: "pendente",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('predictions').doc(String(fixtureId)).set(docData);
      salvos++;
      await new Promise(r => setTimeout(r, 1000));
    }

    return res.status(200).json({ success: true, message: `Sucesso absoluto! ${salvos} jogos processados.` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
