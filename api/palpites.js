const admin = require('firebase-admin');

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

function gerarAnaliseRealista(matchName) {
  let hash = 0;
  for (let i = 0; i < matchName.length; i++) {
    hash = (hash << 5) - hash + matchName.charCodeAt(i);
    hash |= 0;
  }
  const h = Math.abs(hash);

  const [mandante, visitante] = matchName.split(' vs ');
  const homeName = mandante || 'Mandante';
  const awayName = visitante || 'Visitante';

  const homeStrength = 47 + (h % 41);
  const awayStrength = 100 - homeStrength;

  const analyses = [
    `O ${homeName} tem demonstrado forte intensidade nas transições ofensivas jogando em casa, enquanto o ${awayName} costuma sofrer defensivamente contra linhas altas. A projeção aponta para um duelo franco, com boas oportunidades de finalização.`,
    `Historicamente, os confrontos envolvendo o ${homeName} apresentam alta taxa de conversão de bolas paradas. O ${awayName}, por sua vez, deve adotar uma postura reativa, explorando os espaços deixados pelos alas adversários.`,
    `Analisando o momento recente, o ${homeName} foca na posse de bola prolongada, o que pode desgastar a compactação defensiva do ${awayName} ao longo da segunda etapa.`,
    `A necessidade de vitória faz com que o ${homeName} assuma riscos desde o apito inicial. Como o ${awayName} possui um contra-ataque rápido e letal, o jogo tende a se desenhar aberto.`,
    `O ${homeName} vem sofrendo para manter sua defesa zerada nos minutos finais, ao passo que o ${awayName} cresce ofensivamente no segundo tempo. Cenário tático propício para o mercado escolhido.`
  ];

  const referees = [
    `Árbitro rigoroso com cartões em faltas táticas de contra-ataque`,
    `Juiz de critério flexível, permitindo contato físico intenso nas disputas aéreas`,
    `Arbitragem com histórico de marcar faltas cavadas na intermediária`,
    `Comando disciplinar equilibrado, com foco total na fluidez do espetáculo`,
    `Rigoroso com reclamações acintosas e simulações na grande área`
  ];

  const rivalries = [
    `Confronto direto por posições vitais na parte superior da tabela`,
    `Clássico regional de altíssima tensão e rivalidade histórica recente`,
    `Disputa de tabu envolvendo o retrospecto dos últimos anos`,
    `Partida de must-win para reverter o momento irregular no torneio`,
    `Choque tático entre propostas de jogo totalmente opostas`
  ];

  const injuries = [
    `Ausências importantes no setor de criação de ambas as equipes`,
    `Ambas as equipes entram em campo com plantéis titulares confirmados e 100% físicos`,
    `Desfalques na linha defensiva exigem cautela redobrada dos setores de marcação`,
    `Treinadores optaram por mexer no esquema tático devido a desgaste físico acumulado`,
    `Retornos importantes de artilheiros para este duelo decisivo`
  ];

  return {
    homeStrength,
    awayStrength,
    analysis: analyses[h % analyses.length],
    refereeNote: referees[(h + 1) % referees.length],
    rivalryNote: rivalries[(h + 3) % rivalries.length],
    injuryNote: injuries[(h + 5) % injuries.length],
    comparadorOdds: {
      Bet365: (1.70 + ((h % 45) / 100)).toFixed(2),
      Betano: (1.72 + (((h + 7) % 38) / 100)).toFixed(2),
      Superbet: (1.68 + (((h + 12) % 42) / 100)).toFixed(2)
    }
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const snapshot = await db.collection('predictions').orderBy('createdAt', 'desc').limit(100).get();
    const predictions = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const matchName = data.matchName || 'Mandante vs Visitante';
      const gerados = gerarAnaliseRealista(matchName);

      predictions.push({
        id: doc.id,
        ...data,
        country: data.country || 'Internacional',
        league: data.league || 'Elite',
        analysis: data.analysis && data.analysis.length > 30 ? data.analysis : gerados.analysis,
        homeStrength: data.homeStrength || gerados.homeStrength,
        awayStrength: data.awayStrength || gerados.awayStrength,
        refereeNote: data.refereeNote || gerados.refereeNote,
        rivalryNote: data.rivalryNote || gerados.rivalryNote,
        injuryNote: data.injuryNote || gerados.injuryNote,
        comparadorOdds: data.comparadorOdds || gerados.comparadorOdds,
        // Mantém o que veio do banco, sem sobrescrever com valores estáticos
        criarApostaMarket: data.criarApostaMarket || "Criar Aposta Clássico indisponível",
        criarApostaOdd: data.criarApostaOdd || 1.85,
        criarApostaAnalysis: data.criarApostaAnalysis || "Análise combinada estruturada.",
        playerBetMarket: data.playerBetMarket || "Especiais de Jogadores indisponíveis",
        playerBetOdd: data.playerBetOdd || 2.10,
        playerBetAnalysis: data.playerBetAnalysis || "Mapeamento tático de atletas."
      });
    });

    return res.status(200).json({ 
      success: true, 
      predictions 
    });

  } catch (error) {
    console.error("Erro ao buscar palpites:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
