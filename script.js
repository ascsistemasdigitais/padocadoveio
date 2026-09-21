// ==========================================================
// 1. IMPORTAÇÕES DO FIREBASE
// ==========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ==========================================================
// 2. CONFIGURAÇÃO (SUBSTITUA PELAS SUAS CHAVES REAIS)
// ==========================================================
const firebaseConfig = {
  apiKey: "SUA_API_KEY_AQUI",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO",
  storageBucket: "SEU_PROJETO.appspot.com",
  messagingSenderId: "SEU_MESSAGING_ID",
  appId: "SEU_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ==========================================================
// 3. ESTADO GLOBAL DO SISTEMA
// ==========================================================
let currentUser = null;
let isAdmin = false;
let produtos = [];
let fornecedores = [];
let vendas = [];
let entradas = [];
let movEstoque = [];
let auditoria = [];
let caixaAtual = null;
let currentPay = "Dinheiro";
let cart = [];
let unsubscribes = [];

// ==========================================================
// 4. AUTENTICAÇÃO E PERMISSÕES
// ==========================================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const userDoc = await getDoc(doc(db, "usuarios", user.uid));
      if (userDoc.exists()) {
        currentUser = { uid: user.uid, ...userDoc.data() };
        isAdmin = currentUser.role === 'admin';
        aplicarPermissoes();
        iniciarSincronizacaoEmTempoReal();
      } else {
        alert("Erro: Usuário não encontrado no banco de dados.");
        await signOut(auth);
        window.location.href = 'login.html';
      }
    } catch (error) {
      console.error("Erro ao buscar usuário:", error);
      window.location.href = 'login.html';
    }
  } else {
    window.location.href = 'login.html';
  }
});

function sair() {
  unsubscribes.forEach(unsub => unsub()); // Para de ouvir o banco
  signOut(auth).then(() => { window.location.href = 'login.html'; });
}

function aplicarPermissoes() {
  const ui = document.getElementById('user-info');
  if (ui) ui.innerHTML = `<div class="user-info-box"><div class="nome">${currentUser.nome}</div><div class="role">${isAdmin ? 'Administrador' : 'Operador de Caixa'}</div></div>`;
  set('sb-user', currentUser.nome.toUpperCase());
  set('sb-grupo', isAdmin ? 'ADMINISTRADOR' : 'OPERADOR DE CAIXA');

  if (!isAdmin) {
    document.querySelectorAll('.nav-item.admin-only, .page.admin-only').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const b = document.querySelector('.nav-item[data-page="pdv"]'); if (b) b.classList.add('active');
    const p = document.getElementById('page-pdv'); if (p) { p.classList.add('active'); p.style.display = 'block'; }
  } else {
    const b = document.querySelector('.nav-item[data-page="dashboard"]'); if (b) b.classList.add('active');
    const p = document.getElementById('page-dashboard'); if (p) p.classList.add('active');
  }
}

// ==========================================================
// 5. SINCRONIZAÇÃO EM TEMPO REAL (FIRESTORE)
// ==========================================================
function iniciarSincronizacaoEmTempoReal() {
  const qProd = query(collection(db, "produtos"), orderBy("descricao", "asc"));
  unsubscribes.push(onSnapshot(qProd, (snap) => {
    produtos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (document.getElementById('page-produtos')?.classList.contains('active')) renderProdutos();
    if (document.getElementById('page-pdv')?.classList.contains('active')) { fillProdutoSelects(); renderBuscaDropdown(); }
  }));

  const qForn = query(collection(db, "fornecedores"), orderBy("razao", "asc"));
  unsubscribes.push(onSnapshot(qForn, (snap) => {
    fornecedores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (document.getElementById('page-fornecedores')?.classList.contains('active')) renderFornecedores();
    fillFornecedorSelects();
  }));

  const qVendas = query(collection(db, "vendas"), orderBy("dataHora", "desc"));
  unsubscribes.push(onSnapshot(qVendas, (snap) => {
    vendas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboard();
    if (document.getElementById('page-relatorio-vendas')?.classList.contains('active')) renderRelatorioVendas();
  }));
  
  refreshAll();
}

// ==========================================================
// 6. FUNÇÕES DE BANCO DE DADOS (CRUD)
// ==========================================================
async function registrarAuditoria(acao, detalhes = '') {
  if (!currentUser) return;
  await addDoc(collection(db, "auditoria"), {
    usuarioId: currentUser.uid, usuarioNome: currentUser.nome, perfil: currentUser.role,
    acao, detalhes, dataHora: serverTimestamp()
  });
}

async function salvarProdutoNoFirebase(dados) {
  try {
    if (dados.id) {
      const id = dados.id; delete dados.id;
      await updateDoc(doc(db, "produtos", id), dados);
      await registrarAuditoria("Produto Editado", dados.descricao);
    } else {
      delete dados.id;
      dados.dataCriacao = serverTimestamp();
      await addDoc(collection(db, "produtos"), dados);
      await registrarAuditoria("Produto Criado", dados.descricao);
    }
    closeModal('modal-produto');
  } catch (e) { alert("Erro ao salvar: " + e.message); }
}

async function excluirProdutoNoFirebase(id) {
  if (!confirm("Excluir produto?")) return;
  await deleteDoc(doc(db, "produtos", id));
  await registrarAuditoria("Produto Excluído", "ID: " + id);
}

async function registrarVendaNoFirebase(dadosVenda) {
  try {
    dadosVenda.dataHora = serverTimestamp();
    dadosVenda.operadorId = currentUser.uid;
    dadosVenda.operadorNome = currentUser.nome;
    
    const novaVendaRef = await addDoc(collection(db, "vendas"), dadosVenda);
    
    // Baixa no estoque
    for (const item of dadosVenda.itens) {
      if (item.tipo === 'produto' && item.produtoId) {
        const prodAtual = produtos.find(p => p.id === item.produtoId);
        if (prodAtual) {
          await updateDoc(doc(db, "produtos", item.produtoId), {
            estoque: prodAtual.estoque - item.quantidade
          });
        }
      }
    }
    await registrarAuditoria("Venda Finalizada", `Venda #${novaVendaRef.id} - R$ ${dadosVenda.total}`);
    return novaVendaRef.id;
  } catch (e) {
    alert("ERRO CRÍTICO AO SALVAR VENDA: " + e.message);
    return null;
  }
}

// ==========================================================
// 7. FUNÇÕES DE INTERFACE E UTILITÁRIOS
// ==========================================================
function set(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
function irPara(page) { const b = document.querySelector(`.nav-item[data-page="${page}"]`); if (b) b.click(); }
function alternarMenuLateral() { document.body.classList.toggle('sidebar-collapsed'); }
function closeModal(id) { const e = document.getElementById(id); if (e) e.classList.remove('show'); }
const fmt = v => "R$ " + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hojeStr = () => new Date().toISOString().slice(0, 10);
const produtoById = id => produtos.find(p => p.id === id);
const fornecedorById = id => fornecedores.find(f => f.id === id);

function fillFornecedorSelects() {
  const o = fornecedores.map(f => `<option value="${f.id}">${f.razao}</option>`).join('');
  ['prod-fornecedor', 'entrada-fornecedor'].forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = o || '<option value="">Nenhum</option>'; });
}
function fillProdutoSelects() {
  const o = produtos.map(p => `<option value="${p.id}">${p.codigo} — ${p.descricao} (${p.estoque})</option>`).join('');
  const e = document.getElementById('entrada-produto'); if (e) e.innerHTML = o || '<option value="">Nenhum</option>';
}

// ==========================================================
// 8. LÓGICA DE NEGÓCIO (ADAPTADA)
// ==========================================================
function openProdutoModal(id) {
  if (!isAdmin) return;
  fillFornecedorSelects();
  set('modal-produto-titulo', id ? 'Editar produto' : 'Novo produto');
  if (id) {
    const p = produtoById(id);
    document.getElementById('prod-id').value = p.id;
    document.getElementById('prod-codigo').value = p.codigo;
    document.getElementById('prod-barras').value = p.barras || '';
    document.getElementById('prod-descricao').value = p.descricao;
    document.getElementById('prod-categoria').value = p.categoria || '';
    document.getElementById('prod-fornecedor').value = p.fornecedorId || '';
    document.getElementById('prod-preco-compra').value = p.precoCompra || 0;
    document.getElementById('prod-preco-venda').value = p.precoVenda || 0;
    document.getElementById('prod-estoque').value = p.estoque || 0;
    document.getElementById('prod-estoque-min').value = p.estoqueMinimo || 0;
    document.getElementById('prod-lote').value = p.lote || '';
    document.getElementById('prod-validade').value = p.validade || '';
  } else {
    ['prod-id', 'prod-barras', 'prod-descricao', 'prod-categoria', 'prod-preco-compra', 'prod-preco-venda', 'prod-estoque', 'prod-estoque-min', 'prod-lote', 'prod-validade'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('prod-codigo').value = String(produtos.length + 1).padStart(3, '0');
  }
  document.getElementById('modal-produto').classList.add('show');
}

async function salvarProduto() {
  if (!isAdmin) return;
  const id = document.getElementById('prod-id').value;
  const descricao = document.getElementById('prod-descricao').value.trim();
  if (!descricao) { alert('Informe a descrição.'); return; }
  
  const dados = {
    codigo: id ? produtoById(id).codigo : String(produtos.length + 1).padStart(3, '0'),
    barras: document.getElementById('prod-barras').value.trim(),
    descricao,
    categoria: document.getElementById('prod-categoria').value.trim(),
    fornecedorId: Number(document.getElementById('prod-fornecedor').value) || null,
    precoCompra: parseFloat(document.getElementById('prod-preco-compra').value) || 0,
    precoVenda: parseFloat(document.getElementById('prod-preco-venda').value) || 0,
    estoque: parseInt(document.getElementById('prod-estoque').value) || 0,
    estoqueMinimo: parseInt(document.getElementById('prod-estoque-min').value) || 0,
    lote: document.getElementById('prod-lote').value.trim(),
    validade: document.getElementById('prod-validade').value
  };
  
  await salvarProdutoNoFirebase({ id, ...dados });
}

function excluirProduto(id) { if (isAdmin) excluirProdutoNoFirebase(id); }

function renderProdutos() {
  const el = document.getElementById('tbl-produtos'); if (!el) return;
  const b = (document.getElementById('busca-produto')?.value || '').toLowerCase();
  el.innerHTML = produtos.filter(p => !b || p.codigo.toLowerCase().includes(b) || p.descricao.toLowerCase().includes(b)).map(p => {
    const f = fornecedorById(p.fornecedorId);
    return `<tr><td>${p.codigo}</td><td>${p.barras || '—'}</td><td>${p.descricao}</td><td>${p.categoria || '—'}</td><td>${f ? f.razao : '—'}</td>
      <td class="num">${fmt(p.precoCompra)}</td><td class="num">${fmt(p.precoVenda)}</td><td class="num">${p.estoque}</td><td class="num">${p.estoqueMinimo}</td>
      <td>${p.validade || '—'}</td>
      <td><button class="btn secondary small" onclick="openProdutoModal('${p.id}')">Editar</button> <button class="btn danger small" onclick="excluirProduto('${p.id}')">Excluir</button></td></tr>`;
  }).join('') || `<tr><td colspan="11" class="empty">Nenhum produto.</td></tr>`;
}

// ==========================================================
// 9. LÓGICA DO PDV E VENDAS
// ==========================================================
function getCartInfo(item) {
  if (item.tipo === 'produto') {
    const p = produtoById(item.produtoId);
    return p ? { descricao: p.descricao, precoVenda: p.precoVenda, precoCompra: p.precoCompra, barras: p.barras, estoque: p.estoque, codigo: p.codigo } : { descricao: 'Removido', precoVenda: 0, precoCompra: 0, barras: null, estoque: 0, codigo: '—' };
  }
  return { descricao: item.descricao || 'Diversos', precoVenda: item.valorUnitario, precoCompra: 0, barras: null, estoque: Infinity, codigo: '—' };
}

function calcularTotalCarrinho() { return cart.reduce((s, c) => s + getCartInfo(c).precoVenda * c.quantidade, 0); }
function calcularDesconto(sub) {
  const v = parseFloat(document.getElementById('pdv-desconto')?.value) || 0;
  const t = document.getElementById('pdv-desconto-tipo')?.value || 'R$';
  return Math.min(Math.max(t === '%' ? sub * v / 100 : v, 0), sub);
}
function totalComDesconto() { const s = calcularTotalCarrinho(); return s - calcularDesconto(s); }

function renderCart() {
  const lista = document.getElementById('cart-list');
  if (lista) lista.innerHTML = cart.map((c, i) => {
    const inf = getCartInfo(c);
    return `<tr><td>${i + 1}</td><td>${inf.barras || '—'}</td><td>${inf.descricao}</td><td class="num">${c.quantidade}</td><td class="num">${num(inf.precoVenda)}</td><td class="num">${num(inf.precoVenda * c.quantidade)}</td></tr>`;
  }).join('') || `<tr><td colspan="6" style="height:120px" class="empty"></td></tr>`;
  
  const sub = calcularTotalCarrinho(), d = calcularDesconto(sub), tot = sub - d;
  set('pdv-subtotal', num(tot)); set('pdv-total', num(tot));
  set('pdv-pay-itens', cart.reduce((s, item) => s + item.quantidade, 0));
  set('pdv-pay-subtotal', fmt(tot));
  calcularTroco();
}

function selectPay(el) {
  document.querySelectorAll('.pay-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected'); currentPay = el.dataset.pay; calcularTroco();
}

function calcularTroco() {
  const total = totalComDesconto();
  const pago = parseFloat(document.getElementById('pdv-valor-pago')?.value) || 0;
  const troco = pago - total;
  set('pdv-recebido', fmt(pago)); set('pdv-troco', fmt(Math.max(troco, 0)));
  const s = document.getElementById('pdv-saldo');
  if (s) { s.textContent = num(Math.abs(troco)); s.classList.toggle('negativo', troco < 0); }
  const st = document.getElementById('troco-status');
  if (st) st.textContent = pago === 0 ? '' : (troco >= 0 ? '✓ Troco: ' + fmt(troco) : '✗ Faltam ' + fmt(-troco));
}

async function finalizeSale() {
  if (cart.length === 0) { alert('Carrinho vazio.'); return; }
  const sub = calcularTotalCarrinho(), desconto = calcularDesconto(sub), total = sub - desconto;
  const pago = parseFloat(document.getElementById('pdv-valor-pago').value) || 0;
  
  if (currentPay === 'Dinheiro' && pago < total) { alert('Valor pago menor que o total.'); return; }

  const itens = cart.map(c => {
    if (c.tipo === 'produto') {
      const p = produtoById(c.produtoId);
      return { tipo: 'produto', produtoId: c.produtoId, quantidade: c.quantidade, valorUnitario: p.precoVenda, custoUnitario: p.precoCompra };
    }
    return { tipo: 'diversos', produtoId: null, descricao: c.descricao, quantidade: c.quantidade, valorUnitario: c.valorUnitario, custoUnitario: 0 };
  });

  const venda = {
    itens, total, desconto, pagamento: currentPay,
    valorPago: currentPay === 'Dinheiro' ? pago : total,
    troco: currentPay === 'Dinheiro' ? pago - total : 0,
    cpf: (document.getElementById('pdv-cpf')?.value || '').trim()
  };

  const idVenda = await registrarVendaNoFirebase(venda);
  
  if (idVenda) {
    cart = [];
    document.getElementById('pdv-valor-pago').value = '';
    document.getElementById('pdv-cpf').value = '';
    document.getElementById('pdv-desconto').value = '';
    fecharPainelPagamento(); 
    renderCart(); 
    alert("Venda registrada com sucesso na nuvem!");
  }
}

function abrirPainelPagamento() {
  const p = document.getElementById('erp-pay');
  if (p) { p.style.display = 'flex'; renderCart(); setTimeout(() => { const op = document.querySelector('.pay-opt[data-pay="' + currentPay + '"]'); if (op) op.focus(); }, 60); }
}
function fecharPainelPagamento() {
  const p = document.getElementById('erp-pay'); if (p) p.style.display = 'none';
}
function atalhoFinalizar() {
  if (cart.length === 0) return;
  const pay = document.getElementById('erp-pay');
  if (!pay || pay.style.display !== 'flex') { abrirPainelPagamento(); return; }
  finalizeSale();
}

// ==========================================================
// 10. INICIALIZAÇÃO E EVENTOS
// ==========================================================
function refreshAll() {
  fillFornecedorSelects(); fillProdutoSelects();
  renderProdutos(); renderDashboard(); renderCart();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!isAdmin && btn.classList.contains('admin-only')) { alert('Acesso negado.'); return; }
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const pg = document.getElementById('page-' + btn.dataset.page); if (pg) pg.classList.add('active');
    refreshAll();
  });
});

// Atalhos de teclado (Mantidos do original)
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    fecharPainelPagamento();
    document.querySelectorAll('.overlay.show').forEach(o => o.classList.remove('show'));
    return;
  }
  const pdv = document.getElementById('page-pdv');
  if (!pdv || !pdv.classList.contains('active')) return;
  
  if (e.key === 'F4') { e.preventDefault(); atalhoFinalizar(); }
  if (e.key === 'F6') { e.preventDefault(); if(cart.length && confirm('Cancelar venda?')) { cart = []; renderCart(); } }
  if (e.key === 'F10') { e.preventDefault(); if (confirm('Sair do sistema?')) sair(); }
});

function iniciarEventosPDV() {
  const si = document.getElementById('pdv-scanner');
  if (si) {
    si.addEventListener('keydown', e => { 
      if (e.key === 'Enter') { 
        e.preventDefault(); 
        // Lógica simplificada de busca por código de barras
        const codigo = si.value.trim();
        const prod = produtos.find(p => p.barras === codigo || p.codigo === codigo);
        if (prod) {
          const ex = cart.find(c => c.tipo === 'produto' && c.produtoId === prod.id);
          if (ex) ex.quantidade += 1; else cart.push({ tipo: 'produto', produtoId: prod.id, quantidade: 1 });
          renderCart(); si.value = ''; si.focus();
        } else {
          alert("Produto não encontrado"); si.value = ''; si.focus();
        }
      } 
    });
  }
}

set('sb-data', new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarEventosPDV);
else iniciarEventosPDV();