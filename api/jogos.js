import admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Erro ao carregar credenciais:", error);
  }
}

const db = admin.firestore();

// Lista de mercados realistas para sortear
const mercadosDisponiveis = [
  { market: "Over 2.5 Gols", baseOdd: 1.85 },
  { market: "Ambas Marcam (BTTS)", baseOdd: 1.75 },
  { market: "Mais de 9.5 Cantos", baseOdd: 1.90 },
  { market: "Over 1.5 Gols", baseOdd: 1.35 },
  { market: "Empate Anula (Casa)", baseOdd: 1.50 },
  { market: "Handicap Asiático -0.5", baseOdd: 2.05 }
];

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

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const matchName = `${match.homeTeam.name} vs ${match.awayTeam.name}`;
      const league = match.competition.name;
      
      // Sorteia um mercado diferente para cada jogo com base na posição
      const escolhaMercado = mercadosDisponiveis[i % mercadosDisponiveis.length];
      
      // Gera uma variação realista na odd
      const oddAleatoria = Number((escolhaMercado.baseOdd + (Math.random() * 0.2 - 0.1)).toFixed(2));
      const confiancaAleatoria = Math.floor(75 + Math.random() * 15); // Entre 75% e 90%

      const predictionData = {
        matchName,
        league,
        market: escolhaMercado.market,
        odd: oddAleatoria,
        confidence: confiancaAleatoria,
        matchDate: match.utcDate,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('predictions').doc(String(match.id)).set(predictionData, { merge: true });
      salvosCount++;
    }

    return res.status(200).json({ 
      success: true, 
      message: `${salvosCount} jogos sincronizados com mercados variados para o dia ${hoje}!` 
    });

  } catch (error) {
    console.error("Erro na sincronização:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
