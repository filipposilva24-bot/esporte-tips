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

// Captura TODOS os mercados distribuindo entre Bet365, Betano e Superbet
async function buscarTodosOsMercados(fixtureId, apiFootballKey) {
  try {
    const response = await fetch(`https://v3.football.api-sports.io/odds?fixture=${fixtureId}`, {
      headers: { 'x-apisports-key': apiFootballKey }
    });
    
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.response || data.response.length === 0) return null;

    const bookmakers = data.response[0].bookmakers || [];
    const casasAlvo = ["Bet365", "Betano", "Superbet"];
    
    // Embaralha as casas para distribuir igualmente os palpites entre Bet365, Betano e Superbet
    const casasEmbaralhadas = [...casasAlvo].sort(() => Math.random() - 0.5);

    for (const casaNome of casasEmbaralhadas) {
      const bk = bookmakers.find(b => b.name.toLowerCase().includes(casaNome.toLowerCase()));
      if (bk && bk.bets && bk.bets.length > 0) {
        let resumoMercados = [];
        
        // Varre o catálogo completo da casa (1X2, Gols, Escanteios, Cartões, Chutes, DNB, BTTS, etc.)
        bk.bets.forEach(b => {
          const valores = b.values.map(v => `${v.value}: @${v.odd}`).join(', ');
          resumoMercados.push(`- ${b.name}: [${valores}]`);
        });

        if (resumoMercados.length > 0) {
          return {
            bookmaker: bk.name, // Retorna Bet365, Betano ou Superbet
            mercadosTexto: resumoMercados.join('\n')
          };
        }
      }
    }
    return null;
  } catch (error) {
    console.error(`Erro ao buscar todos os mercados para fixture ${fixtureId}:`, error);
    return null;
  }
}

async function analisarComIAEstatisticas(homeTeam, awayTeam, league, dadosOdds, apiKeyGemini) {
  if (!apiKeyGemini) return null;

  const nomeCasa = dadosOdds ? dadosOdds.bookmaker : "Bet365/Betano/Superbet";
  const contextoOdds = dadosOdds 
    ? `Cotações REAIS completas disponíveis na ${nomeCasa} (incluindo Mercados Principais, Estatísticas e Submercados):\n${dadosOdds.mercadosTexto}` 
    : `Utilize cotações realistas de mercado.`;

  const prompt = `Você é um Tipster Profissional de Elite e Analista Tático de Dados Avançados.
  Confronto: ${homeTeam} vs ${awayTeam} (Competição: ${league}).
  Casa de Apostas de Referência: ${nomeCasa}
  
  ${contextoOdds}
  
  SUA MISSÃO: Analisar profundamente o confronto e explorar todo o catálogo da casa fornecido acima (${nomeCasa}). Você tem liberdade total para buscar o maior valor (+EV) não apenas no resultado tradicional, mas em submercados avançados se houver grande vantagem estatística, tais como:
  - Escanteios (Corners Over/Under)
  - Cartões (Total de Cartões / Amarelados)
  - Chutes ao Gol (Player Props)
  - Ambas Marcam (BTTS) / Empate Anula (DNB) / Intervalo (HT/FT)
  
  REGRA ABSOLUTA: O nome do mercado e a "odd" retornadas DEVEM corresponder exatamente aos valores reais listados na casa acima para a entrada escolhida.
  
  Retorne ESTRITAMENTE um objeto JSON válido (sem texto extra, sem blocos markdown):
  {
    "market": "Nome exato do submercado (ex: Mais de 9.5 Escanteios ou Empate Anula: ${homeTeam})",
    "odd": 1.90, 
    "confidence": 90, 
    "analysis": "Explicação técnica de 3 frases cruzando o comportamento tático das equipes com o submercado escolhido para justificar o valor estatístico."
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
      
      const dadosOdds = await buscarTodosOsMercados(fixtureId, apiFootballKey);
      const tipInfo = await analisarComIAEstatisticas(homeTeam, awayTeam, league, dadosOdds, geminiApiKey);

      if (tipInfo && tipInfo.market && tipInfo.analysis) {
        const fallbackCasas = ["Bet365", "Betano", "Superbet"];
        const casaEscolhida = dadosOdds ? dadosOdds.bookmaker : fallbackCasas[Math.floor(Math.random() * fallbackCasas.length)];

        const predictionData = {
          matchName: `${homeTeam} vs ${awayTeam}`,
          league,
          country: item.league.country || "Internacional",
          market: tipInfo.market,
          odd: Number(tipInfo.odd),
          confidence: Number(tipInfo.confidence),
          analysis: tipInfo.analysis,
          bookmaker: casaEscolhida,
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
      message: `CATÁLOGO MULTI-CASA ATIVO (Bet365, Betano, Superbet): ${palpitesSalvos} jogos processados explorando submercados e escanteios!` 
    });

  } catch (error) {
    console.error("Erro na sincronização:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
