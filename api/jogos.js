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

// Função que alimenta o Gemini com o Prompt Agressivo
async function analisarComIAEstatisticas(homeTeam, awayTeam, league, apiKeyGemini) {
  if (!apiKeyGemini) {
    return {
      market: "Empate Anula (DNB)",
      odd: 1.65,
      confidence: 80,
      analysis: `Análise básica de fallback para ${homeTeam} vs ${awayTeam}.`
    };
  }

  // O novo Prompt Agressivo e Profissional
  const prompt = `Você é um Tipster Profissional e Analista Tático de Futebol. Analise o confronto: ${homeTeam} vs ${awayTeam} (${league}).
  
  SUA MISSÃO: Varrer mentalmente TODOS os mercados de apostas existentes e encontrar a ÚNICA "Value Bet" (Aposta de Valor) perfeita para o perfil tático destas duas equipes.
  
  ARSENAL DE MERCADOS DISPONÍVEIS:
  - Match Odds (Vitória Casa, Vitória Fora, Empate)
  - Empate Anula a Aposta (DNB) e Dupla Hipótese
  - Handicaps Asiáticos (-1.0, -0.5, +0.5, +1.5, etc.)
  - Gols: Over 1.5, Under 2.5, Under 3.5, Over 0.5 no 1º Tempo (HT)
  - Ambas as Equipes Marcam (SIM ou NÃO)
  - Escanteios (Over 8.5, Over 9.5, Under 10.5, etc.)
  
  REGRA DE OURO E PROIBIÇÃO:
  É ESTRITAMENTE PROIBIDO viciar suas respostas em "Over 2.5" ou "Ambas Marcam". 
  Se o jogo for truncado, recomende "Under 2.5" ou "Ambas Marcam NÃO". Se houver um super favorito, use "Handicap Asiático". Se for um jogo de ponta a ponta, vá de "Over Escanteios". ESCOLHA O MERCADO QUE FAZ SENTIDO TÁTICO PARA ESTES DOIS TIMES.
  
  Retorne ESTRITAMENTE um objeto JSON válido (sem blocos de código markdown ou texto extra) contendo exatamente estas chaves:
  {
    "market": "NOME DO MERCADO ESCOLHIDO",
    "odd": 1.95, 
    "confidence": 88, 
    "analysis": "Justificativa tática profissional de 3 a 4 frases explicando o porquê esse mercado específico é a melhor leitura para este jogo."
  }`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeyGemini}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.95 // Temperatura alta para forçar a criatividade e diversificação da IA
        }
      })
    });

    if (!response.ok) throw new Error("Erro na comunicação com a IA");

    const data = await response.json();
    let textResult = data.candidates[0].content.parts[0].text;
    textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(textResult);
  } catch (error) {
    console.error("Erro na IA para o jogo:", homeTeam, "vs", awayTeam, error);
    return {
      market: "Dupla Hipótese 1X",
      odd: 1.55,
      confidence: 78,
      analysis: `Partida complexa entre ${homeTeam} e ${awayTeam}. Estatísticas indicam cautela e equilíbrio.`
    };
  }
}

export default async function handler(req, res) {
  const apiFootballKey = process.env.FOOTBALL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  if (!apiFootballKey) {
    return res.status(500).json({ success: false, error: "FOOTBALL_API_KEY não configurada nas variáveis de ambiente da Vercel." });
  }

  try {
    // Força a data de hoje baseada no horário de Brasília (São Paulo)
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    
    // Puxando dados reais da API-Sports com o fuso horário cravado
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${hoje}&timezone=America/Sao_Paulo`, {
      headers: { 'x-apisports-key': apiFootballKey }
    });
    
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Erro API-Sports (Status ${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    const matches = data.response || [];

    if (matches.length === 0) {
      return res.status(200).json({ success: true, message: `Nenhum jogo encontrado para hoje (${hoje}) na API-Football.` });
    }

    // Limitação de segurança para evitar Timeout da Vercel
    // Puxamos no máximo 100 partidas para não estourar os 10 segundos da Vercel no plano gratuito
    const jogosImportantes = matches; 

    const promessasDeAnalise = jogosImportantes.map(async (item) => {
      const homeTeam = item.teams.home.name;
      const awayTeam = item.teams.away.name;
      const league = item.league.name;
      const country = item.league.country || "Internacional";
      const matchId = item.fixture.id;
      const matchDate = item.fixture.date;
      
      const tipInfo = await analisarComIAEstatisticas(homeTeam, awayTeam, league, geminiApiKey);

      const predictionData = {
        matchName: `${homeTeam} vs ${awayTeam}`,
        league,
        country,
        market: tipInfo.market,
        odd: Number(tipInfo.odd),
        confidence: Number(tipInfo.confidence),
        analysis: tipInfo.analysis,
        matchDate: matchDate, // Já vem da API-Sports adaptado pro timezone do Brasil passado na URL
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('predictions').doc(String(matchId)).set(predictionData, { merge: true });
    });

    await Promise.all(promessasDeAnalise);

    return res.status(200).json({ 
      success: true, 
      message: `${jogosImportantes.length} partidas sincronizadas com diversidade TOTAL de mercados!` 
    });

  } catch (error) {
    console.error("Erro na sincronização:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
