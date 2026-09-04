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

// LISTA DE ELITE (FA Cup ID 45 banida permanentemente)
const LIGAS_DE_ELITE_IDS = [
  71, 72, 73,       // Brasil (Série A, Série B, Copa do Brasil)
  39, 40,           // Inglaterra (Premier League, Championship)
  140, 141, 143,    // Espanha (La Liga, La Liga 2, Copa del Rey)
  135, 136, 137,    // Itália (Serie A, Serie B, Coppa Italia)
  78, 79, 81,       // Alemanha (Bundesliga, 2. Bundesliga, DFB Pokal)
  61, 62,           // França (Ligue 1, Ligue 2)
  2, 3, 848, 13, 11 // Internacionais (Champions, Europa, Conference, Libertadores, Sul-Americana)
];

async function buscarJogosDoDia(apiFootballKey) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  
  try {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${hoje}&timezone=America/Sao_Paulo`, { 
      headers: { 'x-apisports-key': apiFootballKey } 
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.response && data.response.length > 0) {
        console.log(`Total bruto de jogos na API hoje: ${data.response.length}`);
        
        // Filtra ligas permitidas e exclui a FA Cup (45)
        const jogosFiltrados = data.response.filter(item => 
          LIGAS_DE_ELITE_IDS.includes(item.league.id) && item.league.id !== 45
        );
        
        // 📊 TABELA DE PESOS RIGOROSA:
        // Peso 1: 1ª Divisão e Principais Continentais
        // Peso 2: Copas Nacionais e Outras Continentais
        // Peso 3: Segundas Divisões (Séries B)
        const prioridadeLigas = {
          71: 1, 39: 1, 140: 1, 135: 1, 78: 1, 61: 1, 2: 1, 13: 1, // Peso 1
          73: 2, 143: 2, 137: 2, 81: 2, 3: 2, 848: 2, 11: 2,       // Peso 2
          72: 3, 40: 3, 141: 3, 136: 3, 79: 3, 62: 3              // Peso 3
        };

        // Ordena aplicando estritamente a prioridade
        jogosFiltrados.sort((a, b) => {
          const pA = prioridadeLigas[a.league.id] || 99;
          const pB = prioridadeLigas[b.league.id] || 99;
          return pA - pB;
        });

        // 👀 LOG DE INSPEÇÃO: Mostra no console da Vercel a ordem exata para você conferir
        console.log("=== ORDEM DE PRIORIDADE DOS JOGOS PARA HOJE ===");
        jogosFiltrados.forEach((j, index) => {
          const p = prioridadeLigas[j.league.id] || 99;
          console.log(`${index + 1}. [Peso ${p}] ${j.teams.home.name} vs ${j.teams.away.name} (${j.league.name} - ID: ${j.league.id})`);
        });
        
        if (jogosFiltrados.length > 0) {
          return jogosFiltrados.slice(0, 10); 
        }
      }
    }
  } catch (e) {
    console.log("Erro ao buscar fixtures na API-Football:", e);
  }

  return [];
}

async function buscarDadosAvancadosFixture(fixtureId, apiFootballKey) {
  try {
    const response = await fetch(`https://v3.football.api-sports.io/odds?fixture=${fixtureId}`, { 
      headers: { 'x-apisports-key': apiFootballKey } 
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.response || data.response.length === 0) return null;

    const bookmakers = data.response[0].bookmakers || [];
    const bk = bookmakers.find(b => b.name === "Bet365" || b.name === "Betano") || bookmakers[0];

    let jogadoresExtraidos = [];
    if (bk && bk.bets) {
      bk.bets.forEach(b => {
        const nomeM = b.name.toLowerCase();
        if (nomeM.includes('player') || nomeM.includes('scorer') || nomeM.includes('shots') || nomeM.includes('target')) {
          b.values.forEach(v => {
            if (v.value && v.value.length > 3 && !v.value.toLowerCase().includes('yes') && !v.value.toLowerCase().includes('no')) {
              jogadoresExtraidos.push({ mercado: b.name, jogador: v.value, odd: v.odd });
            }
          });
        }
      });
    }

    return { bookmaker: bk ? bk.name : "Bet365", jogadoresExtraidos };
  } catch (e) { 
    return null; 
  }
}

async function gerarPalpiteIA(home, away, league, referee, dadosOdds, geminiKey) {
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-3.6-flash", 
    generationConfig: { responseMimeType: "application/json" } 
  });

  let contextoJogadores = "";
  if (dadosOdds && dadosOdds.jogadoresExtraidos && dadosOdds.jogadoresExtraidos.length > 0) {
    const listaNomes = dadosOdds.jogadoresExtraidos.slice(0, 8).map(j => `${j.jogador} (${j.mercado} @${j.odd})`).join(', ');
    contextoJogadores = `JOGADORES REAIS CONFIRMADOS NESTA PARTIDA: [ ${listaNomes} ].`;
  } else {
    contextoJogadores = `Cite nomes reais de atletas titulares que atuam em ${home} ou ${away}.`;
  }

  const prompt = `Você é um Tipster Profissional de Elite. Jogo: ${home} vs ${away} (${league}). Árbitro: ${referee}.
  ${contextoJogadores}
  
  REGRAS ABSOLUTAS:
  1. É PROIBIDO usar termos genéricos (Destaque, Atleta, Artilheiro). Escolha um jogador real pelo NOME.
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
  const apiFootballKey = process.env.FOOTBALL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  if (!geminiApiKey) return res.status(500).json({ success: false, error: "Falta API Key do Gemini" });
  if (!apiFootballKey) return res.status(500).json({ success: false, error: "Falta API Key da Football-API" });

  try {
    const matches = await buscarJogosDoDia(apiFootballKey);
    
    if (!matches || matches.length === 0) {
       return res.status(200).json({ success: true, message: "Nenhum jogo de elite encontrado para hoje." });
    }

    let salvos = 0;

    for (const item of matches) {
      if (salvos >= 10) break;

      const fixtureId = item.fixture.id;
      const home = item.teams.home.name;
      const away = item.teams.away.name;
      const league = item.league.name;
      const referee = item.fixture.referee || "Árbitro Oficial";

      const dadosOdds = await buscarDadosAvancadosFixture(fixtureId, apiFootballKey);

      let ai;
      try {
        ai = await gerarPalpiteIA(home, away, league, referee, dadosOdds, geminiApiKey);
      } catch (errAI) {
        console.error(`Erro na IA para ${home} vs ${away}:`, errAI.message);
        continue; 
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
        bookmaker: dadosOdds ? dadosOdds.bookmaker : "Bet365",
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
      salvos++;
      
      await new Promise(r => setTimeout(r, 2000));
    }

    return res.status(200).json({ success: true, message: `Painel atualizado com ${salvos} jogos ordenados por prioridade!` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
