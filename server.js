// 1. Importar as ferramentas
import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Boilerplate para __dirname em ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- FUNÇÕES AUXILIARES DE RENDERIZAÇÃO ---

function formatDate(dateString) {
  if (!dateString) return 'Não informado';
  try {
    const date = new Date(dateString + 'T00:00:00');
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('pt-BR');
  } catch (e) {
    return dateString;
  }
}

function getHeirNameById(heirId, allHeirs) {
  const findHeir = (heirs) => {
    for (const heir of heirs) {
      if (heir.id === heirId) return heir.nome;
      if (heir.representantes && heir.representantes.length > 0) {
        const found = findHeir(heir.representantes);
        if (found) return found;
      }
    }
    return null;
  };
  return findHeir(allHeirs) || 'Herdeiro não encontrado';
}

function generateHeirsHtml(heirs, level = 0) {
  if (!heirs || heirs.length === 0) return '';
  return heirs.map(h => `
    <div class="preview-card" style="margin-left: ${level * 20}px;">
      <p><strong>${h.isMeeiro ? 'Meeiro(a):' : (level > 0 ? 'Representante:' : 'Herdeiro(a):')}</strong><span>${h.nome || 'Não informado'} ${h.parentesco ? `(${h.parentesco})` : ''}</span></p>
      <p><strong>Condição:</strong> <span>${h.estado || 'Não informado'}</span></p>
      <p><strong>Documentos Pessoais:</strong> <span>${h.documentos || 'Não informado'}</span></p>
      ${h.idProcuracao ? `<div class="info-procuracao"><p><strong>Procuração (ID):</strong> <span>${h.idProcuracao}</span></p></div>` : ''}
      ${h.estado === 'Incapaz' ? `<div class="preview-sub-card warning"><p><strong>Curador(a):</strong> <span>${h.curador.nome || 'Não informado'}</span></p><p><strong>Termo de Curador (ID):</strong> <span>${h.curador.idTermo || 'Não informado'}</span></p></div>` : ''}
      ${(h.estadoCivil === 'Casado(a)' || h.estadoCivil === 'União Estável') ? `<div class="preview-sub-card spouse"><p><strong>Cônjuge/Comp.:</strong> <span>${h.conjuge.nome || 'Não informado'}</span></p><p><strong>Regime de Bens:</strong> <span>${h.conjuge.regimeDeBens || 'Não informado'}</span></p></div>` : ''}
      ${(h.estado === 'Falecido' && h.representantes && h.representantes.length > 0) ? `<div class="preview-sub-card danger"><p><strong>Certidão de Óbito (ID):</strong> <span>${h.idCertidaoObito || 'Não informado'}</span></p><p><strong>Sucessão de Herdeiro Falecido:</strong></p>${generateHeirsHtml(h.representantes, level + 1)}</div>` : ''}
    </div>
  `).join('');
}

function getEditalStatus(edital) {
    if (edital.determinado === 'Não') return 'Não determinada a expedição.';
    if (edital.status === 'Não Expedido') return 'Expedição pendente.';
    if (edital.prazoDecorrido === 'Não') return `Expedido (ID: ${edital.id || 'N/A'}), aguardando decurso de prazo.`;
    return `Expedido (ID: ${edital.id || 'N/A'}), prazo decorrido (ID: ${edital.idDecursoPrazo || 'N/A'}).`;
}

function getCustasStatus(custas) {
    if (custas.situacao === 'Isenção') return 'Isento de custas.';
    if (custas.situacao === 'Ao final') return 'Custas a serem pagas ao final do processo.';
    if (custas.situacao === 'Devidas') {
        const calculo = custas.calculada === 'Sim' ? `Calculada (ID: ${custas.idCalculo || 'N/A'})` : 'Cálculo pendente';
        const pagamento = custas.paga === 'Sim' ? `Pagas (ID: ${custas.idPagamento || 'N/A'})` : 'Pagamento pendente';
        return `${calculo}, ${pagamento}.`;
    }
    return 'Situação não informada.';
}

// --- SERVIDOR EXPRESS ---
const app = express();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de PDF ouvindo na porta ${PORT}`);
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

app.post('/generate-pdf', async (req, res) => {
  console.log('Recebi um pedido para gerar um PDF! Montando o HTML completo...');

  try {
    const { state: data, bensSections, pendencies } = req.body; // Recebemos o state, bensSections e as pendências
    const cssPath = path.join(__dirname, '../src/assets/main.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    const htmlContent = `
      <html>
        <head><style>${css}</style></head>
        <body>
          <div id="preview-panel" class="preview-panel">
            <div class="preview-header">
              <div class="header-text">
                <p>PODER JUDICIÁRIO DO ESTADO DE MINAS GERAIS</p>
                <p class="comarca">VARA ÚNICA DA COMARCA DE NOVA RESENDE/MG</p>
              </div>
              <h1>CERTIDÃO DE REGULARIDADE</h1>
            </div>
            <div class="preview-content">
              
              <!-- Seção de Pendências -->
              ${pendencies && pendencies.length > 0 ? `
                <div class="preview-section pendencies-section">
                  <h3><i data-lucide="alert-triangle"></i> PENDÊNCIAS</h3>
                  <div class="preview-card">
                    <ul class="pendencies-list">
                      ${pendencies.map(p => `<li>${p}</li>`).join('')}
                    </ul>
                  </div>
                </div>
              ` : ''}

              <!-- Seção 1: Dados do Processo -->
              ${data.processo.numero ? `
                <div class="preview-section">
                  <h3>1. Dados do Processo</h3>
                  <div class="preview-card">
                    <p><strong>Número do Processo:</strong><span>${data.processo.numero}</span></p>
                    ${data.processo.cumulativo ? `<p><strong>Tipo:</strong><span>Inventário Cumulativo</span></p>` : ''}
                  </div>
                </div>
              ` : ''}

              <!-- Seção 2: Falecidos -->
              ${data.falecidos.length > 0 ? `
                <div class="preview-section">
                  <h3>2. De Cujus (Falecido/a/s)</h3>
                  ${data.falecidos.map(f => `
                    <div class="preview-card">
                      <p><strong>Nome:</strong><span>${f.nome || 'Não informado'}</span></p>
                      <p><strong>Data do Falecimento:</strong><span>${formatDate(f.dataFalecimento)}</span></p>
                      <p><strong>Certidão de Óbito (ID):</strong><span>${f.idCertidaoObito || 'Não informado'}</span></p>
                    </div>
                  `).join('')}
                </div>
              ` : ''}

              <!-- Seção 3: Inventariante -->
              ${data.inventariante.nome ? `
                <div class="preview-section">
                  <h3>3. Inventariante</h3>
                  <div class="preview-card">
                    <p><strong>Nome:</strong><span>${data.inventariante.nome}</span></p>
                    <p><strong>Parentesco:</strong><span>${data.inventariante.parentesco || 'Não informado'}</span></p>
                    <p><strong>Termo de Compromisso (ID):</strong><span>${data.inventariante.idTermoCompromisso || 'Não informado'}</span></p>
                    ${data.inventariante.idProcuracao ? `<div class="info-procuracao"><p><strong>Procuração (ID):</strong><span>${data.inventariante.idProcuracao}</span></p></div>` : ''}
                  </div>
                </div>
              ` : ''}
              
              <!-- Seção 4: Herdeiros -->
              ${data.herdeiros && data.herdeiros.length > 0 ? `
                <div class="preview-section">
                  <h3>4. Herdeiros e Sucessores</h3>
                  ${generateHeirsHtml(data.herdeiros)}
                </div>
              ` : ''}
              
              <!-- Seção de Renúncia -->
              ${data.renuncia.houveRenuncia && data.renuncia.renunciantes.length > 0 ? `
                <div class="preview-section">
                  <h3>Renúncia de Direitos</h3>
                  ${data.renuncia.renunciantes.map(r => `
                    <div class="preview-card">
                      <p><strong>Renunciante:</strong><span>${getHeirNameById(r.herdeiroId, data.herdeiros)}</span></p>
                      <p><strong>Tipo de Renúncia:</strong><span>${r.tipo}</span></p>
                      <p><strong>ID da Escritura/Termo:</strong><span>${r.idEscritura || 'Não informado'}</span></p>
                    </div>
                  `).join('')}
                </div>
              ` : ''}

              <!-- Seção de Cessão -->
              ${data.cessao.houveCessao && data.cessao.cessionarios.length > 0 ? `
                <div class="preview-section">
                  <h3>Cessão de Direitos</h3>
                  <div class="preview-card">
                    <p><strong>Escritura de Cessão (ID):</strong><span>${data.cessao.idEscritura || 'Não informado'}</span></p>
                    ${data.cessao.cessionarios.map(c => `
                      <div class="preview-sub-card">
                        <p><strong>Cessionário:</strong><span>${c.nome || 'Não informado'}</span></p>
                        <p><strong>Documentos:</strong><span>${c.documentos || 'Não informado'}</span></p>
                        ${c.idProcuracao ? `<div class="info-procuracao"><p><strong>Procuração (ID):</strong><span>${c.idProcuracao}</span></p></div>` : ''}
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              
              <!-- Seção 5: Bens -->
              ${Object.values(data.bens).some(arr => Array.isArray(arr) && arr.length > 0) ? `
                <div class="preview-section">
                  <h3>5. Relação de Bens, Direitos e Dívidas</h3>
                  ${bensSections.map(section => {
                    if (data.bens[section.key] && data.bens[section.key].length > 0) {
                      return `
                        <h4>${section.title}</h4>
                        ${data.bens[section.key].map(item => `
                          <div class="preview-card-small">
                            ${section.fields.map(field => `
                              <p><strong>${field.label}:</strong> <span>${item[field.model] || 'N/A'}</span></p>
                            `).join('')}
                          </div>
                        `).join('')}
                      `;
                    }
                    return '';
                  }).join('')}
                </div>
              ` : ''}

              <!-- Seção 6: Documentos Processuais -->
              <div class="preview-section">
                  <h3>6. Documentos Processuais</h3>
                  <div class="preview-card">
                      <p><strong>Primeiras Declarações:</strong> <span>${data.documentosProcessuais.primeirasDeclaracoes.status === 'Apresentada' ? `Apresentada (ID: ${data.documentosProcessuais.primeirasDeclaracoes.id || 'N/A'})` : 'Não Apresentada'}</span></p>
                      <p><strong>Edital:</strong> <span>${getEditalStatus(data.documentosProcessuais.edital)}</span></p>
                      <p><strong>Últimas Declarações:</strong> <span>${data.documentosProcessuais.ultimasDeclaracoes.status === 'Apresentada' ? `Apresentada (ID: ${data.documentosProcessuais.ultimasDeclaracoes.id || 'N/A'})` : 'Não Apresentada'}</span></p>
                      ${data.documentosProcessuais.testamentosCensec.map(item => `
                        <p>
                          <strong>${item.deixouTestamento ? `Testamento (${item.nomeFalecido})` : `Certidão CENSEC (${item.nomeFalecido})`}:</strong> 
                          <span>${item.id ? `Apresentado (ID: ${item.id})` : 'Pendente'}</span>
                        </p>
                      `).join('')}
                      <p><strong>Sentença:</strong> <span>${data.documentosProcessuais.sentenca.status === 'Proferida' ? `Proferida (ID: ${data.documentosProcessuais.sentenca.id || 'N/A'})` : 'Não Proferida'}</span></p>
                      <p><strong>Trânsito em Julgado:</strong> <span>${data.documentosProcessuais.transito.status === 'Ocorrido' ? `Ocorrido (ID: ${data.documentosProcessuais.transito.id || 'N/A'})` : 'Não Ocorrido'}</span></p>
                  </div>
              </div>

              <!-- Seção 7: Regularidade Tributária e Custas -->
              <div class="preview-section">
                  <h3>7. Regularidade Tributária e Custas</h3>
                  ${data.documentacaoTributaria.map(trib => `
                    <div class="preview-card">
                      <p><strong>Referente a:</strong><span>${trib.nomeFalecido}</span></p>
                      <p><strong>Status ITCD:</strong><span>${trib.statusItcd}</span></p>
                      <p><strong>CND Municipal:</strong><span>${trib.cndMunicipal.status === 'Juntada' ? `Juntada (ID: ${trib.cndMunicipal.id || 'N/A'})` : 'Não Juntada'}</span></p>
                      <p><strong>CND Estadual:</strong><span>${trib.cndEstadual.status === 'Juntada' ? `Juntada (ID: ${trib.cndEstadual.id || 'N/A'})` : 'Não Juntada'}</span></p>
                      <p><strong>CND Federal:</strong><span>${trib.cndFederal.status === 'Juntada' ? `Juntada (ID: ${trib.cndFederal.id || 'N/A'})` : 'Não Juntada'}</span></p>
                    </div>
                  `).join('')}
                  <div class="preview-card">
                       <p><strong>Custas Processuais:</strong><span>${getCustasStatus(data.custas)}</span></p>
                   </div>
              </div>

              <!-- Seção 8: Observações -->
              ${data.observacoes.length > 0 ? `
                <div class="preview-section">
                  <h3>8. Observações Adicionais</h3>
                  ${data.observacoes.map(obs => `
                    <div class="preview-card">
                      <p><strong>${obs.titulo || 'Observação'} (Relevância: ${obs.relevancia})</strong></p>
                      <p class="obs-content"><span>${obs.conteudo}</span></p>
                    </div>
                  `).join('')}
                </div>
              ` : ''}

            </div>
            <div class="preview-footer">
                <div class="signature-area">
                    <div class="signature-line">
                        <p class="signature-name">${data.processo.responsavel.nome || '_________________________________________'}</p>
                        <p class="signature-title">${data.processo.responsavel.cargo || 'Cargo do Responsável'}</p>
                    </div>
                </div>
                <div class="footer-info">
                    <p>Este documento foi gerado eletronicamente pelo Sistema de Gerenciamento de Certidões.</p>
                    <p>Data de Emissão: ${new Date().toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric'})}</p>
                </div>
            </div>
          </div>
        </body>
      </html>
    `;
    
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' } });
    await browser.close();
    
    res.contentType('application/pdf');
    res.send(pdfBuffer);
    
    console.log('PDF Final gerado e enviado com sucesso!');

  } catch (error) {
    console.error('Ocorreu um erro ao gerar o PDF:', error);
    res.status(500).send({ message: 'Erro ao gerar o PDF.', error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor de PDF ouvindo na porta ${port}`);
});
