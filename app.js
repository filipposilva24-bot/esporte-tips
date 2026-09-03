let todosPalpitesGlobais = [];

async function carregarPalpites() {
  const container = document.getElementById('app-container');
  try {
    const res = await fetch('/api/palpites');
    const data = await res.json();
    
    if (!data.success || !data.predictions.length) {
      container.innerHTML = '<div class="text-center py-10 text-slate-400">Nenhum palpite encontrado no momento.</div>';
      return;
    }

    todosPalpitesGlobais = data.predictions;
    renderizarPalpites(todosPalpitesGlobais);
    criarBarraFiltros();
  } catch (err) {
    container.innerHTML = '<div class="text-center py-10 text-red-400">Erro ao carregar os dados dos palpites.</div>';
  }
}

// Cria os botões de filtro dinamicamente na tela
function criarBarraFiltros() {
  if (document.getElementById('filtro-container')) return;

  const containerPrincipal = document.getElementById('app-container');
  const ligas = ['Todas', ...new Set(todosPalpitesGlobais.map(p => p.league).filter(Boolean))];

  const filtroDiv = document.createElement('div');
  filtroDiv.id = 'filtro-container';
  filtroDiv.className = 'flex flex-wrap gap-2 justify-center mb-6';
  
  filtroDiv.innerHTML = ligas.map(liga => `
    <button onclick="filtrarPorLiga('${liga}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-emerald-600 hover:text-white transition">
      ${liga}
    </button>
  `).join('');

  containerPrincipal.parentNode.insertBefore(filtroDiv, containerPrincipal);
}

// Função global para filtrar os cards
window.filtrarPorLiga = function(ligaSelecionada) {
  if (ligaSelecionada === 'Todas') {
    renderizarPalpites(todosPalpitesGlobais);
  } else {
    const filtrados = todosPalpitesGlobais.filter(p => p.league === ligaSelecionada);
    renderizarPalpites(filtrados);
  }
}

// Renderizador isolado dos cards
function renderizarPalpites(lista) {
  const container = document.getElementById('app-container');
  
  if (!lista.length) {
    container.innerHTML = '<div class="text-center py-10 text-slate-400">Nenhum palpite para esta liga.</div>';
    return;
  }

  container.innerHTML = lista.map(p => {
    let horarioFormatado = "Hoje";
    if (p.matchDate) {
      const d = new Date(p.matchDate);
      if (!isNaN(d.getTime())) {
        horarioFormatado = d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
      }
    }

    const marketName = p.market || p.mainMarket || "Resultado Final / Gols";
    const marketOdd = p.odd || p.mainOdd || 1.85;
    const marketAnalysis = p.analysis || p.mainAnalysis || "Análise tática recente.";
    
    const criarApostaText = p.criarApostaMarket || "Criar Aposta: Dupla Chance + Gols";
    const criarApostaOddVal = p.criarApostaOdd || 1.95;
    const criarApostaDesc = p.criarApostaAnalysis || "Opção de combinada segura.";

    const playerMarketText = (p.playerBetMarket && p.playerBetMarket !== 'undefined') 
      ? p.playerBetMarket 
      : `Especiais: Atleta Principal 1+ Finalização no Alvo`;
    
    const playerOddVal = (p.playerBetOdd && !isNaN(p.playerBetOdd)) ? p.playerBetOdd : 2.10;
    const playerDesc = p.playerBetAnalysis || "Boa média de finalizações recentes.";

    return `
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-5 shadow-lg">
        <div class="flex justify-between items-center mb-3 text-xs text-slate-400">
          <span class="bg-slate-800 px-2 py-1 rounded text-emerald-400 font-semibold">${p.league || 'Futebol'}</span>
          <span>${horarioFormatado}</span>
        </div>
        <h2 class="text-lg font-bold text-white mb-4 text-center">${p.matchName}</h2>
        
        <div class="space-y-3 mb-4">
          <div class="bg-slate-800/60 p-3 rounded-lg border border-slate-700/50 flex justify-between items-center">
            <div>
              <span class="text-xs text-emerald-400 font-bold block">APOSTA PRINCIPAL (${p.confidence || 85}% Confiança)</span>
              <span class="text-sm font-medium">${marketName}</span>
              <p class="text-xs text-slate-400 mt-1">${marketAnalysis}</p>
            </div>
            <span class="text-lg font-bold text-emerald-400">@${marketOdd}</span>
          </div>

          <div class="bg-slate-800/60 p-3 rounded-lg border border-slate-700/50 flex justify-between items-center">
            <div>
              <span class="text-xs text-amber-400 font-bold block">CRIAR APOSTA (EQUIPE)</span>
              <span class="text-sm font-medium">${criarApostaText}</span>
              <p class="text-xs text-slate-400 mt-1">${criarApostaDesc}</p>
            </div>
            <span class="text-lg font-bold text-amber-400">@${criarApostaOddVal}</span>
          </div>

          <div class="bg-emerald-950/40 p-3 rounded-lg border border-emerald-800/50 flex justify-between items-center">
            <div>
              <span class="text-xs text-emerald-400 font-bold block">ESPECIAIS DE JOGADORES (PLAYER PROPS)</span>
              <span class="text-sm font-medium text-emerald-200">${playerMarketText}</span>
              <p class="text-xs text-slate-400 mt-1">${playerDesc}</p>
            </div>
            <span class="text-lg font-bold text-emerald-400">@${playerOddVal}</span>
          </div>
        </div>

        <div class="flex justify-between text-xs bg-slate-950 p-2 rounded border border-slate-800 text-slate-400 mb-4">
          <span>Bet365: <strong class="text-white">@${p.comparadorOdds?.Bet365 || (marketOdd * 1.01).toFixed(2)}</strong></span>
          <span>Betano: <strong class="text-white">@${p.comparadorOdds?.Betano || (marketOdd * 0.99).toFixed(2)}</strong></span>
          <span>Superbet: <strong class="text-white">@${p.comparadorOdds?.Superbet || (marketOdd * 1.02).toFixed(2)}</strong></span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-slate-400 bg-slate-950/50 p-3 rounded border border-slate-800/50">
          <div>⚖️ <strong class="text-slate-300">Árbitro:</strong> ${p.refereeNote || 'Arbitragem padrão'}</div>
          <div>🔥 <strong class="text-slate-300">Rivalidade:</strong> ${p.rivalryNote || 'Disputa importante'}</div>
          <div>🏥 <strong class="text-slate-300">Desfalques:</strong> ${p.injuryNote || 'Elencos disponíveis'}</div>
        </div>
      </div>
    `;
  }).join('');
}

carregarPalpites();
