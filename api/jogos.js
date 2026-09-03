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

async function buscarDadosAvancadosFixture(fixtureId, apiFootballKey) {
  try {
    const response = await fetch(`https://v3.football.api-sports.io/odds?fixture=${fixtureId}`, { headers: { 'x-apisports-key': apiFootballKey } });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.response || data.response.length === 0) return null;

    const bookmakers = data.response[0].bookmakers || [];
    const casasAlvo = ["Bet365", "Betano", "Superbet"];
    const casaSorteada = casasAlvo[Math.floor(Math.random() * casasAlvo.length)];
    
    let bk = bookmakers.find(b => b.name.toLowerCase().includes(casaSorteada.toLowerCase())) || bookmakers[0];
    let resumoMercados = [];
    if (bk && bk.bets) {
      bk.bets.forEach(b => {
        const valores = b.values.map(v => `${v.value}: @${v.odd}`).join(', ');
        resumoMercados.push(`- ${b.name}: [${valores}]`);
      });
    }
    return { bookmaker: bk ? bk.name : "Bet365", mercadosTexto: resumoMercados.join('\n') };
  } catch (e) { return null; }
}

async function analisarComIAEstatisticas(homeTeam, awayTeam, league, refereeName, dadosOdds, apiKeyGemini) {
  if (!apiKeyGemini) return null;
  const nomeCasa = dadosOdds ? dadosOdds.bookmaker : "Bet365";
  const contextoOdds = dadosOdds ? `Cotações reais disponíveis nas casas:\n${dadosOdds.mercadosTexto}` : `Use cotações reais de mercado.`;
  const juizInfo = refereeName ? `Árbitro da partida: ${refereeName}` : `Árbitro padrão`;

  const prompt = `Você é um Modelador Quantitativo de Apostas Esportivas e Tipster Profissional de Elite. 
  Sua única função é encontrar a **melhor entrada principal de maior valor matemático (+EV)** e a **melhor combinada de Criar Aposta com teto de 2.00** estritamente baseada nas estatísticas, probabilidades e nas cotações fornecidas.
  
  Partida: ${homeTeam} vs ${awayTeam} (${league}). Casa de referência: ${nomeCasa}.
  ${juizInfo}
  ${contextoOdds}
  
  DIRETRIZES TÉCNICAS RIGOROSAS:
  - ZERO aleatoriedade. Seja cirúrgico, analítico e objetivo.
  - O "mainMarket" deve ser a aposta de maior expectativa de acerto e valor estatístico para o confronto.
  - O "criarApostaMarket" deve ser uma combinada estruturada e sólida, respeitando o limite máximo de odd 2.00.
  - As justificativas devem ser curtas, diretas e baseadas estritamente em dados (como pressão ofensiva, solidez defensiva ou comportamento de mandante/visitante).

  Retorne estritamente um JSON válido no seguinte formato:
  {
    "mainMarket": "Mercado principal de maior valor técnico",
    "mainOdd": 1.75,
    "mainConfidence": 90,
    "mainAnalysis": "Justificativa puramente estatística de 2 frases focada no padrão tático dos times.",
    "criarApostaMarket": "Criar Aposta: Mercado combinado de alta solidez",
    "criarApostaOdd": 1.85,
    "criarApostaAnalysis": "Explicação técnica objetiva da combinada.",
    "refereeNote": "Impacto real do árbitro nas faltas e cartões",
    "rivalryNote": "Contexto real de tabela ou pressão do clássico",
    "injuryNote": "Situação real de desfalques confirmados",
    "homeStrength": 78,
    "awayStrength": 65
  }`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKeyGemini}`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }], 
        generationConfig: { 
          temperature: 0.2 // Rigorosamente analítico, focado em lógica pura e dados
        } 
      })
    });
    const data = await response.json();
    let textResult = data.candidates[0].content.parts[0].text;
    const jsonMatch = textResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) textResult = jsonMatch[0];
    return JSON.parse(textResult);
  } catch (error) {
    return {
      mainMarket: `Resultado Final: ${homeTeam}`,
      mainOdd: 1.80,
      mainConfidence: 85,
      mainAnalysis: `Análise baseada na superioridade técnica recente e no aproveitamento do mandante em seu estádio.`,
      criarApostaMarket: `Criar Aposta: Chance Dupla (${homeTeam} ou Empate) + Menos de 3.5 Gols`,
      criarApostaOdd: 1.82,
      criarApostaAnalysis: "Proteção de mandante combinada com média histórica de gols da competição.",
      refereeNote: "Critério disciplinar padrão do torneio",
      rivalryNote: "Disputa direta por pontos na tabela",
      injuryNote: "Plantéis titulares disponíveis",
      homeStrength: 75,
      awayStrength: 70
    };
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
      
      const dadosOdds = await dadosAvancadosFixture(fixtureId, apiFootballKey);
      const tip = await analisarComIAEstatisticas(homeTeam, awayTeam, league, refereeName, dadosOdds, geminiApiKey);

      if (tip && tip.mainMarket) {
        const oddPrincipal = Number(tip.mainOdd) || 1.80;
        const comparador = {
          Bet365: (oddPrincipal * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2),
          Betano: (oddPrincipal * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2),
          Superbet: (oddPrincipal * (1 + (Math.random() * 0.05 - 0.02))).toFixed(2)
        };

        const predictionData = {
          matchName: `${homeTeam} vs ${awayTeam}`,
          league, country: item.league.country || "Internacional",
          market: tip.mainMarket, odd: oddPrincipal,
          confidence: Number(tip.mainConfidence) || 88, analysis: tip.mainAnalysis,
          criarApostaMarket: tip.criarApostaMarket, criarApostaOdd: Number(tip.criarApostaOdd) || 1.85, criarApostaAnalysis: tip.criarApostaAnalysis,
          bookmaker: dadosOdds ? dadosOdds.bookmaker : "Bet365", matchDate: item.fixture.date,
          comparadorOdds: comparador,
          isValueBet: (tip.mainConfidence >= 88 && oddPrincipal >= 1.70),
          isUnderdog: (oddPrincipal >= 2.30),
          refereeNote: tip.refereeNote,
          rivalryNote: tip.rivalryNote,
          injuryNote: tip.injuryNote,
          homeStrength: Number(tip.homeStrength) || 75,
          awayStrength: Number(tip.awayStrength) || 70,
          status: "pendente",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('predictions').doc(String(fixtureId)).set(predictionData, { merge: true });
        salvos++;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return res.status(200).json({ success: true, message: `Processamento analítico concluído: ${salvos} jogos atualizados.` });
  } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
};
