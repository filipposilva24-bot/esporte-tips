const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (error) {
    console.error("Erro Firebase:", error);
  }
}

const LIGAS_DE_ELITE_IDS = [
  71, 72, 73,       // Brasil (Série A, Série B, Copa do Brasil)
  39, 40,           // Inglaterra (Premier League, Championship)
  140, 141, 143,    // Espanha (La Liga, La Liga 2, Copa del Rey)
  135, 136, 137,    // Itália (Serie A, Serie B, Coppa Italia)
  78, 79, 81,       // Alemanha (Bundesliga, 2. Bundesliga, DFB Pokal)
  61, 62,           // França (Ligue 1, Ligue 2)
  2, 3, 848, 13, 11 // Internacionais
];

module.exports = async function handler(req, res) {
  const apiFootballKey = process.env.FOOTBALL_API_KEY;
  if (!apiFootballKey) return res.status(500).json({ success: false, error: "Falta API Key" });

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  try {
    // Gasta apenas 1 requisição para testar a listagem
    const resApi = await fetch(`https://v3.football.api-sports.io/fixtures?date=${hoje}&timezone=America/Sao_Paulo`, { 
      headers: { 'x-apisports-key': apiFootballKey } 
    });
    
    if (!resApi.ok) return res.status(400).json({ success: false, message: "Erro ao buscar fixtures" });

    const data = await resApi.json();
    const jogosFiltrados = data.response.filter(item => 
      LIGAS_DE_ELITE_IDS.includes(item.league.id) && item.league.id !== 45
    );

    const prioridadeLigas = {
      71: 1, 39: 1, 140: 1, 135: 1, 78: 1, 61: 1, 2: 1, 13: 1, // Peso 1 (Elite)
      73: 2, 143: 2, 137: 2, 81: 2, 3: 2, 848: 2, 11: 2,       // Peso 2 (Copas)
      72: 3, 40: 3, 141: 3, 136: 3, 79: 3, 62: 3              // Peso 3 (Séries B)
    };

    jogosFiltrados.sort((a, b) => {
      const pA = prioridadeLigas[a.league.id] || 99;
      const pB = prioridadeLigas[b.league.id] || 99;
      return pA - pB;
    });

    const resultadoOrdenado = jogosFiltrados.map((j, idx) => ({
      posicao: idx + 1,
      peso: prioridadeLigas[j.league.id],
      liga: j.league.name,
      partida: `${j.teams.home.name} vs ${j.teams.away.name}`
    }));

    return res.status(200).json({ 
      success: true, 
      totalEncontrados: resultadoOrdenado.length, 
      ordemPrioridade: resultadoOrdenado 
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
