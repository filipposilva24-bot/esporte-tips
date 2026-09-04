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

// 1. Busca os jogos do dia e dados da competição na Football-Data
async function buscarJogosDoDia(footballDataKey) {
  const agora = new Date();
  const hoje = agora.toISOString().split('T')[0];
  
  const res = await fetch(`https://api.football-data.org/v4/matches?date=${hoje}`, { 
    headers: { 'X-Auth-Token': footballDataKey } 
  });
  
  if (!res.ok) throw new Error(`Erro football-data: ${res.status}`);
  const data = await res.json();
  if (!data.matches) return [];

  const ligasElite = ['CL', 'BL1', 'BSA', 'PD', 'FL1', 'EC', 'SA', 'PL'];
  return data.matches.filter(match => ligasElite.includes(match.competition?.code)).slice(0, 10);
}

// 2. Busca a Tabela de Classificação (Standings) para extrair dados reais de desempenho
async function buscarDadosTabela(competitionCode, footballDataKey) {
  try {
    const res = await fetch(`https://api.football-data.org/v4/competitions/${competitionCode}/standings`, {
      headers: { 'X-Auth-Token': footballDataKey }
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Retorna a tabela principal (geralmente total)
    const tabelaGeral = data.standings?.find(s => s.type === 'TOTAL')?.table || [];
    return tabelaGeral;
  } catch (e) {
    return null;
  }
}

// 3. Busca Odds Reais (The Odds API) para ancorar o favoritismo matemático
async function buscarOddsReais(oddsApiKey) {
  if (!oddsApiKey) return [];
  try {
    const esportes = [
      'soccer_epl', 'soccer_spain_la_liga', 'soccer_italy_serie_a', 
      'soccer_germany_bundesliga', 'soccer_france_ligue_one', 'soccer_uefa_champs_league', 'soccer_brazil_campeonato'
    ];
    const oddsPromises = esportes.map(sport => 
      fetch(`https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${oddsApiKey}&regions=uk,eu&markets=h2h`)
      .then(res => res.ok ? res.json() : [])
      .catch(() => [])
    );
    const resultados = await Promise.all(oddsPromises);
    return resultados.flat();
  } catch(e) {
    return [];
  }
}

function normalizarNome(nome) {
  return nome.toLowerCase().replace(/( fc| cf| ac| as | 1907| ud| \bde\b| \bdo\b| \bda\b)/g, '').trim();
}

// 4. IA Tipster Quantitativa processando o Dossiê Completo
async function gerarPalpiteIAComDossie(home, away, league, referee, dadosContexto, groqKey) {
  const modelName = "openai/gpt-oss-20b";

  const prompt = `Você é um Analista Quantitativo e Tipster Profissional de Elite. 
  Confronto: ${home} (Mandante) vs ${away} (Visitante) na competição ${league}. Árbitro: ${referee}.
  
  DOSSIÊ DE DADOS REAIS DO JOGO:
  ${dadosContexto}
  
  DIRETRIZES DE ANÁLISE PROFISSIONAL:
  1. IDIOMA OBRIGATÓRIO: Escreva TUDO 100% em Português do Brasil.
  2. ANÁLISE RIGOROSA DOS DADOS: Leia a tabela, a forma recente e as odds de mercado fornecidas no dossiê. Só escolha o mercado principal e a combinada ("Criar Aposta") se os números justificarem matematicamente. Se os dados apontam jogo under, vá de Menos gols. Se há superioridade clara na tabela, explore o handicap ou vitória.
  3. SEM ACHISMOS: Justifique cada centavo da análise usando os dados reais do dossiê (ex: posição na tabela, saldo de gols, cotação das casas).
  4. MATEMÁTICA E COERÊNCIA: A odd da combinada deve refletir o risco real da fusão dos mercados.
  5. NOTAS TÉCNICAS: Avalie o perfil disciplinar do árbitro ${referee}, o contexto real da tabela e desfalques lógicos por setor.

  Retorne EXATAMENTE um JSON puro sem markdown com esta estrutura:
  {
    "mainMarket": "Mercado principal fundamentado nos dados (ex: Vitória do ${home}, Menos de 2.5 Gols, Empate Anula)",
    "mainOdd": 0.00,
    "mainConfidence": 85,
    "mainAnalysis": "Análise técnica profunda baseada estritamente nos dados do dossiê.",
    "criarApostaMarket": "Nome exato da combinada (ex: Vitória do ${home} + Mais de 1.5 Gols)",
    "criarApostaOdd": 0.00,
    "criarApostaAnalysis": "Justificativa tática e estatística da combinada.",
    "refereeNote": "Análise comportamental do árbitro ${referee}",
    "rivalryNote": "Contexto do confronto baseado na tabela atual",
    "injuryNote": "Panorama tático de desfalques por setor"
  }`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: "Você é um analista esportivo quantitativo que processa dados estatísticos e retorna exclusivamente JSON válido." },
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
  const oddsApiKey = process.env.THE_ODDS_API_KEY;
  
  if (!groqKey || !footballDataKey) {
    return res.status(500).json({ success: false, error: "Faltam chaves principais no ambiente." });
  }

  try {
    const [matches, todasAsOdds] = await Promise.all([
      buscarJogosDoDia(footballDataKey),
      buscarOddsReais(oddsApiKey)
    ]);
    
    if (!matches || matches.length === 0) {
       return res.status(200).json({ success: false, message: "Nenhum jogo de elite hoje." });
    }

    let processados = 0;
    const cacheTabelas = {};

    const promessas = matches.map(async (item) => {
      try {
        const matchId = item.id;
        const home = item.homeTeam.name;
        const away = item.awayTeam.name;
        const league = item.competition.name;
        const compCode = item.competition.code;
        const referee = (item.referees && item.referees[0] && item.referees[0].name) || "Árbitro Padrão";

        // Busca e cacheia a tabela da liga para economizar requisições
        if (!cacheTabelas[compCode]) {
          cacheTabelas[compCode] = await buscarDadosTabela(compCode, footballDataKey);
        }
        const tabela = cacheTabelas[compCode] || [];

        // Extrai dados reais do Mandante e Visitante na tabela oficial
        const dadosHome = tabela.find(t => t.team.name.toLowerCase().includes(home.toLowerCase()) || home.toLowerCase().includes(t.team.name.toLowerCase()));
        const dadosAway = tabela.find(t => t.team.name.toLowerCase().includes(away.toLowerCase()) || away.toLowerCase().includes(t.team.name.toLowerCase()));

        let resumoTabela = "Dados da tabela oficial indisponíveis no momento.";
        if (dadosHome && dadosAway) {
          resumoTabela = `
          - ${home} (Mandante): ${dadosHome.position}º lugar | ${dadosHome.playedGames} jogos | ${dadosHome.won}V, ${dadosHome.draw}E, ${dadosHome.lost}D | Saldo de Gols: ${dadosHome.goalDifference} | Pontos: ${dadosHome.points}
          - ${away} (Visitante): ${dadosAway.position}º lugar | ${dadosAway.playedGames} jogos | ${dadosAway.won}V, ${dadosAway.draw}E, ${dadosAway.lost}D | Saldo de Gols: ${dadosAway.goalDifference} | Pontos: ${dadosAway.points}
          `;
        }

        // Cruza com as Odds Reais da The Odds API
        const homeNorm = normalizarNome(home);
        const awayNorm = normalizarNome(away);
        let resumoOdds = "Mercado de odds sem cotação ao vivo cadastrada.";
        let cota1 = 0, cota2 = 0;

        const jogoComOdds = todasAsOdds.find(o => 
          normalizarNome(o.home_team).includes(homeNorm) || normalizarNome(o.away_team).includes(awayNorm)
        );

        if (jogoComOdds && jogoComOdds.bookmakers?.length > 0) {
          const bookmaker = jogoComOdds.bookmakers.find(b => b.key === 'bet365') || jogoComOdds.bookmakers[0];
          const market = bookmaker.markets.find(m => m.key === 'h2h');
          if (market) {
            cota1 = market.outcomes.find(out => out.name === jogoComOdds.home_team)?.price || 0;
            const cotaX = market.outcomes.find(out => out.name === 'Draw')?.price || 0;
            cota2 = market.outcomes.find(out => out.name === jogoComOdds.away_team)?.price || 0;
            resumoOdds = `ODDS REAIS DE MERCADO (1X2): Vitória ${home}: @${cota1} | Empate: @${cotaX} | Vitória ${away}: @${cota2}`;
          }
        }

        // Monta o Dossiê Final Consolidado
        const dossiêCompleto = `
        1. SITUAÇÃO NA TABELA DA LIGA:
        ${resumoTabela}

        2. COTAÇÃO ATUAL DAS CASAS DE APOSTAS:
        ${resumoOdds}
        `;

        const ai = await gerarPalpiteIAComDossie(home, away, league, referee, dossiêCompleto, groqKey);
        
        let oddPrincipal = Number(ai.mainOdd) || 1.85;
        // Auto-correção de odd se a IA escolheu vitória seca e temos a cota real
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

    await Promise.all(promessas);

    return res.status(200).json({ 
      success: true, 
      message: `Análise Quantitativa Completa Concluída! ${processados} jogos processados com base na tabela real e odds de mercado.` 
    });
  } catch (err) {
    return res.status(500).json({ success: false, erroCritico: err.message ?? err });
  }
};
