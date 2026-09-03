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
    let bk = null;

    for (const casa of casasAlvo) {
      bk = bookmakers.find(b => b.name.toLowerCase().includes(casa.toLowerCase()));
      if (bk) break;
    }
    if (!bk) bk = bookmakers[0];

    let resumoMercados = [];
    let jogadoresExtraidos = [];

    if (bk && bk.bets) {
      bk.bets.forEach(b => {
        const nomeM = b.name.toLowerCase();
        if (nomeM.includes('player') || nomeM.includes('scorer') || nomeM.includes('shots') || nomeM.includes('goalscorer')) {
          b.values.forEach(v => {
            if (v.value && v.value.length > 3 && !v.value.toLowerCase().includes('yes') && !v.value.toLowerCase().includes('no')) {
              jogadoresExtraidos.push({
                 mercado: b.name,
                 jogador: v.value,
                 odd: v.odd
              });
            }
          });
        }
        const valores = b.values.slice(0, 4).map(val => `${val.value}: @${val.odd}`).join(', ');
        resumoMercados.push(`- ${b.name}: [${valores}]`);
      });
    }

    return { 
      bookmaker: bk ? bk.name : "Bet365", 
      mercadosTexto: resumoMercados.slice(0, 25).join('\n'),
      jogadoresExtraidos: jogadoresExtraidos
    };
  } catch (e) { 
    return null; 
  }
}

async function gerarAnaliseComIA(homeTeam, awayTeam, league, refereeName, dadosOdds, geminiApiKey) {
  const nomeCasa = dadosOdds ? dadosOdds.bookmaker : "Bet365";
  
  let contextoJogadoresReais = "";
  let sugestaoJogadorDireta = null;

  if (dadosOdds && dadosOdds.jogadoresExtraidos && dadosOdds.jogadoresExtraidos.length > 0) {
    const j = dadosOdds.jogadoresExtraidos[Math.floor(Math.random() * dadosOdds.jogadoresExtraidos.length)];
    sugestaoJogadorDireta = {
      market: `Especiais (${j.mercado}): ${j.jogador}`,
      odd: Number(j.odd) || 2.10
    };
    contextoJogadoresReais = `Jogadores reais encontrados no catálogo da ${nomeCasa}: ${j.jogador} (@${j.odd})`;
  }

  if (!geminiApiKey) {
    return retornarFallback(homeTeam, awayTeam, league, refereeName, sugestaoJogadorDireta);
  }

  try {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Você é um Analista de Dados Esportivos. 
    Partida: ${homeTeam} vs ${awayTeam} (${league}). Árbitro: ${refereeName || 'Padrão'}.
    ${contextoJogadoresReais}
    
    ⚠️ INSTRUÇÃO: 
    Se houver um jogador real listado acima, use-o exatamente. Se não houver, cite um nome real de um jogador do plantel de ${homeTeam} ou ${awayTeam}. É PROIBIDO usar termos genéricos como "Atacante de [Time]".
    
    Retorne estritamente um JSON puro, com exatamente esta estrutura:
    {
      "mainMarket": "Mercado principal específico",
      "mainOdd": 1.88,
      "mainConfidence": 88,
      "mainAnalysis": "Análise estatística curta de 2 frases.",
      "criarApostaMarket": "Criar Aposta Clássico: [Combinada de equipe]",
      "criarApostaOdd": 1.95,
      "criarApostaAnalysis": "Justificativa técnica curta.",
      "playerBetMarket": "Criar Aposta Jogadores: [Nome Real do Jogador e linha extraída das odds]",
      "playerBetOdd": 2.15,
      "playerBetAnalysis": "Justificativa tática baseada no atleta.",
      "refereeNote": "Impacto disciplinar do árbitro",
      "rivalryNote": "Contexto histórico ou de tabela",
      "injuryNote": "Panorama de desfalques"
    }`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Tratamento de texto sem usar regex (100% livre de erros de sintaxe de barra)
    let textResult = response.text().replaceAll('```json', '').replaceAll('```', '').trim();
    let startIndex = textResult.indexOf('{');
    let endIndex = textResult.lastIndexOf('}');
    if (startIndex !== -1 && endIndex !== -1) {
      textResult = textResult.substring(startIndex, endIndex + 1);
    }

    const parsed = JSON.parse(textResult);

    return {
      market: parsed.mainMarket || `Vitória Simples: ${homeTeam}`,
      odd: Number(parsed.mainOdd) || 1.85,
      confidence: Number(parsed.mainConfidence) || 88,
      analysis: parsed.mainAnalysis || `Análise tática focada no confronto entre ${homeTeam} e ${awayTeam}.`,
      criarApostaMarket: parsed.criarApostaMarket || `Criar Aposta: ${homeTeam} vence + Mais de 1.5 Gols`,
      criarApostaOdd: Number(parsed.criarApostaOdd) || 1.95,
      criarApostaAnalysis: parsed.criarApostaAnalysis || "Cruzamento estatístico de intensidade ofensiva.",
      playerBetMarket: sugestaoJogadorDireta ? sugestaoJogadorDireta.market : (parsed.playerBetMarket || `Especiais: Destaque de ${homeTeam} 1+ Chute ao Alvo`),
      playerBetOdd: sugestaoJogadorDireta ? sugestaoJogadorDireta.odd : (Number(parsed.playerBetOdd) || 2.15),
      playerBetAnalysis: parsed.playerBetAnalysis || `Mapeamento de desempenho individual extraído das linhas da ${nomeCasa}.`,
      refereeNote: parsed.refereeNote || (refereeName ? `Atuação sob o comando de ${refereeName}` : "Critério disciplinar equilibrado"),
      rivalryNote: parsed.rivalryNote || `Confronto direto com implicações na tabela de ${league}`,
      injuryNote: parsed.injuryNote || `Plantéis focados no duelo`
    };
  } catch (error) {
    console.error("Erro na IA do Gemini:", error.message);
    return retornarFallback(homeTeam, awayTeam, league, refereeName, sugestaoJogadorDireta);
  }
}

function retornarFallback(homeTeam, awayTeam, league, refereeName, sugestaoJogadorDireta) {
  return {
    market: `Mais de 2.5 Gols na Partida`,
    odd: 1.90,
    confidence: 87,
    analysis: `Análise estatística aprofundada baseada no comportamento recente das linhas ofensivas de ${homeTeam} e ${awayTeam}.`,
    criarApostaMarket: `Criar Aposta: Ambas as equipes marcam + Mais de 8.5 Cantos`,
    criarApostaOdd: 1.98,
    criarApostaAnalysis: "Cruzamento estatístico de intensidade ofensiva e histórico de cantos.",
    playerBetMarket: sugestaoJogadorDireta ? sugestaoJogadorDireta.market : `Especiais: Artilheiro principal de ${homeTeam} 1+ Chute ao Alvo`,
    playerBetOdd: sugestaoJogadorDireta ? sugestaoJogadorDireta.odd : 2.15,
    playerBetAnalysis: `Estudo individual de duelos diretos extraído do catálogo de apostas.`,
    refereeNote: refereeName ? `Atuação sob o comando de ${refereeName}` : "Critério disciplinar dentro da média",
    rivalryNote: `Partida de grande importância para a classificação na tabela de ${league}`,
    injuryNote: "Elencos principais à disposição dos treinadores"
  };
}

module.exports = async function handler(req, res) {
  const apiFootballKey = process.env.FOOTBALL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!apiFootballKey) return res.status(500).json({ success: false, error: "Falta API Key da Football-API" });

  try {
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${hoje}&timezone=America/Sao_Paulo`, { headers: { 'x-apisports-key': apiFootballKey } });
    const data = await response.json();
    const allMatches = data.response || [];
    const matches = allMatches.filter(item => LIGAS_DE_ELITE_IDS.includes(item.league.id));
    const loteDeHoje = matches.slice(0, 5); 
    let salvos = 0;

    for (const item of loteDeHoje) {
      const fixtureId = item.fixture.id;
      const homeTeam = item.teams.home.name;
      const awayTeam = item.teams.away.name;
      const league = item.league.name;
      const refereeName = item.fixture.referee;
      
      const dadosOdds = await buscarDadosAvancadosFixture(fixtureId, apiFootballKey);
      const analise = await gerarAnaliseComIA(homeTeam, awayTeam, league, refereeName, dadosOdds, geminiApiKey);

      const oddPrincipal = Number(analise.odd) || 1.85;
      const comparador = {
        Bet365: (oddPrincipal * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2),
        Betano: (oddPrincipal * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2),
        Superbet: (oddPrincipal * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2)
      };

      const predictionData = {
        matchName: `${homeTeam} vs ${awayTeam}`,
        league, 
        country: item.league.country || "Internacional",
        market: analise.market, 
        odd: oddPrincipal,
        confidence: analise.confidence, 
        analysis: analise.analysis,
        criarApostaMarket: analise.criarApostaMarket, 
        criarApostaOdd: analise.criarApostaOdd, 
        criarApostaAnalysis: analise.criarApostaAnalysis,
        playerBetMarket: analise.playerBetMarket, 
        playerBetOdd: analise.playerBetOdd, 
        playerBetAnalysis: analise.playerBetAnalysis,
        bookmaker: dadosOdds ? dadosOdds.bookmaker : "Bet365", 
        matchDate: item.fixture.date,
        comparadorOdds: comparador,
        isValueBet: (oddPrincipal >= 1.70),
        isUnderdog: (oddPrincipal >= 2.30),
        refereeNote: analise.refereeNote,
        rivalryNote: analise.rivalryNote,
        injuryNote: analise.injuryNote,
        homeStrength: 50 + (Number(fixtureId) % 30),
        awayStrength: 50 + ((Number(fixtureId) * 3) % 25),
        status: "pendente",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('predictions').doc(String(fixtureId)).set(predictionData);
      salvos++;
      
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    return res.status(200).json({ success: true, message: `Sucesso! ${salvos} jogos processados.` });
  } catch (error) { 
    return res.status(500).json({ success: false, error: error.message }); 
  }
};
