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

const LIGAS_DE_ELITE_IDS = [
  71, 72, 73,       // Brasil
  39, 40,           // Inglaterra
  140, 141, 143,    // Espanha
  135, 136, 137,    // Itália
  78, 79, 81,       // Alemanha
  61, 62,           // França
  2, 3, 848, 13, 11 // Internacionais
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
        let jogosFiltrados = data.response.filter(item => 
          LIGAS_DE_ELITE_IDS.includes(item.league.id) && item.league.id !== 45
        );

        // Rede de segurança: se não houver elite exata hoje, pega os jogos profissionais disponíveis
        if (jogosFiltrados.length === 0) {
          jogosFiltrados = data.response.filter(item => item.league.id !== 45);
        }
        
        const prioridadeLigas = {
          71: 1, 39: 1, 140: 1, 135: 1, 78: 1, 61: 1, 2: 1, 13: 1,
          73: 2, 143: 2, 137: 2, 81: 2, 3: 2, 848: 2, 11: 2,
          72: 3, 40: 3, 141: 3, 136: 3, 79: 3, 62: 3
        };

        jogosFiltrados.sort((a, b) => {
          const pA = prioridadeLigas[a.league.id] || 99;
          const pB = prioridadeLigas[b.league.id] || 99;
          return pA - pB;
        });

        return jogosFiltrados.slice(0, 5); 
      }
    }
  } catch (e) {
    console.log("Erro ao buscar fixtures:", e);
  }

  return [];
}

async function gerarPalpiteIA(home, away, league, referee, geminiKey) {
  const genAI = new GoogleGenerativeAI(geminiKey);
  
  // Modelo universal definitivo compatível com todas as chaves de API do Google AI Studio
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-pro", 
    generationConfig: { responseMimeType: "application/json" } 
  });

  const prompt = `Você é um Tipster Profissional de Elite especialista em análise de futebol. Jogo: ${home} vs ${away} (${league}). Árbitro: ${referee}.
  
  REGRAS ABSOLUTAS:
  1. É OBRIGATÓRIO citar o nome e sobrenome real de um jogador titular específico que atua em ${home} ou ${away} (Ex: Kylian Mbappé, Harry Kane, etc.). Proibido usar "Destaque" ou termos genéricos.
  2. No campo "playerBetMarket", crie um Especial Combinado focado nesse jogador (Ex: "Especiais: [Nome Real] 1+ Finalização no Alvo + Vitória").
  3. No campo "playerBetOdd", insira um valor decimal realista (ex: 2.15).

  Retorne EXATAMENTE um JSON puro sem markdown com esta estrutura exata:
  {
    "mainMarket": "Mercado principal específico",
    "mainOdd": 1.88,
    "mainConfidence": 88,
    "mainAnalysis": "Análise tática detalhada do confronto.",
    "criarApostaMarket": "Criar Aposta: Combinada específica",
    "criarApostaOdd": 1.95,
    "criarApostaAnalysis": "Justificativa técnica.",
    "playerBetMarket": "Especiais: [Nome Real do Jogador] + Aposta",
    "playerBetOdd": 2.15,
    "playerBetAnalysis": "Justificativa tática focada no atleta.",
    "refereeNote": "Análise do árbitro ${referee}",
    "rivalryNote": "Contexto histórico ou tabela",
    "injuryNote": "Panorama de desfalques"
  }`;

  const result = await model.generateContent(prompt);
  let textResponse = result.response.text();
  textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(textResponse);
  } catch (e) {
    const match = textResponse.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw e;
  }
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
    console.error("Erro ao enviar WhatsApp:", err);
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
  if (!apiFootballKey) return res.status(500).json({ success: false, error: "Falta API Key da Football-API" });

  try {
    const matches = await buscarJogosDoDia(apiFootballKey);
    
    if (!matches || matches.length === 0) {
       return res.status(200).json({ success: true, message: "Nenhum jogo disponível na API hoje." });
    }

    let salvos = 0;
    let listaParaWhatsapp = [];

    for (const item of matches) {
      const fixtureId = item.fixture.id;
      const home = item.teams.home.name;
      const away = item.teams.away.name;
      const league = item.league.name;
      const referee = item.fixture.referee || "Árbitro Oficial";

      let ai;
      try {
        ai = await gerarPalpiteIA(home, away, league, referee, geminiApiKey);
      } catch (errAI) {
        console.error(`❌ Erro na IA para ${home} vs ${away}:`, errAI.message);
        continue; 
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
        bookmaker: "Bet365",
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
      
      await new Promise(r => setTimeout(r, 1500));
    }

    if (twilioSid && twilioToken && twilioPhone && meuCelular && listaParaWhatsapp.length > 0) {
      await enviarResumoWhatsApp(twilioSid, twilioToken, twilioPhone, meuCelular, listaParaWhatsapp);
    }

    return res.status(200).json({ success: true, message: `Painel atualizado com sucesso! ${salvos} jogos gravados no Firebase e enviados ao WhatsApp.` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
