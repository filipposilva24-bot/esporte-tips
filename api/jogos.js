import admin from 'firebase-admin';

if (!admin.apps.length) {
  let rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  
  // Remove aspas acidentais
  rawPrivateKey = rawPrivateKey.trim();
  if ((rawPrivateKey.startsWith('"') && rawPrivateKey.endsWith('"')) || (rawPrivateKey.startsWith("'") && rawPrivateKey.endsWith("'"))) {
    rawPrivateKey = rawPrivateKey.slice(1, -1);
  }

  let formattedKey = rawPrivateKey;
  try {
    // Extrai apenas o conteúdo base64 limpo (removendo cabeçalhos, rodapés e qualquer quebra de linha errada)
    const cleanBase64 = rawPrivateKey
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\\n/g, '')
      .replace(/\n/g, '')
      .replace(/\r/g, '')
      .replace(/\s+/g, '');

    // Reconstrói a chave no formato PEM exato exigido pelo Node.js/Firebase
    const chunked = cleanBase64.match(/.{1,64}/g).join('\n');
    formattedKey = `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----\n`;
  } catch (e) {
    console.error("Erro ao formatar chave:", e);
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: formattedKey,
    }),
  });
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
