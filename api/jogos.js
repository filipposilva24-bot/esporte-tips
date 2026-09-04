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

// LISTA REFINADA: Apenas Elite, Séries B principais e Grandes Copas/Continentais (Sem copas amadoras)
const LIGAS_DE_ELITE_IDS = [
  71, 72, 73,       // Brasil (Série A, Série B, Copa do Brasil)
  39, 40,           // Inglaterra (Premier League, Championship - FA Cup removida por falta de dados)
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
        
        // TABELA DE PESOS RIGOROSA: 1ª Divisão (1) -> Copas Profissionais (2) -> Séries B (3)
        const prioridadeLigas = {
          71: 1, 39: 1, 140: 1, 135: 1, 78: 1, 61: 1, 2: 1, 13: 1, // Elite & Continentais
          73: 2, 143: 2, 137: 2, 81: 2, 3: 2, 848: 2, 11: 2,       // Copas Nacionais
          72: 3, 40: 3, 141: 3, 136: 3, 79: 3, 62: 3              // Séries B
        };

        jogosFiltrados.sort((a, b) => {
          const pA = prioridadeLigas[a.league.id] || 99;
          const pB = prioridadeLigas[b.league.id] || 99;
          return pA - pB;
        });

        console.log(`Jogos ordenados por prioridade de elite: ${jogosFiltrados.length}`);
        
        if (jogosFiltrados.length > 0) {
          return jogosFiltrados.slice(0, 10); // Pega até 10 jogos do topo da prioridade
        }
      }
    }
  } catch (e) {
    console.log("Erro ao buscar fixtures na API-Football:", e);
  }

  return [];
}

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

  const listaNomes = dadosOdds.jogadoresExtraidos.slice(0, 10).map(j => `${j.jogador} (${j.mercado} @${j.odd})`).join(', ');

  const prompt = `Você é um Tipster Profissional de Elite. Jogo: ${home} vs ${away} (${league}). Árbitro: ${referee}.
  JOGADORES REAIS DISPONÍVEIS NAS CASAS DE APOSTAS PARA ESTE JOGO: [ ${listaNomes} ].
  
  REGRAS ABSOLUTAS:
  1. Crie análises, mercados e odds 100% ÚNICAS e VARIADAS baseadas nas características reais de ${home} e ${away}.
  2. No campo "playerBetMarket", escolha obrigatoriamente um jogador real da lista acima e crie um Especial Combinado de Jogador detalhado.
  3. No campo "playerBetOdd", insira um valor numérico decimal válido baseado nos dados ou realista (ex: 2.15).

  Retorne EXATAMENTE um JSON puro (sem markdown, sem \`\`\`json) com esta estrutura exata:
  {
    "mainMarket": "Mercado principal específico",
    "mainOdd": 1.88,
    "mainConfidence": 88,
    "mainAnalysis": "Análise estatística curta e específica do confronto.",
    "criarApostaMarket": "Criar Aposta: [Combinada específica da partida]",
    "criarApostaOdd": 1.95,
    "criarApostaAnalysis": "Justificativa técnica da aposta combinada.",
    "playerBetMarket": "Especiais: [Nome Real do Atleta] [Aposta combinada focada no atleta]",
    "playerBetOdd": 2.15,
    "playerBetAnalysis": "Justificativa tática detalhada do desempenho do atleta.",
    "refereeNote": "Análise específica do impacto do árbitro ${referee}",
    "rivalryNote": "Contexto histórico ou de tabela real entre os clubes",
    "injuryNote": "Panorama real de desfalques prováveis"
  }`;

  const result = await model.generateContent(prompt);
  let textResponse = result.response.text();
  textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

  return JSON.parse(textResponse);
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

      // 1. BUSCA DADOS DE ODDS E JOGADORES REAIS
      const dadosOdds = await buscarDadosAvancadosFixture(fixtureId, apiFootballKey);

      // 2. TRAVA ANTI-LIXO: Se a partida não tiver dados de jogadores/odds na API, IGNORA O JOGO COMPLETAMENTE.
      if (!dadosOdds || !dadosOdds.jogadoresExtraidos || dadosOdds.jogadoresExtraidos.length === 0) {
        console.log(`⚠️ Jogo ${home} vs ${away} ignorado por falta de dados avançados na API.`);
        continue; 
      }

      // 3. GERA O PALPITE COM A IA USANDO OS DADOS REAIS
      let ai;
      try {
        ai = await gerarPalpiteIA(home, away, league, referee, dadosOdds, geminiApiKey);
      } catch (errAI) {
        console.error(`❌ Erro na IA para ${home} vs ${away}, ignorando este jogo:`, errAI.message);
        continue; // Se der qualquer erro na IA, pula o jogo em vez de salvar dados genéricos
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
        bookmaker: dadosOdds.bookmaker,
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
      
      // Pausa de 3 segundos entre os jogos profissionais
      await new Promise(r => setTimeout(r, 3000));
    }

    if (twilioSid && twilioToken && twilioPhone && meuCelular && listaParaWhatsapp.length > 0) {
      await enviarResumoWhatsApp(twilioSid, twilioToken, twilioPhone, meuCelular, listaParaWhatsapp);
    }

    return res.status(200).json({ success: true, message: `Painel atualizado! ${salvos} jogos profissionais processados com sucesso.` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
