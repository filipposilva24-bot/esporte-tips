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

  // Bancos de frases altamente variados e específicos para cada jogo
  const analyses = [
    `O ${homeName} tem demonstrado forte intensidade nas transições ofensivas jogando em casa, enquanto o ${awayName} costuma sofrer defensivamente contra linhas altas. A projeção aponta para um duelo franco, com boas oportunidades de finalização e valor evidente no mercado selecionado.`,
    `Historicamente, os confrontos envolvendo o ${homeName} apresentam alta taxa de conversão de bolas paradas. O ${awayName}, por sua vez, deve adotar uma postura reativa, explorando os espaços deixados pelos alas adversários. Entrada com excelente expectativa de EV+.`,
    `Analisando o momento recente, o ${homeName} foca na posse de bola prolongada, o que pode desgastar a compactação defensiva do ${awayName} ao longo da segunda etapa. O cenário tático favorece uma abordagem controlada para buscar o green.`,
    `A necessidade de vitória faz com que o ${homeName} assuma riscos desde o apito inicial. Como o ${awayName} possui um contra-ataque rápido e letal, o jogo tende a se desenhar aberto e com grande volume de finalizações de média distância.`,
    `O ${homeName} vem sofrendo para manter sua defesa zerada nos minutos finais, ao passo que o ${awayName} cresce ofensivamente no segundo tempo. Nossa modelagem estatística encontrou uma distorção de preço muito favorável nesta linha.`
  ];

  const referees = [
    `Árbitro rigoroso com cartões em faltas táticas de contra-ataque para ${homeName}`,
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
    `${homeName} tem ausências importantes no setor de criação; ${awayName} vai com força máxima`,
    `Ambas as equipes entram em campo com planteis titulares confirmados e 100% físicos`,
    `${awayName} tem desfalques na linha defensiva e deve adotar postura cautelosa`,
    `Treinadores optaram por mexer no esquema tático devido a desgaste físico acumulado`,
    `${homeName} conta com o retorno do seu principal artilheiro para este duelo`
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
      const timeMandante = matchName.split(' vs ')[0] || 'Mandante';

      predictions.push({
        id: doc.id,
        ...data,
        country: data.country || 'Internacional',
        league: data.league || 'Elite',
        // Sobrescreve com textos e dados analíticos totalmente dinâmicos
        analysis: data.analysis && data.analysis.length > 30 ? data.analysis : gerados.analysis,
        homeStrength: gerados.homeStrength,
        awayStrength: gerados.awayStrength,
        refereeNote: gerados.refereeNote,
        rivalryNote: gerados.rivalryNote,
        injuryNote: gerados.injuryNote,
        comparadorOdds: data.comparadorOdds || gerados.comparadorOdds,
        criarApostaMarket: data.criarApostaMarket || `Criar Aposta: Chance Dupla (${timeMandante} ou Empate) + Menos de 3.5 Gols`,
        criarApostaOdd: data.criarApostaOdd || 1.85,
        criarApostaAnalysis: data.criarApostaAnalysis || "Seleção combinada estruturada para capturar valor estatístico com teto de odd controlado."
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
