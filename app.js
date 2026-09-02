let todasAsPredicoes = [];
let contadorInterval; 

const bandeirasPaises = {
  "Brazil": "⚽ Brasil", "England": "⚽ Inglaterra", "Spain": "⚽ Espanha",
  "Italy": "⚽ Itália", "Germany": "⚽ Alemanha", "France": "⚽ França",
  "Portugal": "⚽ Portugal", "Netherlands": "⚽ Holanda", "Argentina": "⚽ Argentina",
  "International": "🏆 Internacional", "World": "🌍 Mundo"
};

const linksCasas = {
  "Bet365": "https://www.bet365.com",
  "Betano": "https://br.betano.com",
  "Superbet": "https://superbet.com/br"
};

function obterBandeiraPais(pais) { return bandeirasPaises[pais] || `⚽ ${pais || 'Geral'}`; }

function obterLinkCasa(nomeCasa) {
  if (!nomeCasa) return "https://www.google.com/search?q=apostas";
  if (nomeCasa.toLowerCase().includes("bet365")) return linksCasas["Bet365"];
  if (nomeCasa.toLowerCase().includes("betano")) return linksCasas["Betano"];
  if (nomeCasa.toLowerCase().includes("superbet")) return linksCasas["Superbet"];
  return "https://www.google.com/search?q=" + nomeCasa;
}

window.toggleCriarAposta = function(cardId) {
  const el = document.getElementById(`criar-aposta-${cardId}`);
  if (el) el.style.display = (el.style.display === "none" || el.style.display === "") ? "block" : "none";
};

// PODCAST IA (Síntese de Voz Nativa)
window.tocarAudio = function(texto) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel(); // Para se tiver outro tocando
    const msg = new SpeechSynthesisUtterance(texto);
    msg.lang = 'pt-BR';
    msg.rate = 1.1; // Velocidade da leitura
    window.speechSynthesis.speak(msg);
  } else {
    alert("Seu navegador não suporta reprodução de áudio nativa.");
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
    document.getElementById('filter-date').value = '';
    renderizarCards(todasAsPredicoes);

  } catch (error) {
    container.innerHTML = '<p style="text-align: center; color: #ef4444; padding: 20px;">Erro ao carregar as análises.</p>';
  }
}

function popularFiltros(predicoes) {
  const selectCountry = document.getElementById('filter-country');
  const selectLeague = document.getElementById('filter-league');
  
  const paises = [...new Set(predicoes.map(p => p.country || 'International'))].sort();
  const ligas = [...new Set(predicoes.map(p => p.league))].sort();

  selectCountry.innerHTML = '<option value="todos">🌍 Todos</option>' + paises.map(c => `<option value="${c}">${obterBandeiraPais(c)}</option>`).join('');
  selectLeague.innerHTML = '<option value="todos">🏆 Todas</option>' + ligas.map(l => `<option value="${l}">${l}</option>`).join('');
}

window.filtrarPalpites = function() {
  const pais = document.getElementById('filter-country').value;
  const liga = document.getElementById('filter-league').value;
  const odd = document.getElementById('filter-odd').value;
  const mercado = document.getElementById('filter-market').value;
  const data = document.getElementById('filter-date').value;

  const filtrados = todasAsPredicoes.filter(pred => {
    if (pais !== 'todos' && (pred.country || 'International') !== pais) return false;
    if (liga !== 'todos' && pred.league !== liga) return false;
    
    const oddPrincipal = Number(pred.odd || 0);
    if (odd === '1.50' && oddPrincipal > 1.50) return false;
    if (odd === '1.80' && oddPrincipal > 1.80) return false;
    if (odd === '2.00' && oddPrincipal > 2.00) return false;
    if (odd === 'mais' && oddPrincipal <= 2.00) return false;

    // Filtro de Tipo de Mercado
    if (mercado !== 'todos') {
      const mText = (pred.market || '').toLowerCase();
      if (mercado === 'resultado' && !mText.includes('resultado') && !mText.includes('vitória') && !mText.includes('vence') && !mText.includes('match winner')) return false;
      if (mercado === 'gols' && !mText.includes('gol') && !mText.includes('over') && !mText.includes('under') && !mText.includes('mais de') && !mText.includes('menos de')) return false;
      if (mercado === 'dupla' && !mText.includes('chance dupla') && !mText.includes('empate anula') && !mText.includes('dnb')) return false;
    }

    if (data && pred.matchDate) {
      const dataJogo = pred.matchDate.split('T')[0];
      if (dataJogo !== data) return false;
    }

    return true;
  });

  renderizarCards(filtrados);
}

function renderizarCards(predicoes) {
  const container = document.getElementById('predictions-container');
  if (contadorInterval) clearInterval(contadorInterval); // Reseta o relógio
  
  if (predicoes.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 20px;">Nenhum palpite corresponde aos filtros.</p>';
    return;
  }

  container.innerHTML = '';

  predicoes.forEach(pred => {
    const cardId = pred.id;
    const dataFormatada = pred.matchDate ? new Date(pred.matchDate).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const linkCasa = obterLinkCasa(pred.bookmaker);
    
    // Tratamento seguro do texto para o áudio
    const textoAudio = `Análise para ${pred.matchName}. Mercado sugerido: ${pred.market}. Cotação de ${pred.odd}. Justificativa tática: ${pred.analysis.replace(/"/g, '')}`;

    const cardHTML = `
      <div class="prediction-card">
        <div class="card-header">
          <div>
            <span class="league-tag">${pred.league || 'Elite'}</span>
            <span class="countdown" data-time="${pred.matchDate}">Calculando...</span>
          </div>
          <span class="bookmaker-tag">${pred.bookmaker || 'Bet365'}</span>
        </div>

        <h3 class="match-title">${pred.matchName}</h3>

        <div class="main-market-box">
          <div class="market-row">
            <span class="market-name">🎯 ${pred.market}</span>
            <span class="market-odd">@${pred.odd ? Number(pred.odd).toFixed(2) : '1.80'}</span>
          </div>
          <p class="market-analysis">${pred.analysis}</p>
          
          <!-- BOTÕES: ÁUDIO E LINK RÁPIDO -->
          <div class="actions-row">
            <button class="btn-audio" onclick="tocarAudio('${textoAudio}')">
              🔊 Ouvir Análise
            </button>
            <a href="${linkCasa}" target="_blank" class="btn-bet">
              🚀 Apostar na ${pred.bookmaker || 'Casa'}
            </a>
          </div>
        </div>

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
           <span style="font-size: 0.8rem; color: #94a3b8;">${obterBandeiraPais(pred.country)}</span>
           <span>Confiança da IA: <span class="confidence-badge">${pred.confidence || 88}%</span></span>
        </div>
      </div>
    `;
    container.innerHTML += cardHTML;
  });

  iniciarContadorRegressivo();
}

// Lógica do Contador Regressivo em Tempo Real
function iniciarContadorRegressivo() {
  const elementos = document.querySelectorAll('.countdown');
  
  function atualizarTempo() {
    const agora = new Date().getTime();
    
    elementos.forEach(el => {
      const tempoJogoStr = el.getAttribute('data-time');
      if (!tempoJogoStr) { el.innerHTML = ''; return; }
      
      const tempoJogo = new Date(tempoJogoStr).getTime();
      const distancia = tempoJogo - agora;

      if (distancia < 0) {
        el.innerHTML = "🔴 Ao Vivo / Encerrado";
        el.style.color = "#f87171";
        el.style.background = "rgba(248, 113, 113, 0.1)";
      } else {
        const h = Math.floor((distancia % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((distancia % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((distancia % (1000 * 60)) / 1000);
        el.innerHTML = `⏳ Em ${h}h ${m}m ${s}s`;
      }
    });
  }
  
  atualizarTempo();
  contadorInterval = setInterval(atualizarTempo, 1000);
}

document.addEventListener('DOMContentLoaded', () => { carregarPalpites(); });
