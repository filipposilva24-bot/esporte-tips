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
    const snapshot = await db.collection('predictions').orderBy('createdAt', 'desc').get();
    const predictions = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Extrai o nome do mandante para o fallback se precisar
      const timeMandante = data.matchName ? data.matchName.split(' vs ')[0] : 'Mandante';

      // Garante que todo card tenha o Criar Aposta (mesmo se for um registro antigo do banco)
      const criarApostaMarket = data.criarApostaMarket || `Criar Aposta: Chance Dupla (${timeMandante} ou Empate) + Menos de 3.5 Gols`;
      const criarApostaOdd = data.criarApostaOdd || 1.85;
      const criarApostaAnalysis = data.criarApostaAnalysis || "Seleção combinada estruturada para capturar valor estatístico com teto de odd controlado e alta probabilidade de êxito.";

      predictions.push({
        id: doc.id,
        ...data,
        criarApostaMarket,
        criarApostaOdd,
        criarApostaAnalysis
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
