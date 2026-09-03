async function carregarPalpites() {
  const container = document.getElementById('app-container');
  try {
    const res = await fetch('/api/palpites');
    const data = await res.json();
    if (!data.success || !data.predictions.length) {
      container.innerHTML = '<div class="text-center py-10 text-slate-400">Nenhum palpite encontrado no momento.</div>';
      return;
    }

    container.innerHTML = data.predictions.map(p => {
      let horarioFormatado = "Ao vivo / Hoje";
      if (p.matchDate) {
        const d = new Date(p.matchDate);
        if (!isNaN(d.getTime())) {
          horarioFormatado = d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
        }
      }

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
                <span class="text-sm font-medium">${p.market}</span>
                <p class="text-xs text-slate-400 mt-1">${p.analysis}</p>
              </div>
              <span class="text-lg font-bold text-emerald-400">@${p.odd}</span>
            </div>

            <div class="bg-slate-800/60 p-3 rounded-lg border border-slate-700/50 flex justify-between items-center">
              <div>
                <span class="text-xs text-amber-400 font-bold block">CRIAR APOSTA (EQUIPE)</span>
                <span class="text-sm font-medium">${p.criarApostaMarket}</span>
                <p class="text-xs text-slate-400 mt-1">${p.criarApostaAnalysis}</p>
              </div>
              <span class="text-lg font-bold text-amber-400">@${p.criarApostaOdd}</span>
            </div>

            <div class="bg-emerald-950/40 p-3 rounded-lg border border-emerald-800/50 flex justify-between items-center">
              <div>
                <span class="text-xs text-emerald-400 font-bold block">ESPECIAIS DE JOGADORES (PLAYER PROPS)</span>
                <span class="text-sm font-medium text-emerald-200">${p.playerBetMarket}</span>
                <p class="text-xs text-slate-400 mt-1">${p.playerBetAnalysis}</p>
              </div>
              <span class="text-lg font-bold text-emerald-400">@${p.playerBetOdd}</span>
            </div>
          </div>

          <div class="flex justify-between text-xs bg-slate-950 p-2 rounded border border-slate-800 text-slate-400 mb-4">
            <span>Bet365: <strong class="text-white">@${p.comparadorOdds?.Bet365 || p.odd}</strong></span>
            <span>Betano: <strong class="text-white">@${p.comparadorOdds?.Betano || p.odd}</strong></span>
            <span>Superbet: <strong class="text-white">@${p.comparadorOdds?.Superbet || p.odd}</strong></span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-slate-400 bg-slate-950/50 p-3 rounded border border-slate-800/50">
            <div>⚖️ <strong class="text-slate-300">Árbitro:</strong> ${p.refereeNote || 'Padrão'}</div>
            <div>🔥 <strong class="text-slate-300">Rivalidade:</strong> ${p.rivalryNote || 'Importante'}</div>
            <div>🏥 <strong class="text-slate-300">Desfalques:</strong> ${p.injuryNote || 'Elencos completos'}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div class="text-center py-10 text-red-400">Erro ao carregar os dados dos palpites.</div>';
  }
}
carregarPalpites();
