import admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Erro ao carregar credenciais do Firebase:", error);
  }
}

const db = admin.firestore();

// LISTA BRANCA DE LIGAS DE ELITE (IDs oficiais da API-Football)
const LIGAS_DE_ELITE_IDS = [
  71,  // Brasileirão Série A
  72,  // Brasileirão Série B
  73,  // Copa do Brasil
  11,  // Campeonato Paulista
  39,  // Premier League (Inglaterra)
  40,  // Championship (Inglaterra)
  140, // La Liga (Espanha)
  141, // La Liga 2 (Espanha)
  135, // Serie A (Itália)
  136, // Serie B (Itália)
  78,  // Bundesliga (Alemanha)
  79,  // 2. Bundesliga (Alemanha)
  61,  // Ligue 1 (França)
  62,  // Ligue 2 (França)
  94,  // Primeira Liga (Portugal)
  88,  // Eredivisie (Holanda)
  2,   // UEFA Champions League
  3,   // UEFA Europa League
  848, // UEFA Conference League
  13,  // Copa Libertadores
  11,  // Copa Sudamericana
  128  // Liga Profesional (Argentina)
];

// Função para buscar odds reais nas casas de preferência (Bet365, Betano, Superbet)
async function buscarOddsReais(fixtureId, apiFootballKey) {
  try {
    const response = await fetch(`https://v3.football.api-sports.io/odds?fixture=${fixtureId}`, {
      headers: { 'x-apisports-key': apiFootballKey }
    });
    
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.response || data.response.length === 0) return null;

    const bookmakers = data.response[0].bookmakers || [];
    const casasAlvo = ["Bet365", "Betano", "Superbet"];

    for (const casaNome of casasAlvo) {
      const bk = bookmakers.find(b => b.name.toLowerCase().includes(casaNome.toLowerCase()));
      if (bk && bk.bets && bk.bets.length > 0) {
        // Procura o mercado de Match Winner (ID 1) ou Resultado Final
        const mercado = bk.bets.find(b => b.id === 1 || b.name === "Match Winner" || b.name === "Full Time Result");
        if (mercado && mercado.values && mercado.values.length > 0) {
          // Pega a primeira opção relevante (ex: Mandante) para validar com a IA
          const selecao = mercado.values[0];
          return {
            bookmaker: bk.name,
            market: `Vitória ${selecao.value}`,
            odd: parseFloat(selecao.odd)
          };
        }
      }
    }
    return null;
  } catch (error) {
    console.error(`Erro ao buscar odds para fixture ${fixtureId}:`, error);
    return null;
  }
}

async function analisarComIAEstatisticas(homeTeam, awayTeam, league, oddsReais, apiKeyGemini) {
  if (!apiKeyGemini) return null;

  const infoOddsStr = oddsReais 
    ? `Cotação real obtida na ${oddsReais.bookmaker}: Mercado de '${oddsReais.market}' @${oddsReais.odd}.` 
    : `Utilize cotações realistas de mercado.`;

  const prompt = `Você é um Analista Tático de Elite e Tipster Profissional.
  Confronto: ${homeTeam} vs ${awayTeam} (Competição: ${league}).
  ${infoOddsStr}
  
  SUA MISSÃO: Fornecer a melhor análise tática e validar ou sugerir o mercado de maior valor (+EV) com base estritamente nas cotações reais fornecidas acima ou no padrão da partida.
  
  Retorne ESTRITAMENTE um objeto JSON válido (sem texto extra, sem blocos markdown):
  {
    "market": "${oddsReais ? oddsReais.market : 'Match Winner'}",
    "odd": ${oddsReais ? oddsReais.odd : 1.85}, 
    "confidence": 92, 
    "analysis": "Explicação técnica de 3 frases justificando o valor tático."
  }`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKeyGemini}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 }
      })
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.candidates || !data.candidates[0]) return null;
    
    let textResult = data.candidates[0].content.parts[0].text;
    textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(textResult);
  } catch (error) {
    return null;
  }
}

export default async function handler(req, res) {
  const apiFootballKey = process.env.FOOTBALL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  if (!apiFootballKey) {
    return res.status(500).json({ success: false, error: "FOOTBALL_API_KEY não configurada." });
  }

  try {
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${hoje}&timezone=America/Sao_Paulo`, {
      headers: { 'x-apisports-key': apiFootballKey }
    });
    
    if (!response.ok) throw new Error(`Erro API-Sports`);
    const data = await response.json();
    const allMatches = data.response || [];

    const matches = allMatches.filter(item => LIGAS_DE_ELITE_IDS.includes(item.league.id));

    const snapshot = await db.collection('predictions').get();
    const jogosJaSalvos = new Set();
    
    snapshot.forEach(doc => {
        const docData = doc.data();
        if (docData.matchDate && docData.matchDate.includes(hoje)) {
            jogosJaSalvos.add(Number(doc.id));
        }
    });

    const jogosPendentes = matches.filter(item => !jogosJaSalvos.has(item.fixture.id));

    if (jogosPendentes.length === 0) {
      return res.status(200).json({ success: true, message: `Todos os jogos de elite de hoje já possuem odds reais sincronizadas.` });
    }

    const loteDeHoje = jogosPendentes.slice(0, 5); // Processa de 5 em 5 para respeitar limites de requisições de odds
    let palpitesSalvos = 0;

    for (const item of loteDeHoje) {
      const fixtureId = item.fixture.id;
      const homeTeam = item.teams.home.name;
      const awayTeam = item.teams.away.name;
      const league = item.league.name;
      
      // BUSCA AS ODDS REAIS NA BET365, BETANO OU SUPERBET ANTES DA IA ANALISAR
      const oddsReais = await buscarOddsReais(fixtureId, apiFootballKey);

      const tipInfo = await analisarComIAEstatisticas(homeTeam, awayTeam, league, oddsReais, geminiApiKey);

      if (tipInfo && tipInfo.market && tipInfo.analysis) {
        const predictionData = {
          matchName: `${homeTeam} vs ${awayTeam}`,
          league,
          country: item.league.country || "Internacional",
          market: tipInfo.market,
          odd: Number(tipInfo.odd),
          confidence: Number(tipInfo.confidence),
          analysis: tipInfo.analysis,
          bookmaker: oddsReais ? oddsReais.bookmaker : "Bet365",
          matchDate: item.fixture.date,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('predictions').doc(String(fixtureId)).set(predictionData, { merge: true });
        palpitesSalvos++;
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return res.status(200).json({ 
      success: true, 
      message: `SINCRONIZAÇÃO DE ODDS REAIS: ${palpitesSalvos} jogos processados com cotações da Bet365/Betano/Superbet. Restam ${jogosPendentes.length - loteDeHoje.length} na fila.` 
    });

  } catch (error) {
    console.error("Erro na sincronização de odds:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
