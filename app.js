let todosPalpitesGlobais = [];
let ligaSelecionadaAtual = 'Todas';
let dataSelecionadaAtual = 'Todas';

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
    renderizarFiltros();
    aplicarFiltros();
  } catch (err) {
    container.innerHTML = '<div class="text-center py-10 text-red-400">Erro ao carregar os dados dos palpites.</div>';
  }
}

// Cria os painéis de filtro de Ligas e Datas dinamicamente
function renderizarFiltros() {
  if (document.getElementById('painel-filtros')) return;

  const containerPrincipal = document.getElementById('app-container');
  
  const ligas = ['Todas', ...new Set(todosPalpitesGlobais.map(p => p.league).filter(Boolean))];
  
  // Extrai as datas únicas dos palpites salvos no Firebase (formato YYYY-MM-DD)
  const datas = ['Todas', ...new Set(todosPalpitesGlobais.map(p => {
    if (!p.matchDate) return null;
    return p.matchDate.split('T')[0];
  }).filter(Boolean))].sort().reverse(); // Da data mais recente para a mais antiga

  const filtroWrapper = document.createElement('div');
  filtroWrapper.id = 'painel-filtros';
  filtroWrapper.className = 'mb-6 space-y-3 bg-slate-900/80 p-4 rounded-xl border border-slate-800';

  filtroWrapper.innerHTML = `
    <div>
      <span class="text-xs font-semibold text-slate-400 block mb-1.5">Filtrar por Liga:</span>
      <div id="filtro-ligas" class="flex flex-wrap gap-2">
        ${ligas.map(liga => `
          <button onclick="mudarFiltroLiga('${liga}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition ${liga === 'Todas' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">
            ${liga}
          </button>
        `).join('')}
      </div>
    </div>
    <div>
      <span class="text-xs font-semibold text-slate-400 block mb-1.5">Filtrar por Data:</span>
      <div id="filtro-datas" class="flex flex-wrap gap-2">
        ${datas.map(data => {
          let label = data === 'Todas' ? 'Todas as Datas' : new Date(data + 'T00:00:00').toLocaleDateString('pt-BR');
          return `
            <button onclick="mudarFiltroData('${data}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition ${data === 'Todas' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">
              ${label}
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;

  containerPrincipal.parentNode.insertBefore(filtroWrapper, containerPrincipal);
}

window.mudarFiltroLiga = function(liga) {
  ligaSelecionadaAtual = liga;
  atualizarEstilosBotoes('filtro-ligas', liga);
  aplicarFiltros();
}

window.mudarFiltroData = function(data) {
  dataSelecionadaAtual = data;
  atualizarEstilosBotoes('filtro-datas', data);
  aplicarFiltros();
}

function atualizarEstilosBotoes(containerId, valorAtivo) {
  const container = document.getElementById(containerId);
  if (!container) return;
  Array.from(container.children).forEach(btn => {
    const textoBtn = btn.getAttribute('onclick');
    if (textoBtn.includes(`'${valorAtivo}'`)) {
      btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-emerald-600 text-white';
    } else {
      btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-slate-800 text-slate-300 hover:bg-slate-700';
    }
  });
}

function aplicarFiltros() {
  let filtrados = todosPalpitesGlobais;

  if (ligaSelecionadaAtual !== 'Todas') {
    filtrados = filtrados.filter(p => p.league === ligaSelecionadaAtual);
  }

  if (dataSelecionadaAtual !== 'Todas') {
    filtrados = filtrados.filter(p => p.matchDate && p.matchDate.startsWith(dataSelecionadaAtual));
  }

  renderizarPalpites(filtrados);
}

// Renderizador isolado dos cards
function renderizarPalpites(lista) {
  const container = document.getElementById('app-container');
  
  if (!lista.length) {
    container.innerHTML = '<div class="text-center py-10 text-slate-400">Nenhum palpite encontrado para esta seleção.</div>';
    return;
  }

  container.innerHTML = lista.map(p => {
    let horarioFormatado = "Hoje";
    if (p.matchDate) {
      const d = new Date(p.matchDate);
      if (!isNaN(d.getTime())) {
        horarioFormatado = d.toLocaleDateString('pt-BR', {day: '2-digit', month:'2-digit'}) + ' às ' + d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
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
