// Função global para alternar a gaveta do Criar Aposta
window.toggleCriarAposta = function(cardId) {
  const el = document.getElementById(`criar-aposta-${cardId}`);
  if (el) {
    if (el.style.display === "none" || el.style.display === "") {
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
  }
};

// Carrega os palpites direto da nossa API segura
async function carregarPalpites() {
  const container = document.getElementById('predictions-container');
  container.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 20px;">Carregando análises de elite...</p>';

  try {
    const response = await fetch('/api/palpites');
    const data = await response.json();
    
    if (!data.success || !data.predictions || data.predictions.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 20px;">Nenhum palpite encontrado para hoje. Execute a API para gerar novas entradas.</p>';
      return;
    }

    container.innerHTML = '';

    data.predictions.forEach(pred => {
      const cardId = pred.id;
      const temCriarAposta = pred.criarApostaMarket ? true : false;

      const cardHTML = `
        <div class="prediction-card">
          <div class="card-header">
            <span class="league-tag">${pred.league || 'Elite'}</span>
            <span class="bookmaker-tag">${pred.bookmaker || 'Bet365'}</span>
          </div>

          <h3 class="match-title">${pred.matchName}</h3>

          <!-- APOSTA PRINCIPAL -->
          <div class="main-market-box">
            <div class="market-row">
              <span class="market-name">🎯 ${pred.market}</span>
              <span class="market-odd">@${pred.odd ? Number(pred.odd).toFixed(2) : '1.80'}</span>
            </div>
            <p class="market-analysis">${pred.analysis}</p>
          </div>

          <!-- SEGUNDA OPÇÃO: CRIAR APOSTA (ATÉ 2.00) -->
          ${temCriarAposta ? `
            <div class="criar-aposta-section">
              <button class="criar-aposta-btn" onclick="toggleCriarAposta('${cardId}')">
                ⚡ Sugestão de Criar Aposta (Até 2.00)
              </button>
              
              <div id="criar-aposta-${cardId}" class="criar-aposta-content">
                <div class="market-row" style="margin-bottom: 4px;">
                  <span style="color: #60a5fa; font-weight: bold; font-size: 0.9rem;">${pred.criarApostaMarket}</span>
                  <span style="color: #f59e0b; font-weight: bold; font-size: 1rem;">@${pred.criarApostaOdd ? Number(pred.criarApostaOdd).toFixed(2) : '1.85'}</span>
                </div>
                <p class="market-analysis" style="font-size: 0.85rem;">${pred.criarApostaAnalysis}</p>
              </div>
            </div>
          ` : ''}

          <div class="card-footer">
            <span>Confiança da IA: <span class="confidence-badge">${pred.confidence || 88}%</span></span>
          </div>
        </div>
      `;

      container.innerHTML += cardHTML;
    });

  } catch (error) {
    console.error("Erro ao carregar palpites:", error);
    container.innerHTML = '<p style="text-align: center; color: #ef4444; padding: 20px;">Erro ao carregar as análises. Tente atualizar a página.</p>';
  }
}

// Inicializa a listagem ao carregar a página
document.addEventListener('DOMContentLoaded', () => {
  carregarPalpites();
});
