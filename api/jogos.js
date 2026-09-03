const admin = require('firebase-admin');

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

async function analisarComIAEstatisticas(homeTeam, awayTeam, league, refereeName, apiKeyGemini) {
  if (!apiKeyGemini) return null;
  const juizInfo = refereeName ? `Árbitro: ${refereeName}` : `Árbitro padrão`;

  // Prompt direto, limpo e focado em forçar respostas diferentes para cada jogo
  const prompt = `Você é um Modelador Quantitativo de Apostas Esportivas de Elite. 
  Analise a partida: ${homeTeam} vs ${awayTeam} pela liga ${league}. ${juizInfo}.
  
  ⚠️ REGRA OBRIGATÓRIA: Crie previsões COMPLETAMENTE ÚNICAS baseadas nas características reais dos times ${homeTeam} e ${awayTeam}. Nunca repita palpites padronizados.
  
  Retorne estritamente um JSON válido (SEM formatação markdown, SEM crases \`\`\`, apenas o texto do JSON puro) com a seguinte estrutura exata:
  {
    "mainMarket": "Um mercado principal realista e específico (ex: Vitória de ${homeTeam}, Menos de 2.5 Gols, Empate Anula ${awayTeam}, etc.)",
    "mainOdd": 1.85,
    "mainConfidence": 88,
    "mainAnalysis": "Análise estatística de 2 frases focada estritamente no estilo de jogo de ${homeTeam} e ${awayTeam}.",
    "criarApostaMarket": "Criar Aposta Clássico: [Ex: ${homeTeam} marca no 1º tempo + Mais de 1.5 gols]",
    "criarApostaOdd": 1.95,
    "criarApostaAnalysis": "Justificativa técnica curta combinando estatísticas da equipe.",
    "playerBetMarket": "Criar Aposta Jogadores: [Ex: Atacante principal de ${homeTeam} 1+ Chute ao Alvo + Meio-campista de ${awayTeam} cometer 1+ falta]",
    "playerBetOdd": 2.15,
    "playerBetAnalysis": "Justificativa individual tática focada nos atletas de ${homeTeam} e ${awayTeam}.",
    "refereeNote": "Impacto disciplinar do árbitro",
    "rivalryNote": "Contexto histórico ou de tabela",
    "injuryNote": "Panorama de desfalques",
    "homeStrength": 74,
    "awayStrength": 70
  }`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKeyGemini}`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }], 
        generationConfig: { temperature: 0.95 } // Temperatura alta para garantir diversidade máxima
      })
    });
    const data = await response.json();
    let textResult = data.candidates[0].content.parts[0].text;
    
    // Remove qualquer marcação indesejada de markdown caso a IA mande
    textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = textResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) textResult = jsonMatch[0];
    
    return JSON.parse(textResult);
  } catch (error) {
    console.error("Erro no parsing da IA para", homeTeam, "vs", awayTeam, error);
    return null; // Retorna null para tratarmos individualmente sem quebrar o lote
  }
}

module.exports = async function handler(req, res) {
  const apiFootballKey = process.env.FOOTBALL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!apiFootballKey) return res.status(500).json({ success: false, error: "Falta API Key" });

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
      
      const tip = await analisarComIAEstatisticas(homeTeam, awayTeam, league, refereeName, geminiApiKey);

      // Se a IA retornar dados válidos, salvamos. Se falhar, criamos um fallback exclusivo para este jogo específico.
      const mercadoPrincipal = tip ? tip.mainMarket : `Vitória Simples: ${homeTeam}`;
      const oddPrincipal = tip ? Number(tip.mainOdd) : 1.88;
      const analisePrincipal = tip ? tip.mainAnalysis : `Análise tática focada na superioridade do mandante ${homeTeam} diante do ${awayTeam}.`;
      
      const comboMarket = tip ? tip.criarApostaMarket : `Criar Aposta: ${homeTeam} marca + Mais de 1.5 Gols`;
      const comboOdd = tip ? Number(tip.criarApostaOdd) : 1.92;
      const comboAnalysis = tip ? tip.criarApostaAnalysis : `Cruzamento de intensidade ofensiva entre ${homeTeam} e ${awayTeam}.`;

      const playerMarket = tip ? tip.playerBetMarket : `Especiais: Atacante de ${homeTeam} 1+ Chute ao Alvo + Atleta de ${awayTeam} 1+ Falta`;
      const playerOdd = tip ? Number(tip.playerBetOdd) : 2.15;
      const playerAnalysis = tip ? tip.playerBetAnalysis : `Mapeamento de desempenho individual para o duelo ${homeTeam} vs ${awayTeam}.`;

      const comparador = {
        Bet365: (oddPrincipal * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2),
        Betano: (oddPrincipal * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2),
        Superbet: (oddPrincipal * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2)
      };

      const predictionData = {
        matchName: `${homeTeam} vs ${awayTeam}`,
        league, country: item.league.country || "Internacional",
        market: mercadoPrincipal, odd: oddPrincipal,
        confidence: tip ? Number(tip.mainConfidence) : 87, analysis: analisePrincipal,
        criarApostaMarket: comboMarket, criarApostaOdd: comboOdd, criarApostaAnalysis: comboAnalysis,
        playerBetMarket: playerMarket, playerBetOdd: playerOdd, playerBetAnalysis: playerAnalysis,
        bookmaker: "Bet365", matchDate: item.fixture.date,
        comparadorOdds: comparador,
        isValueBet: (oddPrincipal >= 1.70),
        isUnderdog: (oddPrincipal >= 2.30),
        refereeNote: tip ? tip.refereeNote : "Critério disciplinar equilibrado",
        rivalryNote: tip ? tip.rivalryNote : "Confronto direto na tabela de classificação",
        injuryNote: tip ? tip.injuryNote : "Plantéis titulares à disposição",
        homeStrength: tip ? Number(tip.homeStrength) : 75,
        awayStrength: tip ? Number(tip.awayStrength) : 70,
        status: "pendente",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('predictions').doc(String(fixtureId)).set(predictionData, { merge: true });
      salvos++;
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return res.status(200).json({ success: true, message: `Processamento dinâmico concluído: ${salvos} jogos atualizados.` });
  } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
};
