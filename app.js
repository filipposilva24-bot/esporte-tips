// Exemplo de como estruturar o card dentro do seu loop de exibição no app.js
predictions.forEach(pred => {
  const cardId = pred.id || Math.random().toString(36).substring(7);
  
  // Verifica se o Criar Aposta existe nos dados vindos do Firebase
  const temCriarAposta = pred.criarApostaMarket ? true : false;

  const cardHTML = `
    <div class="prediction-card" style="background: #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 16px; color: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      
      <!-- Cabeçalho do Jogo e Tag da Casa -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span style="font-size: 0.85rem; color: #94a3b8; background: #0f172a; padding: 4px 8px; border-radius: 4px;">${pred.league}</span>
        <span style="font-size: 0.85rem; font-weight: bold; background: #059669; padding: 2px 8px; border-radius: 4px;">${pred.bookmaker || 'Bet365'}</span>
      </div>

      <h3 style="font-size: 1.1rem; margin-bottom: 12px; font-weight: bold;">${pred.matchName}</h3>

      <!-- APOSTA PRINCIPAL (O Padrão Antigo) -->
      <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="color: #38bdf8; font-weight: bold; font-size: 0.95rem;">🎯 Principal: ${pred.market}</span>
          <span style="color: #f59e0b; font-weight: bold; font-size: 1.1rem;">@${pred.odd}</span>
        </div>
        <p style="font-size: 0.9rem; color: #cbd5e1; line-height: 1.4;">${pred.analysis}</p>
      </div>

      <!-- SEGUNDA OPÇÃO: BOTÃO CRIAR APOSTA (ATÉ 2.00) -->
      ${temCriarAposta ? `
        <div style="border-top: 1px dashed rgba(255,255,255,0.15); padding-top: 10px; margin-top: 10px;">
          <button onclick="toggleCriarAposta('${cardId}')" style="width: 100%; background: #2563eb; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 6px; font-size: 0.9rem;">
            ⚡ Sugestão de Criar Aposta (Até 2.00)
          </button>
          
          <div id="criar-aposta-${cardId}" style="display: none; margin-top: 8px; background: rgba(37, 99, 235, 0.1); padding: 10px; border-radius: 8px; border: 1px solid rgba(37, 99, 235, 0.3);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="color: #60a5fa; font-weight: bold; font-size: 0.9rem;">${pred.criarApostaMarket}</span>
              <span style="color: #f59e0b; font-weight: bold; font-size: 1rem;">@${pred.criarApostaOdd}</span>
            </div>
            <p style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.3;">${pred.criarApostaAnalysis}</p>
          </div>
        </div>
      ` : ''}

      <!-- Confiança da IA -->
      <div style="margin-top: 10px; text-align: right; font-size: 0.8rem; color: #94a3b8;">
        Confiança da IA: <strong style="color: #10b981;">${pred.confidence}%</strong>
      </div>

    </div>
  `;
  
  document.getElementById('predictions-container').innerHTML += cardHTML;
});
