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

// BUSCA OS DADOS E EXTRAI OS JOGADORES REAIS DO CATÁLOGO DA CASA
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
        // Procura mercados específicos de jogadores (Ex: Gols, Chutes, Cartões de Atletas)
        if (nomeM.includes('player') || nomeM.includes('scorer') || nomeM.includes('shots') || nomeM.includes('goalscorer')) {
          b.values.forEach(v => {
            // v.value geralmente traz o nome do jogador + a linha (ex: "Carlos Vinicius - Over 0.5")
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
  
  // Se a API das casas trouxe jogadores reais, montamos um texto direto com eles para a IA apenas formatar
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
    
    ⚠️ INSTRUÇÃO CRÍTICA PARA O CAMPO 'playerBetMarket': 
    Se houver um jogador real listado acima, use-o exatamente. Se não houver, cite um nome real de um jogador do plantel de ${homeTeam} ou ${awayTeam}. É PROIBIDO usar termos genéricos como "Atacante de [Time]".
    
    Retorne estritamente um JSON puro (sem markdown, sem crases \`\`\`, apenas o objeto):
    {
      "mainMarket": "Mercado principal específico",
      "mainOdd": 1.88,
      "mainConfidence": 88,
      "mainAnalysis": "Análise estatística curta de 2 frases.",
      "criarApostaMarket": "Criar Aposta Clássico: [Combinada de equipe]",
      "criarApostaOdd": 1.95,
      "criarApostaAnalysis": "Justificativa técnica curta.",
      "playerBetMarket": "Criar Aposta Jogadores: [Nome Real do Jogador e linha extraída das odds]",
      "playerBetOdd": ${sugestaoJogadorDireta ? sugestaoJogadorDireta.odd : 2.15},
      "playerBetAnalysis": "Justificativa tática baseada no atleta.",
      "refereeNote": "Impacto disciplinar do árbitro",
      "rivalryNote": "Contexto histórico ou de tabela",
      "injuryNote": "Panorama de desfalques"
    }`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let textResult = response.text().replace(/```json/g, '').replace(/
