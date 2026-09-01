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

// 1. Calculadora de Banca Avançada
const bankrollInput = document.getElementById('bankroll');
const stakeResult = document.getElementById('stake-result');

if (bankrollInput) {
    bankrollInput.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value) || 0;
        const recommendedStake = value * 0.02; // Gestão profissional de 2%
        stakeResult.textContent = `R$ ${recommendedStake.toFixed(2)}`;
    });
}

// 2. Carregar Palpites com Análise Técnica no Feed
async function loadPredictions(selectedMarket = 'todos') {
    const container = document.getElementById('tips-container');
    if (!container) return;
    
    try {
        const querySnapshot = await getDocs(collection(db, "predictions"));
        container.innerHTML = "";
        
        let count = 0;

        querySnapshot.forEach((doc) => {
            const tip = doc.data();
            
            if (selectedMarket !== 'todos' && tip.market !== selectedMarket) {
                return;
            }

            count++;
            const card = document.createElement('div');
            card.className = "bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl hover:border-emerald-500/50 transition-all space-y-3";
            card.innerHTML = `
                <div class="flex justify-between items-center">
                    <span class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 bg-slate-800 text-emerald-400 rounded-full border border-slate-700">${tip.league || 'Futebol'}</span>
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

                <!-- Bloco de Análise Técnica / Justificativa do Especialista -->
                <div class="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/50">
                    <p class="text-[11px] text-slate-300 leading-relaxed">
                        <span class="text-emerald-400 font-bold">💡 Análise Técnica:</span> ${tip.analysis || 'Estatísticas favoráveis para este mercado com base no momento atual das equipes.'}
                    </p>
                </div>
            `;
            container.appendChild(card);
        });

        if (count === 0) {
            container.innerHTML = `<p class="text-xs text-slate-500 text-center py-6">Nenhum palpite encontrado para este filtro específico hoje.</p>`;
        }

    } catch (error) {
        console.error("Erro ao carregar dados do Firebase: ", error);
        container.innerHTML = `<p class="text-xs text-red-400 text-center py-6">Erro ao conectar com o banco de dados.</p>`;
    }
}

// 3. Inicialização e Evento do Filtro
document.addEventListener("DOMContentLoaded", () => {
    const marketFilter = document.getElementById('marketFilter');
    
    if (marketFilter) {
        marketFilter.addEventListener('change', (e) => {
            loadPredictions(e.target.value);
        });
    }
    
    loadPredictions("todos");
});
