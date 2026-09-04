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

async function buscarJogosDoDia(footballDataKey) {
  // Data exata de hoje no Brasil formatada no padrão YYYY-MM-DD
  const agora = new Date();
  const options = { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' };
  const partes = new Intl.DateTimeFormat('en-CA', options).formatToParts(agora);
  const ano = partes.find(p => p.type === 'year').value;
  const mes = partes.find(p => p.type === 'month').value;
  const dia = partes.find(p => p.type === 'day').value;
  const hoje = `${ano}-${mes}-${dia}`;
  
  console.log("Buscando jogos na football-data.org para a data:", hoje);

  const res = await fetch(`https://api.football-data.org/v4/matches?date=${hoje}`, { 
    headers: { 'X-Auth-Token': footballDataKey } 
  });
  
  if (!res.ok) {
    throw new Error(`Erro HTTP da football-data.org: ${res.status}`);
  }
  
  const data = await res.json();
  
  if (!data.matches || data.matches.length === 0) {
    return [];
  }

  // Pega até 5 partidas do dia para garantir velocidade e assertividade
  return data.matches.slice(0, 5);
}

async function gerarPalpiteIA(home, away, league, referee, geminiKey) {
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-pro", 
    generationConfig: { responseMimeType: "application/json" } 
  });

  const prompt = `Você é um Tipster Profissional de Elite especialista em análise de futebol. Jogo: ${home} vs ${away} (${league}). Árbitro: ${referee}.
  
  REGRAS ABSOLUTAS:
  1. Foque com extrema qualidade na Entrada Principal e no Criar Aposta baseados em estatísticas reais do confronto.
  
  Retorne EXATAMENTE um JSON puro sem markdown com esta estrutura exata:
  {
    "mainMarket": "Mercado principal específico",
    "mainOdd": 1.88,
    "mainConfidence": 88,
    "mainAnalysis": "Análise tática detalhada do confronto.",
    "criarApostaMarket": "Criar Aposta: Combinada específica",
    "criarApostaOdd": 1.95,
    "criarApostaAnalysis": "Justificativa técnica.",
    "refereeNote": "Análise do árbitro ${referee}",
    "rivalryNote": "Contexto histórico ou tabela",
    "injuryNote": "Panorama de desfalques"
  }`;

  const result = await model.generateContent(prompt);
  let textResponse = result.response.text();
  textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(textResponse);
  } catch (e) {
    const match = textResponse.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw e;
  }
}

module.exports = async function handler(req, res) {
  // Utiliza a chave enviada ou busca nas variáveis de ambiente da Vercel
  const footballDataKey = process.env.FOOTBALL_DATA_KEY || 'f8928c309caf420b9cfab4a8a906de73';
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  if (!geminiApiKey) return res.status(500).json({ success: false, error: "Falta API Key do Gemini" });
  if (!footballDataKey) return res.status(500).json({ success: false, error: "Falta API Key da football-data.org" });

  try {
    const matches = await buscarJogosDoDia(footballDataKey);
    
    if (!matches || matches.length === 0) {
       return res.status(200).json({ 
         success: false, 
         message: "A football-data.org retornou zero jogos para a data de hoje." 
       });
    }

    let salvos = 0;

    for (const item of matches) {
      const matchId = item.id;
      const home = item.homeTeam.name;
      const away = item.awayTeam.name;
      const league = item.competition.name;
      const referee = (item.referees && item.referees[0] && item.referees[0].name) || "Árbitro Oficial";

      let ai;
      try {
        ai = await gerarPalpiteIA(home, away, league, referee, geminiApiKey);
      } catch (errAI) {
        console.error(`❌ Erro na IA para ${home} vs ${away}:`, errAI.message);
        continue; 
      }

      const oddPrincipal = Number(ai.mainOdd) || 1.85;

      const docData = {
        matchName: `${home} vs ${away}`,
        league,
        country: item.competition.area?.name || "Internacional",
        market: ai.mainMarket,
        odd: oddPrincipal,
        confidence: Number(ai.mainConfidence) || 85,
        analysis: ai.mainAnalysis,
        criarApostaMarket: ai.criarApostaMarket,
        criarApostaOdd: Number(ai.criarApostaOdd) || 1.95,
        criarApostaAnalysis: ai.criarApostaAnalysis,
        bookmaker: "Bet365",
        matchDate: item.utcDate,
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

      await db.collection('predictions').doc(String(matchId)).set(docData);
      salvos++;
      
      await new Promise(r => setTimeout(r, 1500));
    }

    return res.status(200).json({ success: true, message: `Painel atualizado com sucesso! ${salvos} jogos gravados no Firebase!` });
  } catch (err) {
    return res.status(500).json({ success: false, erroCritico: err.message });
  }
};
