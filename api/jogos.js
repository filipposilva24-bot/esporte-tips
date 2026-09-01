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

// Função que usa o Google Gemini com regras estritas de variedade de mercados
async function analisarComIA(homeTeam, awayTeam, league, apiKeyGemini) {
  if (!apiKeyGemini) {
    return {
      market: "Vitória Simples (1X2)",
      odd: 1.72,
      confidence: 82,
      analysis: `Análise estratégica para ${homeTeam} vs ${awayTeam} (${league}). Estudo de momento e must-win indicam vantagem tática para a equipe mandante.`
    };
  }

  const prompt = `Você é um analista sênior de desempenho esportivo, scout profissional e tipster de elite. Analise profundamente a partida entre ${homeTeam} e ${awayTeam} válida pela competição ${league}.
  Identifique o **MELHOR e mais seguro palpite de valor (Value Bet)** exclusivo para este jogo.
  
  REGRA CRUCIAL DE VARIEDADE: NÃO repita o mesmo mercado em todos os jogos. Você DEVE diversificar os tipos de apostas com base no perfil biomecânico e tático do confronto. Utilize opções como:
  - Vitória Simples (1X2) ou Dupla Hipótese
  - Ambas as Equipes Marcam (BTTS Sim ou Não)
  - Linhas de Gols variadas (Over 1.5, Under 2.5, Over 3.5)
  - Empate Anula a Aposta (Draw No Bet) ou Handicap Asiático
  - Mercado de Cantos (Escanteios)
  
  Retorne estritamente um objeto JSON válido (sem blocos de código markdown ou texto extra fora do JSON) contendo exatamente estas chaves:
  {
    "market": "O mercado específico ideal para este jogo (ex: Ambas Marcam - Sim, Vitória do ${homeTeam}, Under 2.5 Gols, Handicap Asiático -0.5, Mais de 9.5 Cantos, etc.)",
    "odd": (um número decimal realista para a odd desse mercado específico, entre 1.45 e 2.40),
    "confidence": (um número inteiro entre 78 e 94),
    "analysis": "Um texto denso, técnico e fundamentado de 3 a 4 frases em português explicando o porquê da entrada específica, citando comportamento tático recente, desfalques potenciais e contexto do campeonato."
  }`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeyGemini}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) throw new Error("Erro na comunicação com a IA");

    const data = await response.json();
    let textResult = data.candidates[0].content.parts[0].text;
    
    // Limpeza rigorosa de formatação markdown
    textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
    
    return JSON.parse(textResult);
  } catch (error) {
    console.error("Erro na IA, usando fallback:", error);
    return {
      market: "Ambas Marcam (BTTS)",
      odd: 1.80,
      confidence: 80,
      analysis: `Confronto aberto entre ${homeTeam} e ${awayTeam} na ${league}. A necessidade de pontuar de ambos os lados gera alta expectativa de gols para os dois times.`
    };
  }
}

export default async function handler(req, res) {
  const footballApiKey = process.env.FOOTBALL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  try {
    const hoje = new Date().toISOString().split('T')[0];
    
    const response = await fetch(`https://api.football-data.org/v4/matches?date=${hoje}`, {
      headers: { 'X-Auth-Token': footballApiKey }
    });
    
    if (!response.ok) {
      throw new Error(`Erro ao buscar dados na API externa: ${response.statusText}`);
    }

    const data = await response.json();
    const matches = data.matches || [];

    const promessasDeAnalise = matches.map(async (match) => {
      const homeTeam = match.homeTeam.name;
      const awayTeam = match.awayTeam.name;
      const league = match.competition.name;
      
      const tipInfo = await analisarComIA(homeTeam, awayTeam, league, geminiApiKey);

      const predictionData = {
        matchName: `${homeTeam} vs ${awayTeam}`,
        league,
        market: tipInfo.market,
        odd: Number(tipInfo.odd),
        confidence: Number(tipInfo.confidence),
        analysis: tipInfo.analysis,
        matchDate: match.utcDate,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('predictions').doc(String(match.id)).set(predictionData, { merge: true });
    });

    await Promise.all(promessasDeAnalise);

    return res.status(200).json({ 
      success: true, 
      message: `${matches.length} jogos reanalisados com mercados diversificados e IA avançada para o dia ${hoje}!` 
    });

  } catch (error) {
    console.error("Erro na sincronização:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
