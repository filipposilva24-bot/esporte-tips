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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    // Pega os últimos 100 palpites para abranger histórico de dias anteriores
    const snapshot = await db.collection('predictions').orderBy('createdAt', 'desc').limit(100).get();
    const predictions = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const timeMandante = data.matchName ? data.matchName.split(' vs ')[0] : 'Mandante';

      predictions.push({
        id: doc.id,
        ...data,
        country: data.country || 'Internacional',
        league: data.league || 'Elite',
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
