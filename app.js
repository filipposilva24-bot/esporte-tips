let todasAsPredicoes = [];

window.toggleCriarAposta = function(cardId) {
  const el = document.getElementById(`criar-aposta-${cardId}`);
  if (el) {
    el.style.display = (el.style.display === "none" || el.style.display === "") ? "block" : "none";
  }
};

async function carregarPalpites() {
  const container = document.getElementById('predictions-container');
  container.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 20px;">Carregando análises de elite...</p>';

  try {
    const response = await fetch('/api/palpites');
    const data = await response.json();
    
    if (!data.success || !data.predictions || data.predictions.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 20px;">Nenhum palpite encontrado.</p>';
      return;
    }

    todasAsPredicoes = data.predictions;
    popularFiltros(todasAsPredicoes);
    renderizarCards(todasAsPredicoes);

  } catch (error) {
    console.error("Erro ao carregar palpites:", error);
    container.innerHTML = '<p style="text-align: center; color: #ef4444; padding: 20px;">Erro ao carregar as análises.</p>';
  }
}

function popularFiltros(predicoes) {
  const selectCountry = document.getElementById('filter-country');
  const selectLeague = document.getElementById('filter-league');
  
  const paises = [...new Set(predicoes.map(p => p.country))].sort();
  const ligas = [...new Set(predicoes.map(p => p.league))].sort();

  selectCountry.innerHTML = '<option value="todos">Todos os Países</option>' + paises.map(c => `<option value="${c}">${c}</option>`).join('');
  selectLeague.innerHTML = '<option value="todos">Todas as Ligas</option>' + ligas.map(l => `<option value="${l}">${l}</option>`).join('');
}

window.filtrarPalpites = function() {
  const paisSelecionado = document.getElementById('filter-country').value;
  const ligaSelecionada = document.getElementById('filter-league').value;
  const oddSelecionada = document.getElementById('filter-odd').value;
  const dataSelecionada = document.getElementById('filter-date').value;

  const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  const filtrados = todasAsPredicoes.filter(pred => {
    // Filtro País
    if (paisSelecionado !== 'todos' && pred.country !== paisSelecionado) return false;
    
    // Filtro Liga
    if (ligaSelecionada !== 'todos' && pred.league !== ligaSelecionada) return false;
    
    // Filtro Odd (Principal ou Criar Aposta)
    const oddPrincipal = Number(pred.odd || 0);
    if (oddSelecionada === '1.50' && oddPrincipal > 1.50) return false;
    if (oddSelecionada === '1.80' && oddPrincipal > 1.80) return false;
    if (oddSelecionada === '2.00' && oddPrincipal > 2.00) return false;
    if (oddSelecionada === 'mais' && oddPrincipal <= 2.00) return false;

    // Filtro Data / Histórico
    if (dataSelecionada === 'hoje' && pred.matchDate) {
      const dataJogo = pred.matchDate.split('T')[0];
      if (dataJogo !== hojeStr) return false;
    }

    return true;
  });

  renderizarCards(filtrados);
}

function renderizarCards(predicoes) {
  const container = document.getElementById('predictions-container');
  
  if (predicoes.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 20px;">Nenhum palpite corresponde aos filtros selecionados.</p>';
    return;
  }

  container.innerHTML = '';

  predicoes.forEach(pred => {
    const cardId = pred.id;
    const dataFormatada = pred.matchDate ? new Date(pred.matchDate).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

    const cardHTML = `
      <div class="prediction-card">
        <div class="card-header">
          <div>
            <span class="league-tag">${pred.league || 'Elite'}</span>
            ${dataFormatada ? `<span style="font-size: 0.75rem; color: #94a3b8; margin-left: 8px;">📅 ${dataFormatada}</span>` : ''}
          </div>
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

        <div class="card-footer">
           <span style="font-size: 0.75rem; color: #64748b;">País: ${pred.country || 'Geral'}</span>
           <span>Confiança da IA: <span class="confidence-badge">${pred.confidence || 88}%</span></span>
        </div>
      </div>
    `;

    container.innerHTML += cardHTML;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  carregarPalpites();
});
