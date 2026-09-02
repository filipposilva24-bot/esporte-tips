import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAd0jnevrRoRT5vdI_xGZuAxDLgRTCfkzY",
    authDomain: "futtips-7b09f.firebaseapp.com",
    projectId: "futtips-7b09f",
    storageBucket: "futtips-7b09f.firebasestorage.app",
    messagingSenderId: "321560814934",
    appId: "1:321560814934:web:db7d4226f712a2a7e3e2f7",
    measurementId: "G-VYP83JBLSN"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let allPredictions = [];

// 1. Calculadora de Banca
const bankrollInput = document.getElementById('bankroll');
const stakeResult = document.getElementById('stake-result');

if (bankrollInput) {
    bankrollInput.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value) || 0;
        const recommendedStake = value * 0.02;
        stakeResult.textContent = `R$ ${recommendedStake.toFixed(2)}`;
    });
}

// Função auxiliar para verificar se o jogo é realmente hoje no Brasil
function isJogoHojeBrasil(matchDateISO) {
    if (!matchDateISO) return false;

    const options = { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' };
    const hojeBR = new Date().toLocaleDateString('pt-BR', options); 
    const dataJogoBR = new Date(matchDateISO).toLocaleDateString('pt-BR', options);

    return dataJogoBR === hojeBR;
}

// 2. Renderizar Palpites Filtrando Rigorosamente por Hoje e pelos Menus
function renderPredictions() {
    const container = document.getElementById('tips-container');
    const selectedCountry = document.getElementById('countryFilter').value;
    const selectedLeague = document.getElementById('leagueFilter').value;
    const selectedMarket = document.getElementById('marketFilter').value;

    if (!container) return;
    container.innerHTML = "";

    let filtered = allPredictions.filter(tip => {
        // Trava de fuso horário: converte UTC para Brasil antes de verificar se é hoje
        if (!isJogoHojeBrasil(tip.matchDate)) return false;

        const matchCountry = tip.country || "Internacional";
        const matchLeague = tip.league || "Geral";
        const matchMarket = tip.market || "";

        if (selectedCountry !== 'todos' && matchCountry !== selectedCountry) return false;
        if (selectedLeague !== 'todos' && matchLeague !== selectedLeague) return false;
        if (selectedMarket !== 'todos' && matchMarket !== selectedMarket) return false;

        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-500 text-center py-6">Nenhum jogo disponível para hoje com estes filtros.</p>`;
        return;
    }

    filtered.forEach(tip => {
        const card = document.createElement('div');
        card.className = "bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl hover:border-emerald-500/50 transition-all space-y-3";
        card.innerHTML = `
            <div class="flex justify-between items-center">
                <span class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 bg-slate-800 text-emerald-400 rounded-full border border-slate-700">🌍 ${tip.country || 'Mundial'} • ${tip.league || 'Futebol'}</span>
                <span class="text-emerald-400 font-bold text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Confiança: ${tip.confidence || '85'}%</span>
            </div>
            
            <h3 class="text-base font-extrabold text-white tracking-tight">${tip.matchName}</h3>
            
            <div class="bg-slate-950 p-3.5 rounded-xl border border-slate-800/80 flex justify-between items-center">
                <div>
                    <p class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Sugestão de Entrada</p>
                    <p class="text-emerald-400 font-black text-sm mt-0.5">${tip.market || 'Análise Padrão'}</p>
                </div>
                <div class="text-right">
                    <p class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Odd Média</p>
                    <p class="text-white font-black text-base mt-0.5">@${Number(tip.odd || 1.85).toFixed(2)}</p>
                </div>
            </div>

            <div class="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/50">
                <p class="text-[11px] text-slate-300 leading-relaxed">
                    <span class="text-emerald-400 font-bold">💡 Análise Técnica:</span> ${tip.analysis || 'Estatísticas favoráveis para este mercado.'}
                </p>
            </div>
        `;
        container.appendChild(card);
    });
}

// 3. Popular Dropdowns Dinamicamente considerando apenas jogos de hoje no Brasil
function populateFilters() {
    const countrySelect = document.getElementById('countryFilter');
    const jogosDeHoje = allPredictions.filter(p => isJogoHojeBrasil(p.matchDate));

    const countries = [...new Set(jogosDeHoje.map(p => p.country || "Internacional"))].sort();
    
    countrySelect.innerHTML = `<option value="todos">🌍 Todos os Países</option>`;
    countries.forEach(country => {
        countrySelect.innerHTML += `<option value="${country}">${country}</option>`;
    });

    updateLeaguesDropdown();
}

function updateLeaguesDropdown() {
    const countrySelect = document.getElementById('countryFilter').value;
    const leagueSelect = document.getElementById('leagueFilter');
    
    let availableLeagues = allPredictions.filter(p => isJogoHojeBrasil(p.matchDate));
    
    if (countrySelect !== 'todos') {
        availableLeagues = availableLeagues.filter(p => (p.country || "Internacional") === countrySelect);
    }

    const leagues = [...new Set(availableLeagues.map(p => p.league || "Geral"))].sort();

    leagueSelect.innerHTML = `<option value="todos">🏆 Todas as Ligas</option>`;
    leagues.forEach(league => {
        leagueSelect.innerHTML += `<option value="${league}">${league}</option>`;
    });
}

// 4. Carregar Dados do Firebase
async function loadPredictions() {
    const container = document.getElementById('tips-container');
    if (!container) return;
    
    try {
        const querySnapshot = await getDocs(collection(db, "predictions"));
        allPredictions = [];

        querySnapshot.forEach((doc) => {
            allPredictions.push(doc.data());
        });

        if (allPredictions.length === 0) {
            container.innerHTML = `<p class="text-xs text-slate-500 text-center py-6">Nenhum jogo sincronizado.</p>`;
            return;
        }

        populateFilters();
        renderPredictions();

    } catch (error) {
        console.error("Erro ao carregar dados do Firebase: ", error);
        container.innerHTML = `<p class="text-xs text-red-400 text-center py-6">Erro ao conectar com o banco de dados.</p>`;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadPredictions();

    document.getElementById('countryFilter').addEventListener('change', () => {
        updateLeaguesDropdown();
        renderPredictions();
    });

    document.getElementById('leagueFilter').addEventListener('change', renderPredictions);
    document.getElementById('marketFilter').addEventListener('change', renderPredictions);
});
