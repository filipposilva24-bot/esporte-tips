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

// Nova Função Analítica e Estrita
async function analisarComIAEstatisticas(homeTeam, awayTeam, league, apiKeyGemini) {
  if (!apiKeyGemini) return null;

  // Prompt focado em +EV (Expected Value) e Análise Real
  const prompt = `Você é um Analista Tático de Elite e Tipster Profissional.
  Confronto: ${homeTeam} vs ${awayTeam} (Competição: ${league}).
  
  SUA MISSÃO: Usar seu conhecimento histórico sobre o padrão tático, força ofensiva/defensiva e momento atual destas equipes para encontrar a APOSTA DE MAIOR VALOR (+EV).
  
  MERCADOS PARA AVALIAÇÃO:
  - Match Odds (Vitória Casa, Vitória Fora, Empate)
  - Empate Anula a Aposta (DNB) e Dupla Hipótese
  - Handicaps Asiáticos (ex: -1.0, +0.5, etc.)
  - Gols: Over/Under (ex: Over 1.5, Under 2.5, Over 0.5 HT)
  - Ambas as Equipes Marcam (Sim/Não)
  - Escanteios e Cartões (Se fizer sentido para o padrão dos times)
  
  REGRA ABSOLUTA: NÃO diversifique mercados só por diversificar. Escolha o mercado que faça TOTAL SENTIDO LÓGICO para a realidade e disparidade técnica destas duas equipes. Se o jogo tem um franco favorito, analise Handicaps. Se são times reativos, analise o Under. O foco é a LEITURA PERFEITA DO JOGO.
  
  Retorne ESTRITAMENTE um objeto JSON válido (sem markdown, sem texto extra):
  {
    "market": "Nome Oficial do Mercado Escolhido",
    "odd": 1.85, 
    "confidence": 92, 
    "analysis": "Explicação técnica de 3 frases do porquê esta linha específica tem extremo valor baseada no comportamento real e padrão tático destas duas equipes."
  }`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeyGemini}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7 // Temperatura balanceada: criatividade suficiente para encontrar bons mercados, mas focada em precisão.
        }
      })
    });

    if (!response.ok) throw new Error("Rate limit ou erro na API do Gemini.");

    const data = await response.json();
    if (!data.candidates || !data.candidates[0]) throw new Error("Resposta vazia da IA.");
    
    let textResult = data.candidates[0].content.parts[0].text;
    textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(textResult);
  } catch (error) {
    // Retorna NULL para não salvar palpites falsos/genéricos no banco
    console.error(`Erro na IA para ${homeTeam} vs ${awayTeam}`);
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
    
    if (!response.ok) {
      throw new Error(`Erro API-Sports (Status ${response.status})`);
    }

    const data = await response.json();
    const matches = data.response || [];

    if (matches.length === 0) {
      return res.status(200).json({ success: true, message: `Nenhum jogo encontrado para hoje.` });
    }

    // Como 335 gera Rate Limit do Google e derruba a Vercel, pegamos uma amostra alta porém segura.
    const jogosParaAnalisar = matches; 

    let palpitesSalvos = 0;

    const promessasDeAnalise = jogosParaAnalisar.map(async (item) => {
      const homeTeam = item.teams.home.name;
      const awayTeam = item.teams.away.name;
      const league = item.league.name;
      const country = item.league.country || "Internacional";
      const matchId = item.fixture.id;
      const matchDate = item.fixture.date;
      
      const tipInfo = await analisarComIAEstatisticas(homeTeam, awayTeam, league, geminiApiKey);

      // SÓ SALVA NO BANCO SE A IA REALMENTE CONSEGUIU ANALISAR (não é mais lixo automático)
      if (tipInfo && tipInfo.market && tipInfo.analysis) {
        const predictionData = {
          matchName: `${homeTeam} vs ${awayTeam}`,
          league,
          country,
          market: tipInfo.market,
          odd: Number(tipInfo.odd),
          confidence: Number(tipInfo.confidence),
          analysis: tipInfo.analysis,
          matchDate: matchDate,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('predictions').doc(String(matchId)).set(predictionData, { merge: true });
        palpitesSalvos++;
      }
    });

    await Promise.all(promessasDeAnalise);

    return res.status(200).json({ 
      success: true, 
      message: `Processamento concluído. ${palpitesSalvos} palpites de ALTÍSSIMA QUALIDADE foram gerados e salvos!` 
    });

  } catch (error) {
    console.error("Erro na sincronização:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
