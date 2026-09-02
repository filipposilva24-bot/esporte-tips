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

// LISTA BRANCA DE LIGAS DE ELITE
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

// Busca múltiplos mercados reais (1X2, Empate Anula / Draw No Bet, Gols) nas casas oficiais
async function buscarOddsAvancadas(fixtureId, apiFootballKey) {
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
        let resumoMercados = [];
        
        bk.bets.forEach(b => {
          const nome = b.name.toLowerCase();
          // Filtra mercados profissionais principais: Match Winner (1X2), Draw No Bet (Empate Anula), Over/Under Gols
          if (nome.includes("match winner") || nome.includes("draw no bet") || nome.includes("goals over/under") || b.id === 1 || b.id === 3) {
            const valores = b.values.map(v => `${v.value}: @${v.odd}`).join(', ');
            resumoMercados.push(`- ${b.name}: [${valores}]`);
          }
        });

        if (resumoMercados.length > 0) {
          return {
            bookmaker: bk.name,
            mercadosTexto: resumoMercados.join('\n')
          };
        }
      }
    }
    return null;
  } catch (error) {
    console.error(`Erro ao buscar odds avançadas para fixture ${fixtureId}:`, error);
    return null;
  }
}

async function analisarComIAEstatisticas(homeTeam, awayTeam, league, dadosOdds, apiKeyGemini) {
  if (!apiKeyGemini) return null;

  const contextoOdds = dadosOdds 
    ? `Cotações REAIS disponíveis na ${dadosOdds.bookmaker} para este jogo:\n${dadosOdds.mercadosTexto}` 
    : `Utilize cotações realistas de mercado.`;

  const prompt = `Você é um Analista Tático de Elite e Tipster Profissional.
  Confronto: ${homeTeam} vs ${awayTeam} (Competição: ${league}).
  
  ${contextoOdds}
  
  SUA MISSÃO: Analisar a partida taticamente e escolher a melhor aposta de valor (+EV). Você pode escolher mercados como Vitória Simples, Empate Anula a Aposta (Draw No Bet) ou Gols Over/Under. 
  REGRA OBRIGATÓRIA: O nome do mercado e a "odd" retornados DEVEM corresponder exatamente aos valores e cotações reais listados na casa acima. Se escolher Empate Anula, use o nome exato e a odd exata da opção de Draw No Bet da lista.
  
  Retorne ESTRITAMENTE um objeto JSON válido (sem texto extra, sem blocos markdown):
  {
    "market": "Empate Anula a Aposta: ${homeTeam}",
    "odd": 2.00, 
    "confidence": 88, 
    "analysis": "Explicação técnica de 3 frases justificando o valor tático com base no confronto."
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
    const loteDeHoje = matches.slice(0, 5); 
    let palpitesSalvos = 0;

    for (const item of loteDeHoje) {
      const fixtureId = item.fixture.id;
      const homeTeam = item.teams.home.name;
      const awayTeam = item.teams.away.name;
      const league = item.league.name;
      
      const dadosOdds = await buscarOddsAvancadas(fixtureId, apiFootballKey);
      const tipInfo = await analisarComIAEstatisticas(homeTeam, awayTeam, league, dadosOdds, geminiApiKey);

      if (tipInfo && tipInfo.market && tipInfo.analysis) {
        const predictionData = {
          matchName: `${homeTeam} vs ${awayTeam}`,
          league,
          country: item.league.country || "Internacional",
          market: tipInfo.market,
          odd: Number(tipInfo.odd),
          confidence: Number(tipInfo.confidence),
          analysis: tipInfo.analysis,
          bookmaker: dadosOdds ? dadosOdds.bookmaker : "Bet365",
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
      message: `MERCADOS AVANÇADOS SINCRONIZADOS: ${palpitesSalvos} jogos atualizados com cotações reais de DNB e 1X2 da Bet365/Betano!` 
    });

  } catch (error) {
    console.error("Erro na sincronização:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
