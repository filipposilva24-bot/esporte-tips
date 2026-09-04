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

// 🛑 MODO SIMULADOR: Testando a IA 3.6-flash com Firebase
async function buscarJogosMock() {
  return [
    {
      fixture: { id: 999001, date: "2026-09-04T16:00:00-03:00", referee: "Michael Oliver" },
      league: { id: 39, name: "Premier League", country: "England" },
      teams: { home: { name: "Arsenal" }, away: { name: "Liverpool" } }
    },
    {
      fixture: { id: 999002, date: "2026-09-04T15:45:00-03:00", referee: "Marco Guida" },
      league: { id: 135, name: "Serie A", country: "Italy" },
      teams: { home: { name: "Genoa" }, away: { name: "Como" } }
    },
    {
      fixture: { id: 999003, date: "2026-09-04T15:30:00-03:00", referee: "Felix Zwayer" },
      league: { id: 78, name: "Bundesliga", country: "Germany" },
      teams: { home: { name: "VfB Stuttgart" }, away: { name: "1. FC Köln" } }
    }
  ];
}

async function buscarDadosOddsMock(homeTeam) {
  if (homeTeam === "Arsenal") {
    return { bookmaker: "Bet365", jogadoresExtraidos: [{ mercado: "Player Shots on Target", jogador: "Bukayo Saka", odd: 1.83 }, { mercado: "Player To Score", jogador: "Mohamed Salah", odd: 2.40 }] };
  } else if (homeTeam === "Genoa") {
    return { bookmaker: "Betano", jogadoresExtraidos: [{ mercado: "Player To Score", jogador: "Mateo Retegui", odd: 2.90 }, { mercado: "Player Shots", jogador: "Albert Gudmundsson", odd: 1.75 }] };
  } else {
    return { bookmaker: "Superbet", jogadoresExtraidos: [{ mercado: "Player To Score", jogador: "Serhou Guirassy", odd: 2.10 }, { mercado: "Player Shots on Target", jogador: "Chris Führich", odd: 1.85 }] };
  }
}

async function gerarPalpiteIA(home, away, league, referee, dadosOdds, geminiKey) {
  const genAI = new GoogleGenerativeAI(geminiKey);
  
  // USANDO O MODELO 3.6-FLASH QUE APARECE NO SEU PRINT!
  const model = genAI.getGenerativeModel({ 
    model: "gemini-3.6-flash", 
    generationConfig: { responseMimeType: "application/json" } 
  });

  const listaNomes = dadosOdds.jogadoresExtraidos.map(j => `${j.jogador} (${j.mercado} @${j.odd})`).join(', ');

  const prompt = `Você é um Tipster Profissional de Elite. Jogo: ${home} vs ${away} (${league}). Árbitro: ${referee}.
  
  ⚠️ AVISO CRÍTICO: USE EXATAMENTE ESTES JOGADORES CONFIRMADOS: [ ${listaNomes} ].
  
  REGRAS ABSOLUTAS:
  1. É PROIBIDO usar termos genéricos (Destaque, Atleta, Artilheiro). Escolha um dos jogadores da lista acima pelo NOME.
  2. No campo "playerBetMarket", crie um Especial Combinado focado nesse jogador (Ex: "Especiais: [Nome Real] 1+ Finalização no Alvo + Empate").
  3. No campo "playerBetOdd", use um valor numérico decimal coerente (ex: 2.15).

  Retorne JSON PURO (sem markdown) com esta estrutura exata:
  {
    "mainMarket": "Mercado principal",
    "mainOdd": 1.88,
    "mainConfidence": 88,
    "mainAnalysis": "Análise tática",
    "criarApostaMarket": "Criar Aposta: Combinada equipe",
    "criarApostaOdd": 1.95,
    "criarApostaAnalysis": "Justificativa",
    "playerBetMarket": "Especiais: [NOME DO JOGADOR] + Aposta combinada",
    "playerBetOdd": 2.15,
    "playerBetAnalysis": "Análise focada no jogador",
    "refereeNote": "Análise do árbitro",
    "rivalryNote": "Contexto",
    "injuryNote": "Desfalques"
  }`;

  const result = await model.generateContent(prompt);
  let textResponse = result.response.text();
  textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

  return JSON.parse(textResponse);
}

module.exports = async function handler(req, res) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) return res.status(500).json({ success: false, error: "Falta API Key do Gemini" });

  try {
    const matches = await buscarJogosMock();
    let salvos = 0;

    for (const item of matches) {
      const fixtureId = item.fixture.id;
      const home = item.teams.home.name;
      const away = item.teams.away.name;
      const league = item.league.name;
      const referee = item.fixture.referee;

      const dadosOdds = await buscarDadosOddsMock(home);

      let ai;
      try {
        ai = await gerarPalpiteIA(home, away, league, referee, dadosOdds, geminiApiKey);
      } catch (errAI) {
        console.error(`Erro na IA para ${home} vs ${away}:`, errAI.message);
        continue; 
      }

      const oddPrincipal = Number(ai.mainOdd) || 1.85;
      const docData = {
        matchName: `${home} vs ${away}`, league, country: item.league.country,
        market: ai.mainMarket, odd: oddPrincipal, confidence: Number(ai.mainConfidence) || 85, analysis: ai.mainAnalysis,
        criarApostaMarket: ai.criarApostaMarket, criarApostaOdd: Number(ai.criarApostaOdd) || 1.95, criarApostaAnalysis: ai.criarApostaAnalysis,
        playerBetMarket: ai.playerBetMarket, playerBetOdd: Number(ai.playerBetOdd) || 2.10, playerBetAnalysis: ai.playerBetAnalysis,
        bookmaker: dadosOdds.bookmaker, matchDate: item.fixture.date, status: "pendente",
        comparadorOdds: { Bet365: (oddPrincipal * 1.01).toFixed(2), Betano: (oddPrincipal * 0.99).toFixed(2), Superbet: (oddPrincipal * 1.02).toFixed(2) },
        isValueBet: oddPrincipal >= 1.70, isUnderdog: oddPrincipal >= 2.30, refereeNote: ai.refereeNote, rivalryNote: ai.rivalryNote, injuryNote: ai.injuryNote,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('predictions').doc(String(fixtureId)).set(docData);
      salvos++;
      await new Promise(r => setTimeout(r, 2000));
    }
    return res.status(200).json({ success: true, message: `MODO SIMULADOR 3.6: Painel atualizado com ${salvos} jogos de teste!` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
