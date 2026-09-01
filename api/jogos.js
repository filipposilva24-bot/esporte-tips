import admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    // Lê o JSON inteiro de uma vez só, ignorando os bugs de formatação da Vercel
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Erro fatal ao carregar as credenciais:", error);
  }
}

const db = admin.firestore();

export default async function handler(req, res) {
  const apiKey = process.env.FOOTBALL_API_KEY;
  
  try {
    const hoje = new Date().toISOString().split('T')[0];
    
    const response = await fetch(`https://api.football-data.org/v4/matches?date=${hoje}`, {
      headers: { 'X-Auth-Token': apiKey }
    });
    
    if (!response.ok) {
      throw new Error(`Erro ao buscar dados na API externa: ${response.statusText}`);
    }

    const data = await response.json();
    const matches = data.matches || [];

    let salvosCount = 0;

    for (const match of matches) {
      const matchName = `${match.homeTeam.name} vs ${match.awayTeam.name}`;
      const league = match.competition.name;
      
      const predictionData = {
        matchName,
        league,
        market: "Over 2.5 Gols / Cantos",
        odd: 1.85,
        confidence: 82,
        matchDate: match.utcDate,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('predictions').doc(String(match.id)).set(predictionData, { merge: true });
      salvosCount++;
    }

    return res.status(200).json({ 
      success: true, 
      message: `${salvosCount} jogos sincronizados com sucesso para o dia ${hoje}!` 
    });

  } catch (error) {
    console.error("Erro na sincronização:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
