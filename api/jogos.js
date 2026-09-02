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
  const contextoOdds = dadosOdds ? `Cotações:\n${dadosOdds.mercadosTexto}` : `Use cotações realistas.`;
  const juizInfo = refereeName ? `Árbitro oficial escalado: ${refereeName}` : `Árbitro a definir`;

  const prompt = `Você é um Analista de Dados e Tipster Profissional de Elite. 
  Partida: ${homeTeam} vs ${awayTeam} (${league}). Casa: ${nomeCasa}.
  ${juizInfo}
  ${contextoOdds}
  
  ⚠️ ATENÇÃO: NUNCA use termos genéricos como "Regular", "Padrão" ou "Disponíveis". Seja 100% específico para estes dois times (${homeTeam} e ${awayTeam}).
  
  Forneça uma análise avançada em JSON estrito contendo:
  - "mainMarket": Melhor mercado principal de valor (+EV).
  - "mainOdd": Odd principal numérica realista.
  - "mainConfidence": Confiança (75 a 96).
  - "mainAnalysis": Análise tática rica e específica (3 frases), citando o estilo de jogo ou momento de ${homeTeam} e ${awayTeam}.
  - "criarApostaMarket": Sugestão de Criar Aposta com teto de odd 2.00.
  - "criarApostaOdd": Odd numérica da combinada (entre 1.65 e 2.00).
  - "criarApostaAnalysis": Justificativa técnica curta.
  - "refereeNote": Perfil disciplinar real baseado no árbitro ou na pressão do jogo (ex: "Rigoroso com faltas táticas", "Permite mais contato físico", "Critérios médios em cartões").
  - "rivalryNote": Grau de rivalidade real do confronto (ex: "Clássico estadual de alta tensão", "Disposição direta por tabela", "Confronto de estilos distintos").
  - "injuryNote": Situação específica de desfalques ou titulares (ex: "Mandante com ausência no meio-campo", "Força máxima em ambos os planteis", "Visitante poupando peças").
  - "homeStrength": Força técnica estimada do mandante (número inteiro entre 45 e 88).
  - "awayStrength": Força técnica estimada do visitante (número inteiro entre 42 e 85).

  Retorne APENAS o JSON válido no formato:
  {
    "mainMarket": "...", "mainOdd": 1.75, "mainConfidence": 89, "mainAnalysis": "...",
    "criarApostaMarket": "...", "criarApostaOdd": 1.85, "criarApostaAnalysis": "...",
    "refereeNote": "...", "rivalryNote": "...", "injuryNote": "...",
    "homeStrength": 78, "awayStrength": 65
  }`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKeyGemini}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.85 } }) // Temperatura maior para gerar variedade
    });
    const data = await response.json();
    let textResult = data.candidates[0].content.parts[0].text;
    const jsonMatch = textResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) textResult = jsonMatch[0];
    return JSON.parse(textResult);
  } catch (error) {
    return null;
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
      const refereeName = item.fixture.referee; // Pega o árbitro direto da API
      
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
          refereeNote: tip.refereeNote || (refereeName ? `Árbitro: ${refereeName}` : "Critério técnico rigoroso"),
          rivalryNote: tip.rivalryNote || "Disputa direta por posições",
          injuryNote: tip.injuryNote || "Plenos plantéis à disposição",
          homeStrength: Number(tip.homeStrength) || 72,
          awayStrength: Number(tip.awayStrength) || 68,
          status: "pendente",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('predictions').doc(String(fixtureId)).set(predictionData, { merge: true });
        salvos++;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return res.status(200).json({ success: true, message: `Atualização Master Concluída: ${salvos} jogos processados com dados variados!` });
  } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
};
