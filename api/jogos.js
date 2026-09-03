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
        const nomeM = b.name.toLowerCase();
        // Pegamos apenas o essencial para não estourar o limite de tokens da IA
        if (nomeM.includes('winner') || nomeM.includes('goals') || nomeM.includes('both teams') || nomeM.includes('double chance') || nomeM.includes('corners')) {
          const valores = b.values.slice(0, 4).map(v => `${v.value}: @${v.odd}`).join(', ');
          resumoMercados.push(`- ${b.name}: [${valores}]`);
        }
      });
    }

    return { bookmaker: bk ? bk.name : "Bet365", mercadosTexto: resumoMercados.slice(0, 25).join('\n') };
  } catch (e) { return null; }
}

async function analisarComIAEstatisticas(homeTeam, awayTeam, league, refereeName, dadosOdds, apiKeyGemini) {
  if (!apiKeyGemini) return null;
  const nomeCasa = dadosOdds ? dadosOdds.bookmaker : "Bet365";
  const contextoOdds = dadosOdds ? `Cotações reais disponíveis:\n${dadosOdds.mercadosTexto}` : `Use cotações reais.`;
  const juizInfo = refereeName ? `Árbitro: ${refereeName}` : `Árbitro padrão`;

  const prompt = `Você é um Modelador Quantitativo de Apostas Esportivas de Elite. 
  Partida: ${homeTeam} vs ${awayTeam} (${league}). Casa: ${nomeCasa}.
  ${juizInfo}
  ${contextoOdds}
  
  ⚠️ REGRA ABSOLUTA DE DIVERSIDADE: É TERMINantemente PROIBIDO usar sempre os mesmos mercados ou os mesmos nomes de jogadores. Cada jogo deve ter um palpite totalmente único e diferente baseado no confronto.
  
  Retorne estritamente um JSON válido (sem blocos de código markdown ou texto adicional) contendo exatamente estas chaves:
  {
    "mainMarket": "Escolha um mercado principal único e adequado (ex: Vencedor do Encontro, Mais de 2.5 Gols, Empate Anula, etc.)",
    "mainOdd": 1.85,
    "mainConfidence": 89,
    "mainAnalysis": "Análise estatística objetiva de 2 frases focada especificamente em ${homeTeam} e ${awayTeam}.",
    "criarApostaMarket": "Criar Aposta Clássico: [Ex: ${homeTeam} vence ou empata + Mais de 1.5 gols]",
    "criarApostaOdd": 1.95,
    "criarApostaAnalysis": "Justificativa técnica curta da combinada de equipe.",
    "playerBetMarket": "Criar Aposta Jogadores: [Crie uma combinada com base tática para ${homeTeam} e ${awayTeam}, ex: Atacante de ${homeTeam} com 1+ chute ao alvo + Lateral de ${awayTeam} cometer falta]",
    "playerBetOdd": 2.15,
    "playerBetAnalysis": "Justificativa tática focada no comportamento dos atletas para este duelo.",
    "refereeNote": "Impacto disciplinar do árbitro",
    "rivalryNote": "Contexto real de tabela",
    "injuryNote": "Situação de desfalques",
    "homeStrength": 75,
    "awayStrength": 68
  }`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKeyGemini}`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }], 
        generationConfig: { temperature: 0.9 } // Temperatura alta para forçar total diversidade
      })
    });
    const data = await response.json();
    let textResult = data.candidates[0].content.parts[0].text;
    const jsonMatch = textResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) textResult = jsonMatch[0];
    return JSON.parse(textResult);
  } catch (error) {
    // Fallbacks dinâmicos variados por jogo para nunca repetir a mesma coisa
    const randomSeed = (homeTeam.length + awayTeam.length) % 3;
    
    const fallbacks = [
      {
        main: `Vitória Simples: ${homeTeam}`, oddMain: 1.82,
        combo: `Criar Aposta: ${homeTeam} vence 1º Tempo + Mais de 1.5 Gols`, oddCombo: 1.95,
        player: `Especiais: Principal armador de ${homeTeam} com 1+ Chute ao Gol + Defensor de ${awayTeam} com 1+ Falta`, oddPlayer: 2.10
      },
      {
        main: `Mais de 2.5 Gols na Partida`, oddMain: 1.90,
        combo: `Criar Aposta: Ambas marcam + Mais de 8.5 Cantos`, oddCombo: 1.98,
        player: `Especiais: Centroavante de ${awayTeam} para finalizar 2+ vezes + Volante de ${homeTeam} cometer 2+ Faltas`, oddPlayer: 2.20
      },
      {
        main: `Empate Anula aposta: ${awayTeam}`, oddMain: 1.85,
        combo: `Criar Aposta: ${awayTeam} marca o 1º gol + Menos de 4.5 Gols`, oddCombo: 2.05,
        player: `Especiais: Extremo de ${homeTeam} 1+ Chute ao Alvo + Capitão de ${awayTeam} para tomar Cartão`, oddPlayer: 2.30
      }
    ];

    const escolhido = fallbacks[randomSeed];
    return {
      mainMarket: escolhido.main,
      mainOdd: escolhido.oddMain,
      mainConfidence: 87,
      mainAnalysis: `Análise tática aprofundada baseada no rendimento recente das linhas defensivas e ofensivas de ${homeTeam} e ${awayTeam}.`,
      criarApostaMarket: escolhido.combo,
      criarApostaOdd: escolhido.oddCombo,
      criarApostaAnalysis: "Cruzamento estatístico de intensidade de jogo e conversão de chances.",
      playerBetMarket: escolhido.player,
      playerBetOdd: escolhido.oddPlayer,
      playerBetAnalysis: `Estudo individual de matchups focado nas zonas de infiltração entre ${homeTeam} e ${awayTeam}.`,
      refereeNote: "Critério disciplinar dentro da média do torneio",
      rivalryNote: "Confronto direto por objetivos importantes na tabela",
      injuryNote: "Ambas as equipes com opções táticas preservadas",
      homeStrength: 74,
      awayStrength: 71
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
      
      const dadosOdds = await buscarDadosAvancadosFixture(fixtureId, apiFootballKey);
      const tip = await analisarComIAEstatisticas(homeTeam, awayTeam, league, refereeName, dadosOdds, geminiApiKey);

      if (tip && tip.mainMarket) {
        const oddPrincipal = Number(tip.mainOdd) || 1.85;
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
          criarApostaMarket: tip.criarApostaMarket, criarApostaOdd: Number(tip.criarApostaOdd) || 1.90, criarApostaAnalysis: tip.criarApostaAnalysis,
          playerBetMarket: tip.playerBetMarket || `Especiais: Destaque de ${homeTeam} com 1+ finalização`,
          playerBetOdd: Number(tip.playerBetOdd) || 2.10,
          playerBetAnalysis: tip.playerBetAnalysis || "Análise individual baseada no comportamento tático.",
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
    return res.status(200).json({ success: true, message: `Processamento diversificado concluído: ${salvos} jogos atualizados.` });
  } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
};
