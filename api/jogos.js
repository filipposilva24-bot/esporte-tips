const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require("@google/generative-ai");

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (error) {
    console.error("Erro ao carregar credenciais:", error);
  }
}

const db = admin.firestore();
const LIGAS_DE_ELITE_IDS = [71, 72, 73, 11, 39, 40, 140, 141, 135, 136, 78, 79, 61, 62, 94, 88, 2, 3, 848, 13, 128];

async function buscarDadosAvancadosFixture(fixtureId, apiFootballKey) {
  try {
    const response = await fetch(`https://v3.football.api-sports.io/odds?fixture=${fixtureId}`, { headers: { 'x-apisports-key': apiFootballKey } });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.response || data.response.length === 0) return null;

    const bookmakers = data.response[0].bookmakers || [];
    const casasAlvo = ["Bet365", "Betano", "Superbet"];
    let bk = bookmakers.find(b => casasAlvo.some(casa => b.name.toLowerCase().includes(casa.toLowerCase()))) || bookmakers[0];

    let resumoMercados = [];
    let jogadoresExtraidos = [];

    if (bk && bk.bets) {
      bk.bets.forEach(b => {
        const nomeM = b.name.toLowerCase();
        if (nomeM.includes('player') || nomeM.includes('scorer') || nomeM.includes('shots')) {
          b.values.forEach(v => {
            if (v.value && v.value.length > 3 && !v.value.toLowerCase().includes('yes') && !v.value.toLowerCase().includes('no')) {
              jogadoresExtraidos.push({ mercado: b.name, jogador: v.value, odd: v.odd });
            }
          });
        }
        resumoMercados.push(`- ${b.name}: [${b.values.slice(0, 3).map(val => `${val.value}: @${val.odd}`).join(', ')}]`);
      });
    }

    return { 
      bookmaker: bk ? bk.name : "Bet365", 
      mercadosTexto: resumoMercados.slice(0, 20).join('\n'),
      jogadoresExtraidos
    };
  } catch (e) { 
    return null; 
  }
}

async function gerarAnaliseComIA(homeTeam, awayTeam, league, refereeName, dadosOdds, geminiApiKey) {
  if (!geminiApiKey) throw new Error("Sem API Key do Gemini");

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  // O SEGREDO ESTÁ AQUI: Forçar saída JSON nativa para nunca mais dar erro de parsing
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const nomeCasa = dadosOdds ? dadosOdds.bookmaker : "Bet365";
  let sugestaoJogadorDireta = null;
  let contextoExtra = "";

  if (dadosOdds && dadosOdds.jogadoresExtraidos.length > 0) {
    const j = dadosOdds.jogadoresExtraidos[Math.floor(Math.random() * dadosOdds.jogadoresExtraidos.length)];
    sugestaoJogadorDireta = { market: `Especiais (${j.mercado}): ${j.jogador}`, odd: Number(j.odd) || 2.10 };
    contextoExtra = `A ${nomeCasa} oferece este jogador real nas odds: ${j.jogador}. USE ESTE NOME.`;
  } else {
    contextoExtra = `A API de odds não retornou jogadores. VOCÊ DEVE BUSCAR NA SUA BASE DE DADOS os nomes reais dos principais jogadores de ${homeTeam} e ${awayTeam}.`;
  }

  const prompt = `Você é um Tipster Profissional. Jogo: ${homeTeam} vs ${awayTeam} (${league}).
  ${contextoExtra}
  
  REGRAS ABSOLUTAS:
  1. No campo "playerBetMarket", NUNCA use "Atacante do time", "Jogador A" ou termos genéricos. Você DEVE escrever nomes próprios e reais de atletas que jogam nestas equipes (Ex: "Pedro 1+ Chute ao Alvo + Arrascaeta para cometer falta").
  
  Retorne EXATAMENTE este modelo JSON:
  {
    "mainMarket": "Mercado principal",
    "mainOdd": 1.88,
    "mainConfidence": 88,
    "mainAnalysis": "Análise de 2 frases.",
    "criarApostaMarket": "Criar Aposta Clássico: [Sua combinada]",
    "criarApostaOdd": 1.95,
    "criarApostaAnalysis": "Justificativa.",
    "playerBetMarket": "Especiais: [NOME REAL DO JOGADOR] 1+ Chute + [NOME REAL]",
    "playerBetOdd": ${sugestaoJogadorDireta ? sugestaoJogadorDireta.odd : 2.15},
    "playerBetAnalysis": "Análise tática citando os atletas.",
    "refereeNote": "Árbitro",
    "rivalryNote": "Contexto",
    "injuryNote": "Desfalques"
  }`;

  try {
    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text());

    // Se o modelo desobedecer e não colocar nomes, forçamos o nome da sugestão (se existir)
    if (sugestaoJogadorDireta && (parsed.playerBetMarket.includes("Atacante") || parsed.playerBetMarket.includes("Jogador"))) {
      parsed.playerBetMarket = sugestaoJogadorDireta.market;
    }

    return parsed;
  } catch (error) {
    console.error("Erro no Gemini:", error);
    throw error;
  }
}

module.exports = async function handler(req, res) {
  const apiFootballKey = process.env.FOOTBALL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!apiFootballKey || !geminiApiKey) return res.status(500).json({ success: false, error: "Faltam Chaves de API." });

  try {
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${hoje}&timezone=America/Sao_Paulo`, { headers: { 'x-apisports-key': apiFootballKey } });
    const data = await response.json();
    const allMatches = data.response || [];
    const matches = allMatches.filter(item => LIGAS_DE_ELITE_IDS.includes(item.league.id)).slice(0, 5); 
    
    let salvos = 0;

    for (const item of matches) {
      const fixtureId = item.fixture.id;
      const homeTeam = item.teams.home.name;
      const awayTeam = item.teams.away.name;
      const league = item.league.name;
      const refereeName = item.fixture.referee || 'Padrão';
      
      let predictionData;
      try {
        const dadosOdds = await buscarDadosAvancadosFixture(fixtureId, apiFootballKey);
        const analise = await gerarAnaliseComIA(homeTeam, awayTeam, league, refereeName, dadosOdds, geminiApiKey);
        
        predictionData = {
          matchName: `${homeTeam} vs ${awayTeam}`,
          league, country: item.league.country || "Internacional",
          market: analise.mainMarket || `Vitória: ${homeTeam}`,
          odd: analise.mainOdd || 1.85,
          confidence: analise.mainConfidence || 88,
          analysis: analise.mainAnalysis || "Análise do jogo.",
          criarApostaMarket: analise.criarApostaMarket,
          criarApostaOdd: analise.criarApostaOdd,
          criarApostaAnalysis: analise.criarApostaAnalysis,
          playerBetMarket: analise.playerBetMarket,
          playerBetOdd: analise.playerBetOdd,
          playerBetAnalysis: analise.playerBetAnalysis,
          bookmaker: dadosOdds ? dadosOdds.bookmaker : "Bet365",
          matchDate: item.fixture.date,
          comparadorOdds: {
            Bet365: ((analise.mainOdd || 1.85) * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2),
            Betano: ((analise.mainOdd || 1.85) * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2),
            Superbet: ((analise.mainOdd || 1.85) * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2)
          },
          isValueBet: (analise.mainOdd >= 1.70),
          isUnderdog: (analise.mainOdd >= 2.30),
          refereeNote: analise.refereeNote,
          rivalryNote: analise.rivalryNote,
          injuryNote: analise.injuryNote,
          homeStrength: 50 + (Number(fixtureId) % 30),
          awayStrength: 50 + ((Number(fixtureId) * 3) % 25),
          status: "pendente",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
      } catch (fallbackError) {
        // Fallback de emergência real só se tudo falhar
        predictionData = {
          matchName: `${homeTeam} vs ${awayTeam}`, league, country: item.league.country,
          market: "Mais de 1.5 Gols", odd: 1.45, confidence: 80, analysis: "Análise base (IA indisponível).",
          criarApostaMarket: "Indisponível", criarApostaOdd: 1.0, criarApostaAnalysis: "Indisponível",
          playerBetMarket: "Indisponível", playerBetOdd: 1.0, playerBetAnalysis: "Indisponível",
          status: "pendente", createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
      }

      await db.collection('predictions').doc(String(fixtureId)).set(predictionData);
      salvos++;
      await new Promise(resolve => setTimeout(resolve, 1500)); // Evita limite de taxa da API
    }
    return res.status(200).json({ success: true, message: `${salvos} jogos atualizados sem erros de quebra de texto.` });
  } catch (error) { 
    return res.status(500).json({ success: false, error: error.message }); 
  }
};
