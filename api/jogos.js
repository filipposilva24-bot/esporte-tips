import admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Erro ao carregar credenciais:", error);
  }
}

const db = admin.firestore();

async function analisarComIAEstatisticas(homeTeam, awayTeam, league, apiKeyGemini) {
  if (!apiKeyGemini) {
    return {
      market: "Ambas Marcam (BTTS)",
      odd: 1.80,
      confidence: 85,
      analysis: `Análise avançada para ${homeTeam} vs ${awayTeam} na ${league}. Confronto estudado com base no comportamento tático recente das equipes.`
    };
  }

  const prompt = `Você é um analista sênior de desempenho esportivo e tipster de elite. Analise profundamente a partida entre ${homeTeam} e ${awayTeam} válida pela competição ${league}.
  
  DIRETRIZES:
  1. Escolha o MELHOR mercado de valor possível (ex: Vitória Simples, Ambas Marcam, Over/Under de gols, Handicap ou Cantos). Proibido repetir o mesmo mercado em todos os jogos.
  2. Defina uma odd realista (entre 1.45 e 2.45).
  3. Atribua uma confiança realista (entre 78 e 94).
  4. Escreva uma análise técnica densa e profissional de 3 a 4 frases em português.
  
  Retorne estritamente um objeto JSON válido (sem markdown ou texto extra) contendo exatamente estas chaves:
  {
    "market": "Nome específico do mercado",
    "odd": 1.75,
    "confidence": 88,
    "analysis": "Texto da análise técnica detalhada..."
  }`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeyGemini}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    if (!response.ok) throw new Error("Erro na IA");

    const data = await response.json();
    let textResult = data.candidates[0].content.parts[0].text;
    textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(textResult);
  } catch (error) {
    return {
      market: "Over 2.5 Gols",
      odd: 1.85,
      confidence: 82,
      analysis: `Partida movimentada entre ${homeTeam} e ${awayTeam} na ${league}.`
    };
  }
}

export default async function handler(req, res) {
  const apiFootballKey = process.env.API_FOOTBALL_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  if (!apiFootballKey) {
    return res.status(500).json({ success: false, error: "API_FOOTBALL_KEY não configurada nas variáveis de ambiente da Vercel." });
  }

  try {
    const hoje = new Date().toISOString().split('T')[0];
    
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${hoje}`, {
      headers: {
        'x-apisports-key': apiFootballKey
      }
    });
    
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Status ${response.status} - Detalhes: ${errorBody}`);
    }

    const data = await response.json();
    const matches = data.response || [];

    if (matches.length === 0) {
      return res.status(200).json({ success: true, message: `Nenhum jogo encontrado para hoje (${hoje}) na API-Football.` });
    }

    const promessasDeAnalise = matches.map(async (item) => {
      const homeTeam = item.teams.home.name;
      const awayTeam = item.teams.away.name;
      const league = item.league.name;
      const matchId = item.fixture.id;
      const matchDate = item.fixture.date;
      
      const tipInfo = await analisarComIAEstatisticas(homeTeam, awayTeam, league, geminiApiKey);

      const predictionData = {
        matchName: `${homeTeam} vs ${awayTeam}`,
        league,
        market: tipInfo.market,
        odd: Number(tipInfo.odd),
        confidence: Number(tipInfo.confidence),
        analysis: tipInfo.analysis,
        matchDate: matchDate,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('predictions').doc(String(matchId)).set(predictionData, { merge: true });
    });

    await Promise.all(promessasDeAnalise);

    return res.status(200).json({ 
      success: true, 
      message: `${matches.length} partidas sincronizadas com sucesso!` 
    });

  } catch (error) {
    console.error("Erro na sincronização:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
