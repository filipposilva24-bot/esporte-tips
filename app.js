let todasAsPredicoes = [];
let contadorInterval; 

const bandeirasPaises = {
  "Brazil": "⚽ Brasil", "England": "⚽ Inglaterra", "Spain": "⚽ Espanha",
  "Italy": "⚽ Itália", "Germany": "⚽ Alemanha", "France": "⚽ França",
  "Portugal": "⚽ Portugal", "Netherlands": "⚽ Holanda", "Argentina": "⚽ Argentina",
  "International": "🏆 Internacional", "World": "🌍 Mundo"
};

function obterBandeiraPais(pais) { return bandeirasPaises[pais] || `⚽ ${pais || 'Geral'}`; }

window.toggleCriarAposta = function(cardId) {
  const el = document.getElementById(`criar-aposta-${cardId}`);
  if (el) el.style.display = (el.style.display === "none" || el.style.display === "") ? "block" : "none";
};

window.tocarAudio = function(texto) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(texto);
    msg.lang = 'pt-BR';
    msg.rate = 1.1;
    window.speechSynthesis.speak(msg);
  } else {
    alert("Navegador sem suporte a áudio.");
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

    if (mercado !== 'todos') {
      const mText = (pred.market || '').toLowerCase();
      if (mercado === 'resultado' && !mText.includes('resultado') && !mText.includes('vitória') && !mText.includes('vence')) return false;
      if (mercado === 'gols' && !mText.includes('gol') && !mText.includes('over') && !mText.includes('under')) return false;
      if (mercado === 'dupla' && !mText.includes('chance dupla') && !mText.includes('empate anula')) return false;
    }

    if (data && pred.matchDate) {
      if (pred.matchDate.split('T')[0] !== data) return false;
    }
    return true;
  });

  renderizarCards(filtrados);
}

function renderizarCards(predicoes) {
  const container = document.getElementById('predictions-container');
  if (contadorInterval) clearInterval(contadorInterval);
  
  if (predicoes.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 20px;">Nenhum palpite corresponde aos filtros.</p>';
    return;
  }

  container.innerHTML = '';

  predicoes.forEach(pred => {
    const cardId = pred.id;
    const textoAudio = `Análise para ${pred.matchName}. Mercado sugerido: ${pred.market}. Cotação: ${pred.odd}. Análise tática: ${pred.analysis.replace(/"/g, '')}`;

    let statusClass = "status-pendente";
    let statusText = "⏳ Pendente";
    if (pred.status === "green") { statusClass = "status-green"; statusText = "✅ GREEN"; }
    else if (pred.status === "red") { statusClass = "status-red"; statusText = "❌ RED"; }

    const oddBase = Number(pred.odd || 1.80);
    const odd365 = pred.comparadorOdds?.Bet365 || oddBase.toFixed(2);
    const oddBetano = pred.comparadorOdds?.Betano || (oddBase * 1.01).toFixed(2);
    const oddSuperbet = pred.comparadorOdds?.Superbet || (oddBase * 0.98).toFixed(2);

    const hStr = Number(pred.homeStrength) || 75;
    const aStr = Number(pred.awayStrength) || 70;
    const totalStr = hStr + aStr;
    const hPct = Math.round((hStr / totalStr) * 100);
    const aPct = 100 - hPct;
    const teams = pred.matchName.split(' vs ');
    const homeName = teams[0] || 'Mandante';
    const awayName = teams[1] || 'Visitante';

    const cardHTML = `
      <div class="prediction-card">
        <div class="card-header">
          <div>
            <span class="league-tag">${pred.league || 'Elite'}</span>
            <span class="countdown" data-time="${pred.matchDate}">Calculando...</span>
          </div>
          <span class="status-game ${statusClass}">${statusText}</span>
        </div>

        <h3 class="match-title">
          ${pred.matchName}
          ${pred.isValueBet ? '<span class="badge-ev">🔥 +EV VALOR</span>' : ''}
          ${pred.isUnderdog ? '<span class="badge-zebra">🦓 ZEBRA</span>' : ''}
        </h3>

        <!-- BARRAS DE FORÇA -->
        <div class="strength-bar-container">
          <div class="strength-row">
            <span>🏠 ${homeName} (${hPct}%)</span>
            <span>✈️ ${awayName} (${aPct}%)</span>
          </div>
          <div class="bars-wrapper">
            <div class="bar-home" style="width: ${hPct}%;"></div>
            <div class="bar-away" style="width: ${aPct}%;"></div>
          </div>
        </div>

        <!-- NOTAS TÁTICAS ALINHADAS -->
        <div class="tactical-notes">
          <div class="tactical-note-item">⚡ <b>Rivalidade:</b> ${pred.rivalryNote || 'Regular'}</div>
          <div class="tactical-note-item">⚖️ <b>Árbitro:</b> ${pred.refereeNote || 'Padrão'}</div>
          <div class="tactical-note-item">🩺 <b>Elenco:</b> ${pred.injuryNote || 'Disponíveis'}</div>
        </div>

        <div class="main-market-box">
          <div class="market-row">
            <span class="market-name">🎯 ${pred.market}</span>
          </div>
          <p class="market-analysis">${pred.analysis}</p>
          
          <div class="actions-row">
            <button class="btn-audio" onclick="tocarAudio('${textoAudio}')">
              🔊 Ouvir Análise Tática (Podcast)
            </button>
          </div>

          <!-- COMPARADOR DE ODDS -->
          <div class="comparador-box">
            <a href="https://www.bet365.com" target="_blank" class="bookie-btn">
              Bet365 <span class="bookie-odd">@${odd365}</span>
            </a>
            <a href="https://br.betano.com" target="_blank" class="bookie-btn">
              Betano <span class="bookie-odd">@${oddBetano}</span>
            </a>
            <a href="https://superbet.com/br" target="_blank" class="bookie-btn">
              Superbet <span class="bookie-odd">@${oddSuperbet}</span>
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

// Contador Regressivo e Verificação de Término (Evita "Ao Vivo" falso)
function iniciarContadorRegressivo() {
  const elementos = document.querySelectorAll('.countdown');
  
  function atualizarTempo() {
    const agora = new Date().getTime();
    
    elementos.forEach(el => {
      const tempoJogoStr = el.getAttribute('data-time');
      if (!tempoJogoStr) { el.innerHTML = ''; return; }
      
      const tempoInicio = new Date(tempoJogoStr).getTime();
      const distancia = tempoInicio - agora;
      const duracaoPartidaMs = 2 * 60 * 60 * 1000; // 2 horas de duração média
      const tempoDecorridoDesdeFim = agora - (tempoInicio + duracaoPartidaMs);

      if (tempoDecorridoDesdeFim > 0) {
        el.innerHTML = "🏁 Encerrado";
        el.style.color = "#94a3b8";
        el.style.background = "rgba(148, 163, 184, 0.1)";
      } else if (distancia < 0) {
        el.innerHTML = "🔴 Ao Vivo";
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
