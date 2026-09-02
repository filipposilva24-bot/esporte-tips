// Configuração do Firebase para o projeto FutTips
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "futtips.firebaseapp.com",
  projectId: "futtips",
  storageBucket: "futtips.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

let allPredictions = [];

// Elementos da DOM
const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const dateFilterInput = document.getElementById('dateFilter');
const countryFilter = document.getElementById('countryFilter');
const leagueFilter = document.getElementById('leagueFilter');
const bankrollInput = document.getElementById('bankrollInput');
const suggestedStake = document.getElementById('suggestedStake');
const container = document.getElementById('predictionsContainer');
const matchCount = document.getElementById('matchCount');

// Inicializa o input com a data de hoje e escuta mudanças de data
if (dateFilterInput) {
  dateFilterInput.value = hojeStr;
  dateFilterInput.addEventListener('change', (e) => {
    carregarPalpitesPorData(e.target.value);
  });
}

// Gestão de banca em tempo real
if (bankrollInput) {
  bankrollInput.addEventListener('input', (e) => {
    const bankroll = parseFloat(e.target.value) || 0;
    const stake = bankroll * 0.02;
    suggestedStake.textContent = `R$ ${stake.toFixed(2)}`;
  });
}

// Carregamento inicial ao abrir o app
window.addEventListener('DOMContentLoaded', () => {
  carregarPalpitesPorData(hojeStr);
});

// Busca palpites do Firebase filtrando pela data selecionada
async function carregarPalpitesPorData(dataAlvo) {
  container.innerHTML = `
    <div class="col-span-full text-center py-16">
      <p class="text-slate-400 text-sm animate-pulse">Buscando análises para ${dataAlvo}...</p>
    </div>
  `;
  
  try {
    const snapshot = await db.collection('predictions').get();
    allPredictions = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      // Compara os primeiros caracteres (YYYY-MM-DD) do matchDate
      if (data.matchDate && data.matchDate.startsWith(dataAlvo)) {
        allPredictions.push({ id: doc.id, ...data });
      }
    });

    povoarFiltros(allPredictions);
    aplicarFiltros();

  } catch (error) {
    console.error("Erro ao carregar histórico:", error);
    container.innerHTML = `
      <div class="col-span-full text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800">
        <p class="text-red-400 text-sm">Erro ao carregar os dados. Verifique a conexão com o Firebase.</p>
      </div>
    `;
  }
}

// Popula os selects de países e ligas dinamicamente com base nos dados do dia
function povoarFiltros(predictions) {
  const paises = [...new Set(predictions.map(p => p.country))].filter(Boolean).sort();
  const ligas = [...new Set(predictions.map(p => p.league))].filter(Boolean).sort();

  countryFilter.innerHTML = '<option value="">🌍 Todos os Países</option>';
  paises.forEach(pais => {
    countryFilter.innerHTML += `<option value="${pais}">${pais}</option>`;
  });

  leagueFilter.innerHTML = '<option value="">🏆 Todas as Ligas</option>';
  ligas.forEach(liga => {
    leagueFilter.innerHTML += `<option value="${liga}">${liga}</option>`;
  });
}

countryFilter.addEventListener('change', aplicarFiltros);
leagueFilter.addEventListener('change', aplicarFiltros);

// Aplica os filtros de país e liga nos cards exibidos
function aplicarFiltros() {
  const paisSelecionado = countryFilter.value;
  const ligaSelecionada = leagueFilter.value;

  const filtrados = allPredictions.filter(p => {
    const matchPais = !paisSelecionado || p.country === paisSelecionado;
    const matchLiga = !ligaSelecionada || p.league === ligaSelecionada;
    return matchPais && matchLiga;
  });

  renderizarCards(filtrados);
}

// Renderiza os cards de palpites na tela
function renderizarCards(predictions) {
  matchCount.textContent = `${predictions.length} jogos encontrados`;

  if (predictions.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800">
        <p class="text-slate-400 text-sm font-medium">Nenhum palpite encontrado para esta data ou filtro.</p>
        <p class="text-slate-500 text-xs mt-1">Selecione outra data no calendário acima.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = predictions.map(p => {
    const horaMatch = p.matchDate ? new Date(p.matchDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    
    return `
      <div class="bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 flex flex-col justify-between shadow-xl transition">
        <div>
          <!-- Cabeçalho do Card -->
          <div class="flex items-center justify-between text-xs text-slate-400 mb-3">
            <span class="bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/50 font-medium text-slate-300">${p.league}</span>
            <span class="font-mono bg-slate-950 px-2.5 py-0.5 rounded text-amber-400 font-semibold">${horaMatch}</span>
          </div>

          <!-- Times -->
          <h4 class="text-base font-bold text-slate-100 mb-4">${p.matchName}</h4>

          <!-- Mercado e Odd -->
          <div class="bg-slate-950/70 border border-slate-800/60 rounded-xl p-3.5 mb-4 flex items-center justify-between">
            <div>
              <span class="text-[10px] uppercase tracking-wider text-slate-400 block font-medium">Mercado Sugerido</span>
              <span class="text-sm font-extrabold text-emerald-400">${p.market}</span>
            </div>
            <div class="text-right">
              <span class="text-[10px] uppercase tracking-wider text-slate-400 block font-medium">Odd Média</span>
              <span class="text-lg font-black text-amber-400">@${Number(p.odd).toFixed(2)}</span>
            </div>
          </div>

          <!-- Análise Tática -->
          <div class="space-y-1 mb-4">
            <span class="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
              🧠 Análise Tática:
            </span>
            <p class="text-xs text-slate-300 leading-relaxed bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
              ${p.analysis}
            </p>
          </div>
        </div>

        <!-- Rodapé do Card (Confiança) -->
        <div class="pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs">
          <span class="text-slate-400 font-medium">Confiança da IA</span>
          <span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-lg font-bold">
            ${p.confidence}%
          </span>
        </div>
      </div>
    `;
  }).join('');
}
