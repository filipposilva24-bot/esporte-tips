// Configuração real do Firebase para o projeto FutTips
const firebaseConfig = {
  apiKey: "AIzaSyAd0jnevrRoRT5vdI_xGZuAxDLgRTCfkzY",
  authDomain: "futtips-7b09f.firebaseapp.com",
  projectId: "futtips-7b09f",
  storageBucket: "futtips-7b09f.firebasestorage.app",
  messagingSenderId: "321560814934",
  appId: "1:321560814934:web:db7d4226f712a2a7e3e2f7",
  measurementId: "G-VYP83JBLSN"
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
const bookmakerFilter = document.getElementById('bookmakerFilter');
const bankrollInput = document.getElementById('bankrollInput');
const suggestedStake = document.getElementById('suggestedStake');
const container = document.getElementById('predictionsContainer');
const matchCount = document.getElementById('matchCount');

// Inicializa o input com a data de hoje e escuta mudanças
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

// Busca palpites do Firebase filtrando pela data selecionada com fuso do Brasil
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
      if (data.matchDate) {
        const dataJogoLocal = new Date(data.matchDate).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        
        if (dataJogoLocal === dataAlvo) {
          // Se o documento não tiver uma casa definida, atribuímos uma rotação padrão entre as 3 principais para demonstração
          const casasPadrao = ["Bet365", "Betano", "Superbet"];
          const casaDefinitiva = data.bookmaker || casasPadrao[Math.abs(doc.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % casasPadrao.length];
          
          allPredictions.push({ id: doc.id, ...data, bookmaker: casaDefinitiva });
        }
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

// Popula os selects dinamicamente
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
if (bookmakerFilter) {
  bookmakerFilter.addEventListener('change', aplicarFiltros);
}

// Aplica os filtros combinados (País, Liga e Casa de Aposta)
function aplicarFiltros() {
  const paisSelecionado = countryFilter.value;
  const ligaSelecionada = leagueFilter.value;
  const casaSelecionada = bookmakerFilter ? bookmakerFilter.value : '';

  const filtrados = allPredictions.filter(p => {
    const matchPais = !paisSelecionado || p.country === paisSelecionado;
    const matchLiga = !ligaSelecionada || p.league === ligaSelecionada;
    const matchCasa = !casaSelecionada || p.bookmaker === casaSelecionada;
    return matchPais && matchLiga && matchCasa;
  });

  renderizarCards(filtrados);
}

// Renderiza os cards de palpites na tela
function renderizarCards(predictions) {
  matchCount.textContent = `${predictions.length} jogos encontrados`;

  if (predictions.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800">
        <p class="text-slate-400 text-sm font-medium">Nenhum palpite encontrado para esta casa ou filtro.</p>
        <p class="text-slate-500 text-xs mt-1">Tente selecionar outra casa de aposta ou data acima.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = predictions.map(p => {
    const horaMatch = p.matchDate ? new Date(p.matchDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
    
    // Cores personalizadas para a tag da casa de aposta
    let corCasa = "bg-amber-500/10 text-amber-400 border-amber-500/20";
    if (p.bookmaker === "Betano") corCasa = "bg-red-500/10 text-red-400 border-red-500/20";
    if (p.bookmaker === "Superbet") corCasa = "bg-purple-500/10 text-purple-400 border-purple-500/20";

    return `
      <div class="bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 flex flex-col justify-between shadow-xl transition">
        <div>
          <!-- Cabeçalho do Card -->
          <div class="flex items-center justify-between text-xs text-slate-400 mb-3">
            <span class="bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/50 font-medium text-slate-300">${p.league}</span>
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded-md border text-[10px] font-bold ${corCasa}">${p.bookmaker}</span>
              <span class="font-mono bg-slate-950 px-2 py-0.5 rounded text-amber-400 font-semibold">${horaMatch}</span>
            </div>
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
