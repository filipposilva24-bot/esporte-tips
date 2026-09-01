// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAd0jnevrRoRT5vdI_xGZuAxDLgRTCfkzY",
    authDomain: "futtips-7b09f.firebaseapp.com",
    projectId: "futtips-7b09f",
    storageBucket: "futtips-7b09f.firebasestorage.app",
    messagingSenderId: "321560814934",
    appId: "1:321560814934:web:db7d4226f712a2a7e3e2f7",
    measurementId: "G-VYP83JBLSN"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 1. Calculadora de Banca em Tempo Real
const bankrollInput = document.getElementById('bankroll');
const stakeResult = document.getElementById('stake-result');

if (bankrollInput) {
    bankrollInput.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value) || 0;
        const recommendedStake = value * 0.02; // Padrão de 2% da banca
        stakeResult.textContent = `R$ ${recommendedStake.toFixed(2)}`;
    });
}

// 2. Carregar Palpites do Firebase Firestore
async function loadPredictions() {
    const container = document.getElementById('tips-container');
    if (!container) return;
    
    try {
        const querySnapshot = await getDocs(collection(db, "predictions"));
        container.innerHTML = "";
        
        if (querySnapshot.empty) {
            container.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">Nenhum jogo sincronizado para hoje. Aguarde a atualização automática.</p>`;
            return;
        }

        querySnapshot.forEach((doc) => {
            const tip = doc.data();
            const card = document.createElement('div');
            card.className = "bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg hover:border-emerald-500/40 transition-all";
            card.innerHTML = `
                <div class="flex justify-between items-center mb-2">
                    <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-slate-800 text-slate-300 rounded">${tip.league || 'Futebol'}</span>
                    <span class="text-emerald-400 font-bold text-xs">Confiança: ${tip.confidence || '80'}%</span>
                </div>
                <h3 class="text-base font-bold text-white mb-1">${tip.matchName}</h3>
                <div class="bg-slate-950 p-3 rounded-xl border border-slate-800/80 mt-3 flex justify-between items-center">
                    <div>
                        <p class="text-[11px] text-slate-400">Sugestão de Entrada</p>
                        <p class="text-emerald-400 font-bold text-sm">${tip.market || 'Analítica'}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-[11px] text-slate-400">Odd Média</p>
                        <p class="text-white font-extrabold text-base">@${Number(tip.odd || 1.85).toFixed(2)}</p>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (error) {
        console.error("Erro ao carregar dados do Firebase: ", error);
        container.innerHTML = `<p class="text-xs text-red-400 text-center py-4">Erro ao conectar com o banco de dados.</p>`;
    }
}

// Executa ao carregar a página
loadPredictions();