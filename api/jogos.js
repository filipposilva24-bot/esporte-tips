const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require("@google/generative-ai");

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (error) {
    console.error("Erro Firebase:", error);
  }
}

const db = admin.firestore();

// LISTA COMPLETA: Elite, Séries B principais e Copas Nacionais/Continentais
const LIGAS_DE_ELITE_IDS = [
  71, 72, 73,       // Brasil (Série A, Série B, Copa do Brasil)
  39, 40, 45,       // Inglaterra (Premier League, Championship, FA Cup)
  140, 141, 143,    // Espanha (La Liga, La Liga 2, Copa del Rey)
  135, 136, 137,    // Itália (Serie A, Serie B, Coppa Italia)
  78, 79, 81,       // Alemanha (Bundesliga, 2. Bundesliga, DFB Pokal)
  61, 62,           // França (Ligue 1, Ligue 2)
  2, 3, 848, 13, 11 // Internacionais (Champions, Europa, Conference, Libertadores, Sul-Americana)
];

async function buscarJogosDoDia(apiFootballKey) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  
  try {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${hoje}&timezone=America/Sao_Paulo`, { 
      headers: { 'x-apisports-key': apiFootballKey } 
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.response && data.response.length > 0) {
        console.log(`Total de jogos na API hoje: ${data.response.length}`);
        const jogosFiltrados = data.response.filter(item => LIGAS_DE_ELITE_IDS.includes(item.league.id));
        
        // TABELA DE PESOS: Quanto menor o número, maior a prioridade no painel
        const prioridadeLigas = {
          // Peso 1: 1ª Divisão / Principais Continentais (Máxima Prioridade)
          71: 1, 39: 1, 140: 1, 135: 1, 78: 1, 61: 1, 2: 1, 13: 1,
          
          // Peso 2: Copas Nacionais e Outras Continentais (Prioridade Média)
          73: 2, 45: 2, 143: 2, 137: 2, 81: 2, 3: 2, 848: 2, 11: 2,
          
          // Peso 3: Séries B / Segunda Divisão (Prioridade Menor)
          72: 3, 40: 3, 141: 3, 136: 3, 79: 3, 62: 3
        };

        // Ordena os jogos do dia baseando-se na tabela de pesos acima
        jogosFiltrados.sort((a, b) => {
          const pA = prioridadeLigas[a.league.id] || 99;
          const pB = prioridadeLigas[b.league.id] || 99;
          return pA - pB;
        });

        console.log(`Jogos ordenados por prioridade de elite: ${jogosFiltrados.length}`);
        
        if (jogosFiltrados.length > 0) {
          return jogosFiltrados.slice(0, 10); // Pega os 10 primeiros já priorizando a elite!
        }
      }
    }
  } catch (e) {
    console.log("Erro ao buscar fixtures na API-Football:", e);
  }

  return [];
}


// BUSCA DADOS REAIS E JOGADORES DIRETO DA API DE ODDS
async function buscarDadosAvancadosFixture(fixtureId, apiFootballKey) {
  try {
    const response = await fetch(`https://v3.football.api-sports.io/odds?fixture=${fixtureId}`, { 
      headers: { 'x-apisports-key': apiFootballKey } 
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.response || data.response.length === 0) return null;

    const bookmakers = data.response[0].bookmakers || [];
    const casasAlvo = ["Bet365", "Betano", "Superbet"];
    let bk = bookmakers.find(b => casasAlvo.some(casa => b.name.toLowerCase().includes(casa.toLowerCase()))) || bookmakers[0];

    let jogadoresExtraidos = [];

    if (bk && bk.bets) {
      bk.bets.forEach(b => {
        const nomeM = b.name.toLowerCase();
        // Procura mercados de jogadores (chutes, artilheiros, etc.)
        if (nomeM.includes('player') || nomeM.includes('scorer') || nomeM.includes('shots') || nomeM.includes('target')) {
          b.values.forEach(v => {
            if (v.value && v.value.length > 3 && !v.value.toLowerCase().includes('yes') && !v.value.toLowerCase().includes('no')) {
              jogadoresExtraidos.push({ mercado: b.name, jogador: v.value, odd: v.odd });
            }
          });
        }
      });
    }

    return { 
      bookmaker: bk ? bk.name : "Bet365", 
      jogadoresExtraidos 
    };
  } catch (e) { 
    return null; 
  }
}

async function gerarPalpiteIA(home, away, league, referee, dadosOdds, geminiKey) {
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-3.6-flash", 
    generationConfig: { responseMimeType: "application/json" } 
  });

  let contextoJogadores = "";
  if (dadosOdds && dadosOdds.jogadoresExtraidos.length > 0) {
    const listaNomes = dadosOdds.jogadoresExtraidos.slice(0, 8).map(j => `${j.jogador} (${j.mercado} @${j.odd})`).join(', ');
    contextoJogadores = `ATENÇÃO: Use obrigatoriamente estes jogadores reais listados pela casa de apostas para este jogo: [ ${listaNomes} ]. NUNCA invente nomes genéricos.`;
  } else {
    contextoJogadores = `Certifique-se de citar nomes reais e corretos de atletas titulares que atuam atualmente em ${home} ou ${away}.`;
  }

  const prompt = `Você é um Tipster Profissional de Elite. Jogo: ${home} vs ${away} (${league}). Árbitro: ${referee}.
  ${contextoJogadores}
  
  REGRAS ABSOLUTAS:
  1. No campo "playerBetMarket", crie um **Criar Aposta / Especial Combinado de Jogador** mais encorpado (Ex: "Especiais: [Nome Real do Jogador] 1+ Chute ao Alvo + Vitória do ${home} ou Empate"). Nunca use apenas uma linha simples se puder agregar valor, e NUNCA deixe genérico.
  2. No campo "playerBetOdd", insira um valor numérico decimal válido (ex: 2.15).

  Retorne estritamente um JSON válido com esta estrutura exata:
  {
    "mainMarket": "Mercado principal específico",
    "mainOdd": 1.88,
    "mainConfidence": 88,
    "mainAnalysis": "Análise estatística curta de 2 frases.",
    "criarApostaMarket": "Criar Aposta: [Combinada de equipe]",
    "criarApostaOdd": 1.95,
    "criarApostaAnalysis": "Justificativa técnica curta.",
    "playerBetMarket": "Especiais: [Nome Real do Jogador] [Sua aposta combinada focada no atleta]",
    "playerBetOdd": 2.15,
    "playerBetAnalysis": "Justificativa tática detalhada baseada no desempenho recente do atleta.",
    "refereeNote": "Impacto disciplinar do árbitro",
    "rivalryNote": "Contexto histórico ou de tabela",
    "injuryNote": "Panorama de desfalques"
  }`;

  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}

async function enviarResumoWhatsApp(accountSid, authToken, fromNumber, toNumber, palpitesGerados) {
  if (!accountSid || !authToken || !toNumber) return;

  let mensagem = `🔥 *RELATÓRIO DIÁRIO - ESPORTE TIPS PRO* 🔥\n\n`;
  
  palpitesGerados.forEach(p => {
    mensagem += `⚽ *${p.matchName}* (${p.league})\n` +
      `🎯 *Principal:* ${p.market} (@${p.odd} - ${p.confidence}% Confiança)\n` +
      `⚡ *Criar Aposta:* ${p.criarApostaMarket} (@${p.criarApostaOdd})\n` +
      `⭐ *Player Prop:* ${p.playerBetMarket} (@${p.playerBetOdd})\n\n`;
  });

  mensagem += `📊 *Acesse o painel web para ver as análises completas!*`;

  try {
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        From: `whatsapp:${fromNumber}`,
        To: `whatsapp:${toNumber}`,
        Body: mensagem
      })
    });
  } catch (err) {
    console.error("Erro ao enviar mensagem para o WhatsApp:", err);
  }
}

module.exports = async function handler(req, res) {
  const apiFootballKey = process.env.FOOTBALL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
  const meuCelular = process.env.MEU_CELULAR;
  
  if (!geminiApiKey) return res.status(500).json({ success: false, error: "Falta API Key do Gemini" });

  try {
    const matches = await buscarJogosDoDia(apiFootballKey);
    
    if (!matches || matches.length === 0) {
       return res.status(200).json({ success: true, message: "Nenhum jogo das ligas de elite/copas encontrado para a data de hoje." });
    }

    let salvos = 0;
    let listaParaWhatsapp = [];

    for (const item of matches) {
      const fixtureId = item.fixture.id;
      const home = item.teams.home.name;
      const away = item.teams.away.name;
      const league = item.league.name;
      const referee = item.fixture.referee || "Árbitro Oficial";

      // Busca dados avançados de odds e jogadores reais antes de chamar a IA
      const dadosOdds = await buscarDadosAvancadosFixture(fixtureId, apiFootballKey);

      let ai;
      try {
        ai = await gerarPalpiteIA(home, away, league, referee, dadosOdds, geminiApiKey);
      } catch (errAI) {
        ai = {
          mainMarket: "Ambas as Equipes Marcam",
          mainOdd: 1.85,
          mainConfidence: 85,
          mainAnalysis: "Confronto com alta expectativa de gols e intensidade ofensiva.",
          criarApostaMarket: `Criar Aposta: ${home} ou Empate + Mais de 1.5 Gols`,
          criarApostaOdd: 1.92,
          criarApostaAnalysis: "Mandante forte e necessidade de vitória.",
          playerBetMarket: "Especiais: Atleta Principal 1+ Finalização no Alvo + Time Vence",
          playerBetOdd: 2.10,
          playerBetAnalysis: "Boa média de finalizações recentes do principal nome ofensivo.",
          refereeNote: "Arbitragem equilibrada.",
          rivalryNote: "Disputa importante na tabela.",
          injuryNote: "Elencos disponíveis."
        };
      }

      const oddPrincipal = Number(ai.mainOdd) || 1.85;

      const docData = {
        matchName: `${home} vs ${away}`,
        league,
        country: item.league.country || "Internacional",
        market: ai.mainMarket,
        odd: oddPrincipal,
        confidence: Number(ai.mainConfidence) || 85,
        analysis: ai.mainAnalysis,
        criarApostaMarket: ai.criarApostaMarket,
        criarApostaOdd: Number(ai.criarApostaOdd) || 1.95,
        criarApostaAnalysis: ai.criarApostaAnalysis,
        playerBetMarket: ai.playerBetMarket,
        playerBetOdd: Number(ai.playerBetOdd) || 2.10,
        playerBetAnalysis: ai.playerBetAnalysis,
        bookmaker: dadosOdds ? dadosOdds.bookmaker : "Bet365",
        matchDate: item.fixture.date,
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

      await db.collection('predictions').doc(String(fixtureId)).set(docData);
      listaParaWhatsapp.push(docData);
      salvos++;
      
      // PAUSA DE SEGURANÇA AUMENTADA PARA 3 SEGUNDOS (Evita travar a IA e cair no fallback)
      await new Promise(r => setTimeout(r, 3000));
    }

    if (twilioSid && twilioToken && twilioPhone && meuCelular && listaParaWhatsapp.length > 0) {
      await enviarResumoWhatsApp(twilioSid, twilioToken, twilioPhone, meuCelular, listaParaWhatsapp);
    }

    return res.status(200).json({ success: true, message: `Painel atualizado e mensagem enviada no WhatsApp! ${salvos} jogos processados.` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
