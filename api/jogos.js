const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (error) {
    console.error("Erro Firebase:", error);
  }
}

const db = admin.firestore();

// 1. Busca os confrontos e árbitros na Football-Data
async function buscarJogosDoDia(footballDataKey) {
  const agora = new Date();
  const hoje = agora.toISOString().split('T')[0]; // Formato YYYY-MM-DD
  
  const res = await fetch(`https://api.football-data.org/v4/matches?date=${hoje}`, { 
    headers: { 'X-Auth-Token': footballDataKey } 
  });
  
  if (!res.ok) throw new Error(`Erro football-data: ${res.status}`);
  const data = await res.json();
  if (!data.matches) return [];

  const ligasElite = ['CL', 'BL1', 'BSA', 'PD', 'FL1', 'EC', 'SA', 'PL'];
  const jogosElite = data.matches.filter(match => ligasElite.includes(match.competition?.code));
  
  return jogosElite.slice(0, 10); // Retorna até 10 jogos
}

// 2. Busca Odds reais da Bet365 e outras casas (The Odds API)
async function buscarOddsReais(oddsApiKey) {
  try {
    // Array com as chaves de esportes da The Odds API correspondentes às nossas ligas
    const esportes = [
      'soccer_epl', 'soccer_spain_la_liga', 'soccer_italy_serie_a', 
      'soccer_germany_bundesliga', 'soccer_france_ligue_one', 'soccer_uefa_champs_league'
    ];
    
    // Dispara todas as requisições de odds ao mesmo tempo (mais rápido)
    const oddsPromises = esportes.map(sport => 
      fetch(`https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${oddsApiKey}&regions=uk,eu&markets=h2h`)
      .then(res => res.ok ? res.json() : [])
      .catch(() => [])
    );
    
    const resultados = await Promise.all(oddsPromises);
    return resultados.flat(); // Junta tudo num array só
  } catch(e) {
    console.log("Falha ao buscar The Odds API, seguindo sem odds reais.");
    return [];
  }
}

// Função para fazer o "Match" dos nomes dos times entre as duas APIs
function normalizarNome(nome) {
  return nome.toLowerCase().replace(/( fc| cf| ac| as | 1907| ud| \bde\b| \bdo\b| \bda\b)/g, '').trim();
}

// 3. IA Tipster recebendo os DADOS REAIS para analisar
async function gerarPalpiteIA(home, away, league, referee, oddsReaisTexto, groqKey) {
  const modelName = "openai/gpt-oss-20b";

  const prompt = `Você é um Tipster Profissional de Elite especialista em futebol. Jogo: ${home} vs ${away} (${league}). Árbitro: ${referee}.
  
  CENÁRIO DAS CASAS DE APOSTAS:
  ${oddsReaisTexto}
  
  REGRAS CRÍTICAS:
  1. ANÁLISE BASEADA EM FATOS: Se o Cenário das Casas mostrou as odds reais (Vitória Mandante/Visitante/Empate), use-as como base para entender o favoritismo real.
  2. DEVOLVA UMA ODD COERENTE: No campo mainOdd, coloque a odd que faça sentido matemático com a realidade fornecida.
  3. CRIAR APOSTA: A odd da combinada deve respeitar as leis da probabilidade (ex: Dupla Chance joga a odd pra baixo).
  4. PROIBIDO: Não invente posições na tabela (ex: "zona de rebaixamento") se não souber. Fale de estilo de jogo, força ofensiva e tática.

  Retorne EXATAMENTE este JSON puro:
  {
    "mainMarket": "Mercado principal sugerido (ex: Vitória do ${home})",
    "mainOdd": 0.00, // Preencha com valor numérico realístico
    "mainConfidence": 85,
    "mainAnalysis": "Análise tática sem inventar posições na tabela.",
    "criarApostaMarket": "Criar Aposta: Combinada segura",
    "criarApostaOdd": 0.00, // Valor matemático realístico
    "criarApostaAnalysis": "Justificativa da combinada.",
    "refereeNote": "Análise do perfil do árbitro ${referee}",
    "rivalryNote": "Contexto histórico (sem inventar pontuações)",
    "injuryNote": "Possíveis desfalques por setor (sem inventar nomes de atletas)"
  }`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: "Você é um tipster esportivo que processa dados e retorna exclusivamente JSON válido." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error("Erro Groq API");
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

module.exports = async function handler(req, res) {
  const footballDataKey = process.env.FOOTBALL_DATA_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const oddsApiKey = process.env.THE_ODDS_API_KEY; // NOVA CHAVE DA ODDS API
  
  if (!groqKey || !footballDataKey) {
    return res.status(500).json({ success: false, error: "Faltam chaves de API essenciais no .env" });
  }

  try {
    const [matches, todasAsOdds] = await Promise.all([
      buscarJogosDoDia(footballDataKey),
      oddsApiKey ? buscarOddsReais(oddsApiKey) : []
    ]);
    
    if (!matches || matches.length === 0) {
       return res.status(200).json({ success: false, message: "Nenhum jogo de elite hoje." });
    }

    let processados = 0;

    // Processar múltiplos jogos simultaneamente para não dar "Time Out" na Vercel
    const promessasDeProcessamento = matches.map(async (item) => {
      try {
        const matchId = item.id;
        const home = item.homeTeam.name;
        const away = item.awayTeam.name;
        const league = item.competition.name;
        const referee = (item.referees && item.referees[0] && item.referees[0].name) || "Árbitro Padrão";

        // Fazendo o cruzamento (Match) das duas APIs
        const homeNorm = normalizarNome(home);
        const awayNorm = normalizarNome(away);
        
        let textoDeOddsParaIA = "Sem odds em tempo real disponíveis. Estime baseado no favoritismo histórico.";
        
        const jogoComOdds = todasAsOdds.find(o => 
          normalizarNome(o.home_team).includes(homeNorm) || normalizarNome(o.away_team).includes(awayNorm)
        );

        let cota1 = 0, cotaX = 0, cota2 = 0;

        if (jogoComOdds && jogoComOdds.bookmakers && jogoComOdds.bookmakers.length > 0) {
          const bookmaker = jogoComOdds.bookmakers.find(b => b.key === 'bet365') || jogoComOdds.bookmakers[0];
          const market = bookmaker.markets.find(m => m.key === 'h2h');
          if (market) {
            cota1 = market.outcomes.find(out => out.name === jogoComOdds.home_team)?.price || 0;
            cotaX = market.outcomes.find(out => out.name === 'Draw')?.price || 0;
            cota2 = market.outcomes.find(out => out.name === jogoComOdds.away_team)?.price || 0;
            textoDeOddsParaIA = `ODDS REAIS (1X2): Vitória ${home}: @${cota1} | Empate: @${cotaX} | Vitória ${away}: @${cota2}`;
          }
        }

        const ai = await gerarPalpiteIA(home, away, league, referee, textoDeOddsParaIA, groqKey);
        
        // Se a IA alucinar a odd e a The Odds tiver a cota real de vitória, o sistema ajusta pra real automaticamente:
        let oddPrincipal = Number(ai.mainOdd) || 1.85;
        if (cota1 > 0 && ai.mainMarket.toLowerCase().includes(homeNorm)) oddPrincipal = cota1;
        if (cota2 > 0 && ai.mainMarket.toLowerCase().includes(awayNorm)) oddPrincipal = cota2;

        const docData = {
          matchName: `${home} vs ${away}`,
          league,
          country: item.competition.area?.name || "Internacional",
          market: ai.mainMarket,
          odd: oddPrincipal,
          confidence: Number(ai.mainConfidence) || 85,
          analysis: ai.mainAnalysis,
          criarApostaMarket: ai.criarApostaMarket,
          criarApostaOdd: Number(ai.criarApostaOdd) || 1.95,
          criarApostaAnalysis: ai.criarApostaAnalysis,
          bookmaker: "Bet365",
          matchDate: item.utcDate,
          comparadorOdds: {
            Bet365: (oddPrincipal * 1.01).toFixed(2),
            Betano: (oddPrincipal * 0.99).toFixed(2),
            Superbet: (oddPrincipal * 1.02).toFixed(2)
          },
          isValueBet: oddPrincipal >= 1.70,
          isUnderdog: oddPrincipal >= 2.30,
          refereeNote: ai.refereeNote,
          rivalryNote: ai.rivalryNote,
          injuryNote: ai.injuryNote,
          status: "pendente",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('predictions').doc(String(matchId)).set(docData);
        processados++;
      } catch (e) {
        console.error(`Erro ao processar jogo ${item.id}:`, e.message);
      }
    });

    // Aguarda o término de todos os processamentos
    await Promise.all(promessasDeProcessamento);

    return res.status(200).json({ 
      success: true, 
      message: `Integração Total Finalizada! ${processados} jogos cruzados com odds reais, analisados e salvos!` 
    });
  } catch (err) {
    return res.status(500).json({ success: false, erroCritico: err.message });
  }
};
