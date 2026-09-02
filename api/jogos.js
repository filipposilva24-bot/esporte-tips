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

async function analisarComIAEstatisticas(homeTeam, awayTeam, league, apiKeyGemini) {
  if (!apiKeyGemini) return null;

  const prompt = `Você é um Analista Tático de Elite e Tipster Profissional.
  Confronto: ${homeTeam} vs ${awayTeam} (Competição: ${league}).
  
  SUA MISSÃO: Usar seu conhecimento histórico sobre o padrão tático, força ofensiva/defensiva e momento atual destas equipes para encontrar a APOSTA DE MAIOR VALOR (+EV).
  
  MERCADOS PARA AVALIAÇÃO:
  - Match Odds (Vitória, Empate)
  - Empate Anula a Aposta (DNB) e Dupla Hipótese
  - Handicaps Asiáticos (ex: -1.0, +0.5, etc.)
  - Gols: Over/Under (ex: Over 1.5, Under 2.5, Over 0.5 HT)
  - Ambas as Equipes Marcam (Sim/Não)
  - Escanteios (Over/Under)
  
  REGRA ABSOLUTA: NÃO diversifique só por diversificar. Escolha o mercado que faça TOTAL SENTIDO LÓGICO para a realidade tática destas duas equipes. Se o jogo tem um franco favorito, analise Handicaps. Se são times reativos, analise o Under.
  
  Retorne ESTRITAMENTE um objeto JSON válido (sem texto extra, sem blocos markdown):
  {
    "market": "Nome do Mercado",
    "odd": 1.85, 
    "confidence": 92, 
    "analysis": "Explicação técnica de 3 frases justificando o valor."
  }`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeyGemini}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 }
      })
    });

    if (!response.ok) throw new Error("Bloqueio da IA (Rate Limit).");

    const data = await response.json();
    if (!data.candidates || !data.candidates[0]) return null;
    
    let textResult = data.candidates[0].content.parts[0].text;
    textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(textResult);
  } catch (error) {
    console.error(`Falha na IA para ${homeTeam} vs ${awayTeam}:`, error.message);
    return null; // Falhou? Retorna nulo.
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
    const matches = data.response || [];

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
      return res.status(200).json({ success: true, message: `Excelente! Todos os jogos de hoje já foram analisados e salvos no banco.` });
    }

    const loteDeHoje = jogosPendentes.slice(0, 10); 
    let palpitesSalvos = 0;

    // A MÁGICA ACONTECE AQUI: Loop sequencial (um de cada vez)
    for (const item of loteDeHoje) {
      const homeTeam = item.teams.home.name;
      const awayTeam = item.teams.away.name;
      const league = item.league.name;
      
      const tipInfo = await analisarComIAEstatisticas(homeTeam, awayTeam, league, geminiApiKey);

      if (tipInfo && tipInfo.market && tipInfo.analysis) {
        const predictionData = {
          matchName: `${homeTeam} vs ${awayTeam}`,
          league,
          country: item.league.country || "Internacional",
          market: tipInfo.market,
          odd: Number(tipInfo.odd),
          confidence: Number(tipInfo.confidence),
          analysis: tipInfo.analysis,
          matchDate: item.fixture.date,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('predictions').doc(String(item.fixture.id)).set(predictionData, { merge: true });
        palpitesSalvos++;
      }
      
      // Delay de 1.5 segundos entre as chamadas para esfriar a IA do Google e evitar bloqueios
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    return res.status(200).json({ 
      success: true, 
      message: `LOTE CONCLUÍDO! ${palpitesSalvos} de ${loteDeHoje.length} novos jogos foram analisados a fundo. Ainda faltam ${jogosPendentes.length - loteDeHoje.length} jogos na fila.` 
    });

  } catch (error) {
    console.error("Erro na sincronização:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
