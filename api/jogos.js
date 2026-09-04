const admin = require('firebase-admin');

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
  const agora = new Date();
  const options = { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' };
  const partes = new Intl.DateTimeFormat('en-CA', options).formatToParts(agora);
  const ano = partes.find(p => p.type === 'year').value;
  const mes = partes.find(p => p.type === 'month').value;
  const dia = partes.find(p => p.type === 'day').value;
  const hoje = `${ano}-${mes}-${dia}`;
  
  const res = await fetch(`https://api.football-data.org/v4/matches?date=${hoje}`, { 
    headers: { 'X-Auth-Token': footballDataKey } 
  });
  
  if (!res.ok) throw new Error(`Erro HTTP da football-data.org: ${res.status}`);
  
  const data = await res.json();
  if (!data.matches || data.matches.length === 0) return [];

  return data.matches.slice(0, 1);
}

async function gerarPalpiteIA(home, away, league, referee, groqKey) {
  const modelName = "openai/gpt-oss-20b";

  const prompt = `Você é um Tipster Profissional de Elite especialista em análise de futebol. Jogo: ${home} vs ${away} (${league}). Árbitro: ${referee}.
  
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

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: "Você é um analista esportivo profissional que retorna estritamente JSON válido." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erro na API do Groq usando o modelo [${modelName}]: ${errText}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

module.exports = async function handler(req, res) {
  const footballDataKey = process.env.FOOTBALL_DATA_KEY || 'f8928c309caf420b9cfab4a8a906de73';
  const groqKey = process.env.GROQ_API_KEY;
  
  if (!groqKey) return res.status(500).json({ success: false, error: "Falta API Key do Groq (GROQ_API_KEY)" });
  if (!footballDataKey) return res.status(500).json({ success: false, error: "Falta API Key da football-data.org" });

  try {
    const matches = await buscarJogosDoDia(footballDataKey);
    
    if (!matches || matches.length === 0) {
       return res.status(200).json({ success: false, message: "Zero jogos encontrados hoje." });
    }

    const item = matches[0];
    const matchId = item.id;
    const home = item.homeTeam.name;
    const away = item.awayTeam.name;
    const league = item.competition.name;
    const referee = (item.referees && item.referees[0] && item.referees[0].name) || "Árbitro Oficial";

    const ai = await gerarPalpiteIA(home, away, league, referee, groqKey);
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

    return res.status(200).json({ success: true, message: `Painel atualizado com sucesso! Jogo gerado e salvo no Firebase!` });
  } catch (err) {
    return res.status(500).json({ success: false, erroCritico: err.message });
  }
};
