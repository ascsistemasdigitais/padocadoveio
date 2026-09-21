// ==========================================================
// 1. IMPORTAÇÕES DO FIREBASE
// ==========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, 
  query, orderBy, serverTimestamp, getDoc, getDocs, where, Timestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ==========================================================
// 2. CONFIGURAÇÃO DO FIREBASE (SUBSTITUA PELAS SUAS CHAVES)
// ==========================================================
const firebaseConfig = {
  apiKey: "AIzaSyCT2i6JN4RjNHy58ujrsAz4XQrDJ6IzytA",
  authDomain: "padoca-d5372.firebaseapp.com",
  projectId: "padoca-d5372",
  storageBucket: "padoca-d5372.firebasestorage.app",
  messagingSenderId: "464588320056",
  appId: "1:464588320056:web:a966da53c66efed18ca5cd",
  measurementId: "G-EQTBEPBTB4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provisioningApp = initializeApp(firebaseConfig, 'padoca-user-provisioning');
const provisioningAuth = getAuth(provisioningApp);

setPersistence(auth, browserLocalPersistence).catch(error => {
  console.error('Não foi possível manter a sessão:', error);
});

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
let usuarios = [];
let auditoria = [];
let caixaAtual = null;
let ultimaVenda = null;
let currentPay = "Dinheiro";
let cart = [];
let unsubscribes = [];
let seq = { produto: 1, fornecedor: 1, entrada: 1, venda: 1 };

// ==========================================================
// 4. AUTENTICAÇÃO EM TEMPO REAL
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
  unsubscribes.forEach(unsub => unsub());
  signOut(auth).then(() => { window.location.href = 'login.html'; });
}

function aplicarPermissoes() {
  const ui = document.getElementById('user-info');
  if (ui) ui.innerHTML = `<div class="user-info-box"><div class="nome">${currentUser.nome}</div><div class="role">${isAdmin ? 'Administrador' : 'Operador de Caixa'}</div></div>`;
  set('sb-user', currentUser.nome.toUpperCase());
  set('sb-grupo', isAdmin ? 'ADMINISTRADOR' : 'OPERADOR DE CAIXA');

  if (!isAdmin) {
    document.body.classList.add('modo-caixa');
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
  // OUVIR PRODUTOS
  const qProd = query(collection(db, "produtos"), orderBy("descricao", "asc"));
  unsubscribes.push(onSnapshot(qProd, (snap) => {
    produtos = snap.docs.map(d => ({ id: d.id, ...converterTimestamps(d.data()) }));
    if (document.getElementById('page-produtos')?.classList.contains('active')) renderProdutos();
    if (document.getElementById('page-pdv')?.classList.contains('active')) { fillProdutoSelects(); renderBuscaDropdown(); }
    if (document.getElementById('page-estoque')?.classList.contains('active')) renderEstoque();
    if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboard();
    if (document.getElementById('page-relatorio-estoque')?.classList.contains('active')) renderRelatorioEstoque();
    if (document.getElementById('page-entradas')?.classList.contains('active')) fillProdutoSelects();
    refreshAll();
  }));

  // OUVIR FORNECEDORES
  const qForn = query(collection(db, "fornecedores"), orderBy("razao", "asc"));
  unsubscribes.push(onSnapshot(qForn, (snap) => {
    fornecedores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (document.getElementById('page-fornecedores')?.classList.contains('active')) renderFornecedores();
    fillFornecedorSelects();
  }));

  // OUVIR VENDAS
  const qVendas = query(collection(db, "vendas"), orderBy("dataHora", "desc"));
  unsubscribes.push(onSnapshot(qVendas, (snap) => {
    vendas = snap.docs.map(d => ({ id: d.id, ...converterTimestamps(d.data()) }));
    if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboard();
    if (document.getElementById('page-relatorio-vendas')?.classList.contains('active')) renderRelatorioVendas();
    if (document.getElementById('page-fechamento')?.classList.contains('active')) renderFechamento();
    refreshAll();
  }));

  // OUVIR ENTRADAS
  const qEntradas = query(collection(db, "entradas"), orderBy("data", "desc"));
  unsubscribes.push(onSnapshot(qEntradas, (snap) => {
    entradas = snap.docs.map(d => ({ id: d.id, ...converterTimestamps(d.data()) }));
    if (document.getElementById('page-entradas')?.classList.contains('active')) renderEntradas();
    if (document.getElementById('page-relatorio-compras')?.classList.contains('active')) renderRelatorioCompras();
  }));

  // OUVIR MOVIMENTAÇÕES DE ESTOQUE
  const qMovEstoque = query(collection(db, "movEstoque"), orderBy("data", "desc"));
  unsubscribes.push(onSnapshot(qMovEstoque, (snap) => {
    movEstoque = snap.docs.map(d => ({ id: d.id, ...converterTimestamps(d.data()) }));
    if (document.getElementById('page-estoque')?.classList.contains('active')) renderMovEstoque();
  }));

  // OUVIR AUDITORIA
  const qAuditoria = query(collection(db, "auditoria"), orderBy("dataHora", "desc"));
  unsubscribes.push(onSnapshot(qAuditoria, (snap) => {
    auditoria = snap.docs.map(d => ({ id: d.id, ...converterTimestamps(d.data()) }));
    if (document.getElementById('page-backup')?.classList.contains('active')) renderAuditoria();
  }));

  if (isAdmin) {
    const qUsuarios = query(collection(db, 'usuarios'), orderBy('nome', 'asc'));
    unsubscribes.push(onSnapshot(qUsuarios, snap => {
      usuarios = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      renderUsuarios();
    }, error => console.error('Erro ao ler usuários:', error)));
  }
}

// Converte Timestamps do Firebase para strings legíveis
function converterTimestamps(obj) {
  const novo = { ...obj };
  for (const key in novo) {
    if (novo[key] instanceof Timestamp) {
      novo[key] = novo[key].toDate().toISOString();
    }
  }
  return novo;
}

// ==========================================================
// 6. FUNÇÕES DE BANCO DE DADOS (CRUD)
// ==========================================================
async function registrarAuditoria(acao, detalhes = '') {
  if (!currentUser) return;
  try {
    await addDoc(collection(db, "auditoria"), {
      usuarioId: currentUser.uid, usuarioNome: currentUser.nome, perfil: currentUser.role,
      acao, detalhes, dataHora: serverTimestamp()
    });
  } catch (e) { console.error("Erro auditoria:", e); }
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
    return true;
  } catch (e) { alert("Erro ao salvar: " + e.message); return false; }
}

async function excluirProdutoNoFirebase(id) {
  if (!confirm("Excluir produto?")) return;
  try {
    await deleteDoc(doc(db, "produtos", id));
    await registrarAuditoria("Produto Excluído", "ID: " + id);
  } catch (e) { alert("Erro ao excluir: " + e.message); }
}

async function salvarFornecedorNoFirebase(dados) {
  try {
    if (dados.id) {
      const id = dados.id; delete dados.id;
      await updateDoc(doc(db, "fornecedores", id), dados);
      await registrarAuditoria("Fornecedor Editado", dados.razao);
    } else {
      delete dados.id;
      await addDoc(collection(db, "fornecedores"), dados);
      await registrarAuditoria("Fornecedor Criado", dados.razao);
    }
    closeModal('modal-fornecedor');
    return true;
  } catch (e) { alert("Erro ao salvar: " + e.message); return false; }
}

async function excluirFornecedorNoFirebase(id) {
  if (!confirm("Excluir fornecedor?")) return;
  try {
    await deleteDoc(doc(db, "fornecedores", id));
    await registrarAuditoria("Fornecedor Excluído", "ID: " + id);
  } catch (e) { alert("Erro ao excluir: " + e.message); }
}

async function registrarEntradaNoFirebase(dados) {
  try {
    dados.data = hojeStr();
    await addDoc(collection(db, "entradas"), dados);
    // Atualiza estoque do produto
    const prod = produtos.find(p => p.id === dados.produtoId);
    if (prod) {
      await updateDoc(doc(db, "produtos", dados.produtoId), {
        estoque: (prod.estoque || 0) + dados.quantidade,
        lote: dados.lote || prod.lote,
        validade: dados.validade || prod.validade
      });
    }
    await registrarAuditoria("Entrada Registrada", `Produto ID ${dados.produtoId} - Qtd: ${dados.quantidade}`);
    return true;
  } catch (e) { alert("Erro ao registrar entrada: " + e.message); return false; }
}

async function excluirEntradaNoFirebase(id) {
  if (!confirm("Excluir esta entrada? O estoque será ajustado.")) return;
  try {
    const entrada = entradas.find(e => e.id === id);
    if (entrada) {
      const prod = produtos.find(p => p.id === entrada.produtoId);
      if (prod) {
        await updateDoc(doc(db, "produtos", entrada.produtoId), {
          estoque: Math.max(0, (prod.estoque || 0) - entrada.quantidade)
        });
      }
      await deleteDoc(doc(db, "entradas", id));
      await registrarAuditoria("Entrada Excluída", `ID: ${id}`);
    }
  } catch (e) { alert("Erro ao excluir: " + e.message); }
}

async function salvarMovEstoqueNoFirebase(dados) {
  try {
    dados.data = new Date().toISOString();
    await addDoc(collection(db, "movEstoque"), dados);
    const prod = produtos.find(p => p.id === dados.produtoId);
    if (prod) {
      let novoEstoque = prod.estoque;
      if (dados.tipo === 'quebra' || dados.tipo === 'perda') novoEstoque -= dados.quantidade;
      else if (dados.tipo === 'acerto') novoEstoque += dados.quantidade;
      else if (dados.tipo === 'contagem') novoEstoque = dados.quantidade;
      await updateDoc(doc(db, "produtos", dados.produtoId), { estoque: Math.max(0, novoEstoque) });
    }
    await registrarAuditoria("Movimentação de Estoque", `${dados.tipo} - Qtd: ${dados.quantidade}`);
    closeModal('modal-mov-estoque');
    return true;
  } catch (e) { alert("Erro: " + e.message); return false; }
}

async function registrarVendaNoFirebase(dadosVenda) {
  try {
    dadosVenda.dataHora = serverTimestamp();
    dadosVenda.operadorId = currentUser.uid;
    dadosVenda.operadorNome = currentUser.nome;
    dadosVenda.caixaId = caixaAtual ? caixaAtual.id : null;
    
    const novaVendaRef = await addDoc(collection(db, "vendas"), dadosVenda);
    
    // Baixa no estoque
    for (const item of dadosVenda.itens) {
      if (item.tipo === 'produto' && item.produtoId) {
        const prodAtual = produtos.find(p => p.id === item.produtoId);
        if (prodAtual) {
          await updateDoc(doc(db, "produtos", item.produtoId), {
            estoque: Math.max(0, (prodAtual.estoque || 0) - item.quantidade)
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
// 7. UTILITÁRIOS
// ==========================================================
function set(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
function irPara(page) { const b = document.querySelector(`.nav-item[data-page="${page}"]`); if (b) b.click(); }
function alternarMenuLateral() { document.body.classList.toggle('sidebar-collapsed'); }
function closeModal(id) { const e = document.getElementById(id); if (e) e.classList.remove('show'); }
const fmt = v => "R$ " + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hojeStr = () => new Date().toISOString().slice(0, 10);
const addDias = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const produtoById = id => produtos.find(p => p.id === id);
const fornecedorById = id => fornecedores.find(f => f.id === id);
const produtoByBarras = c => produtos.find(p => (p.barras || '').trim() === String(c).trim());
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fillFornecedorSelects() {
  const o = fornecedores.map(f => `<option value="${f.id}">${f.razao}</option>`).join('');
  ['prod-fornecedor', 'entrada-fornecedor'].forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = o || '<option value="">Nenhum</option>'; });
}

function fillProdutoSelects() {
  const o = produtos.map(p => `<option value="${p.id}">${p.codigo} — ${p.descricao} (${p.estoque})</option>`).join('');
  const e = document.getElementById('entrada-produto'); if (e) e.innerHTML = o || '<option value="">Nenhum</option>';
  const e2 = document.getElementById('mve-produto'); if (e2) e2.innerHTML = o || '<option value="">Nenhum</option>';
}

function gerarCodigoProduto() {
  let proximo = produtos.reduce((maior, p) => {
    const numero = Number(p.codigo);
    return Number.isInteger(numero) && numero > maior ? numero : maior;
  }, 0) + 1;
  return String(proximo).padStart(3, '0');
}

// ==========================================================
// 8. PRODUTOS
// ==========================================================
function openProdutoModal(id) {
  if (!isAdmin) return;
  fillFornecedorSelects();
  set('modal-produto-titulo', id ? 'Editar produto' : 'Novo produto');
  if (id) {
    const p = produtoById(id);
    if (!p) return;
    document.getElementById('prod-id').value = p.id;
    document.getElementById('prod-codigo').value = p.codigo || '';
    document.getElementById('prod-barras').value = p.barras || '';
    document.getElementById('prod-descricao').value = p.descricao || '';
    document.getElementById('prod-categoria').value = p.categoria || '';
    document.getElementById('prod-fornecedor').value = p.fornecedorId || '';
    document.getElementById('prod-preco-compra').value = p.precoCompra || 0;
    document.getElementById('prod-preco-venda').value = p.precoVenda || 0;
    document.getElementById('prod-estoque').value = p.estoque || 0;
    document.getElementById('prod-estoque-min').value = p.estoqueMinimo || 0;
    document.getElementById('prod-lote').value = p.lote || '';
    document.getElementById('prod-validade').value = p.validade || '';
    document.getElementById('prod-imagem').value = p.imagem || '';
  } else {
    ['prod-id', 'prod-barras', 'prod-descricao', 'prod-categoria', 'prod-preco-compra', 'prod-preco-venda', 'prod-estoque', 'prod-estoque-min', 'prod-lote', 'prod-validade', 'prod-imagem'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('prod-codigo').value = gerarCodigoProduto();
  }
  document.getElementById('modal-produto').classList.add('show');
}

async function salvarProduto() {
  if (!isAdmin) return;
  const id = document.getElementById('prod-id').value;
  const descricao = document.getElementById('prod-descricao').value.trim();
  if (!descricao) { alert('Informe a descrição.'); return; }
  
  const dados = {
    codigo: id ? produtoById(id).codigo : gerarCodigoProduto(),
    barras: document.getElementById('prod-barras').value.trim(),
    descricao,
    categoria: document.getElementById('prod-categoria').value.trim(),
    fornecedorId: Number(document.getElementById('prod-fornecedor').value) || null,
    precoCompra: parseFloat(document.getElementById('prod-preco-compra').value) || 0,
    precoVenda: parseFloat(document.getElementById('prod-preco-venda').value) || 0,
    estoque: parseInt(document.getElementById('prod-estoque').value) || 0,
    estoqueMinimo: parseInt(document.getElementById('prod-estoque-min').value) || 0,
    lote: document.getElementById('prod-lote').value.trim(),
    validade: document.getElementById('prod-validade').value,
    imagem: document.getElementById('prod-imagem')?.value.trim() || ''
  };
  
  await salvarProdutoNoFirebase({ id, ...dados });
}

function excluirProduto(id) { if (isAdmin) excluirProdutoNoFirebase(id); }

function renderProdutos() {
  const el = document.getElementById('tbl-produtos'); if (!el) return;
  const b = (document.getElementById('busca-produto')?.value || '').toLowerCase();
  el.innerHTML = produtos.filter(p => !b || (p.codigo || '').toLowerCase().includes(b) || (p.descricao || '').toLowerCase().includes(b)).map(p => {
    const f = fornecedorById(p.fornecedorId);
    const dv = diasValidade(p.validade);
    return `<tr><td>${p.codigo || ''}</td><td>${p.barras || '—'}</td><td>${p.descricao}</td><td>${p.categoria || '—'}</td><td>${f ? f.razao : '—'}</td>
      <td class="num">${fmt(p.precoCompra)}</td><td class="num">${fmt(p.precoVenda)}</td><td class="num">${p.estoque || 0}</td><td class="num">${p.estoqueMinimo || 0}</td>
      <td>${p.validade ? `${p.validade.split('-').reverse().join('/')} <span class="tag ${dv < 0 ? 'low' : dv <= 15 ? 'mid' : 'ok'}">${dv}d</span>` : '—'}</td>
      <td><button class="btn secondary small" onclick="openProdutoModal('${p.id}')">Editar</button> <button class="btn danger small" onclick="excluirProduto('${p.id}')">Excluir</button></td></tr>`;
  }).join('') || `<tr><td colspan="11" class="empty">Nenhum produto.</td></tr>`;
}

// ==========================================================
// 9. FORNECEDORES
// ==========================================================
function openFornecedorModal(id) {
  if (!isAdmin) return;
  set('modal-fornecedor-titulo', id ? 'Editar fornecedor' : 'Novo fornecedor');
  if (id) {
    const f = fornecedorById(id);
    if (!f) return;
    document.getElementById('forn-id').value = f.id;
    document.getElementById('forn-razao').value = f.razao || '';
    document.getElementById('forn-cnpj').value = f.cnpj || '';
    document.getElementById('forn-telefone').value = f.telefone || '';
    document.getElementById('forn-email').value = f.email || '';
    document.getElementById('forn-contato').value = f.contato || '';
  } else {
    ['forn-id', 'forn-razao', 'forn-cnpj', 'forn-telefone', 'forn-email', 'forn-contato'].forEach(i => document.getElementById(i).value = '');
  }
  document.getElementById('modal-fornecedor').classList.add('show');
}

async function salvarFornecedor() {
  if (!isAdmin) return;
  const id = document.getElementById('forn-id').value;
  const razao = document.getElementById('forn-razao').value.trim();
  if (!razao) { alert('Informe razão social.'); return; }
  
  const dados = {
    razao,
    cnpj: document.getElementById('forn-cnpj').value.trim(),
    telefone: document.getElementById('forn-telefone').value.trim(),
    email: document.getElementById('forn-email').value.trim(),
    contato: document.getElementById('forn-contato').value.trim()
  };
  
  await salvarFornecedorNoFirebase({ id, ...dados });
}

function excluirFornecedor(id) { if (isAdmin) excluirFornecedorNoFirebase(id); }

function renderFornecedores() {
  const el = document.getElementById('tbl-fornecedores'); if (!el) return;
  el.innerHTML = fornecedores.map(f => `<tr><td>${f.id}</td><td>${f.razao}</td><td>${f.cnpj || '—'}</td><td>${f.telefone || '—'}</td><td>${f.email || '—'}</td><td>${f.contato || '—'}</td>
    <td><button class="btn secondary small" onclick="openFornecedorModal('${f.id}')">Editar</button> <button class="btn danger small" onclick="excluirFornecedor('${f.id}')">Excluir</button></td></tr>`).join('') || `<tr><td colspan="7" class="empty">Nenhum.</td></tr>`;
}

// ==========================================================
// 10. ENTRADAS
// ==========================================================
async function registrarEntrada() {
  if (!isAdmin) return;
  const fornecedorId = Number(document.getElementById('entrada-fornecedor').value);
  const produtoId = document.getElementById('entrada-produto').value;
  const q = parseInt(document.getElementById('entrada-qtd').value);
  const valor = parseFloat(document.getElementById('entrada-valor').value) || 0;
  const lote = document.getElementById('entrada-lote').value.trim();
  const validade = document.getElementById('entrada-validade').value;
  
  if (!produtoId || !q || q <= 0) { alert('Produto/quantidade inválidos.'); return; }
  
  const dados = { produtoId, fornecedorId, quantidade: q, valor, lote, validade };
  const sucesso = await registrarEntradaNoFirebase(dados);
  
  if (sucesso) {
    const p = produtoById(produtoId);
    set('entrada-msg', `Estoque de "${p?.descricao}" atualizado.`);
    ['entrada-valor', 'entrada-lote', 'entrada-validade'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('entrada-qtd').value = 1;
  }
}

function renderEntradas() {
  const el = document.getElementById('tbl-entradas'); if (!el) return;
  el.innerHTML = entradas.map(e => {
    const p = produtoById(e.produtoId);
    const dataStr = e.data ? (typeof e.data === 'string' ? e.data : e.data.toDate().toISOString()) : '';
    return `<tr><td>${dataStr.split('T')[0].split('-').reverse().join('/')}</td><td>${p ? escapeHtml(p.descricao) : '—'}</td><td class="num">+${e.quantidade}</td><td class="num">${fmt(e.valor)}</td><td>${e.lote || '—'}</td><td>${e.validade ? e.validade.split('-').reverse().join('/') : '—'}</td><td><button class="btn danger small" onclick="excluirEntrada('${e.id}')">🗑</button></td></tr>`;
  }).join('') || `<tr><td colspan="7" class="empty">Nenhuma.</td></tr>`;
}

function excluirEntrada(id) { if (isAdmin) excluirEntradaNoFirebase(id); }

// ==========================================================
// 11. MOVIMENTAÇÕES DE ESTOQUE
// ==========================================================
function openMovEstoque() {
  if (!isAdmin) return;
  fillProdutoSelects();
  document.getElementById('mve-qtd').value = 1;
  document.getElementById('mve-motivo').value = '';
  document.getElementById('modal-mov-estoque').classList.add('show');
}

async function salvarMovEstoque() {
  const produtoId = document.getElementById('mve-produto').value;
  const tipo = document.getElementById('mve-tipo').value;
  const q = parseInt(document.getElementById('mve-qtd').value) || 0;
  const motivo = document.getElementById('mve-motivo').value.trim() || '—';
  
  if (!produtoId || q <= 0) { alert('Informe produto e quantidade.'); return; }
  
  await salvarMovEstoqueNoFirebase({ produtoId, tipo, quantidade: q, motivo });
}

function renderMovEstoque() {
  const el = document.getElementById('tbl-mov-estoque'); if (!el) return;
  el.innerHTML = movEstoque.map(m => {
    const p = produtoById(m.produtoId);
    const dataStr = m.data ? (typeof m.data === 'string' ? m.data : m.data.toDate().toISOString()) : '';
    return `<tr><td>${dataStr.slice(0, 10).split('-').reverse().join('/')}</td><td>${p ? p.descricao : '—'}</td><td>${m.tipo}</td><td class="num">${m.quantidade > 0 ? '+' : ''}${m.quantidade}</td><td>${m.motivo}</td></tr>`;
  }).join('') || `<tr><td colspan="5" class="empty">Nenhuma.</td></tr>`;
}

// ==========================================================
// 12. ESTOQUE
// ==========================================================
function diasValidade(v) { 
  if (!v) return null; 
  const h = new Date(); h.setHours(0, 0, 0, 0); 
  return Math.round((new Date(v + 'T00:00:00') - h) / 86400000); 
}

function statusEstoque(p) {
  if ((p.estoque || 0) <= (p.estoqueMinimo || 0)) return { texto: 'REPOSIÇÃO', classe: 'low' };
  if ((p.estoque || 0) <= (p.estoqueMinimo || 0) * 1.5) return { texto: 'ATENÇÃO', classe: 'mid' };
  return { texto: 'OK', classe: 'ok' };
}

function produtosBaixoEstoque() { return produtos.filter(p => (p.estoque || 0) <= (p.estoqueMinimo || 0)); }
function produtosProximosVencimento() {
  return produtos.map(p => ({ p, dias: diasValidade(p.validade) })).filter(x => x.dias !== null && x.dias >= 0 && x.dias <= 15).sort((a, b) => a.dias - b.dias);
}

function renderEstoque() {
  const el = document.getElementById('tbl-estoque'); if (!el) return;
  el.innerHTML = produtos.map(p => {
    const s = statusEstoque(p);
    return `<tr><td>${p.descricao}</td><td class="num">${p.estoque || 0}</td><td class="num">${p.estoqueMinimo || 0}</td><td><span class="tag ${s.classe}">${s.texto}</span></td></tr>`;
  }).join('');
  
  const bx = produtosBaixoEstoque();
  const ah = bx.length ? `<div class="alert-box"><div>⚠</div><div><b>Reposição (${bx.length})</b><div class="chip-list">${bx.map(p => `<span class="chip">${p.descricao}</span>`).join('')}</div></div></div>` : '';
  const a1 = document.getElementById('alerta-reposicao'); if (a1) a1.innerHTML = ah;
  const a2 = document.getElementById('alerta-reposicao-2'); if (a2) a2.innerHTML = ah;
  
  const vencendo = produtosProximosVencimento();
  const vh = vencendo.length ? `<div class="alert-box validade-alert"><div>⏰</div><div><b>Validade próxima (${vencendo.length})</b><div class="chip-list">${vencendo.map(({ p, dias }) => `<span class="chip">${escapeHtml(p.descricao)} · ${dias === 0 ? 'vence hoje' : `vence em ${dias}d`}</span>`).join('')}</div></div></div>` : '';
  const av1 = document.getElementById('alerta-validade'); if (av1) av1.innerHTML = vh;
  const av2 = document.getElementById('alerta-validade-2'); if (av2) av2.innerHTML = vh;
  
  const m = document.getElementById('tbl-reposicao-mini');
  if (m) m.innerHTML = bx.length ? bx.map(p => `<tr><td>${p.descricao}</td><td class="num">${p.estoque || 0}</td><td class="num">${p.estoqueMinimo || 0}</td></tr>`).join('') : `<tr><td colspan="3" class="empty">Nenhum.</td></tr>`;
}

// ==========================================================
// 13. PDV - CARRINHO E PAGAMENTO
// ==========================================================
function getCartInfo(item) {
  if (item.tipo === 'pizza2') return { descricao: item.descricao, precoVenda: item.valorUnitario, precoCompra: item.custoUnitario || 0, barras: null, estoque: Infinity, codigo: item.codigo || 'P02' };
  if (item.tipo === 'produto') {
    const p = produtoById(item.produtoId);
    if (!p) return { descricao: 'Removido', precoVenda: 0, precoCompra: 0, barras: null, estoque: 0, codigo: '—' };
    return { descricao: p.descricao, precoVenda: p.precoVenda, precoCompra: p.precoCompra, barras: p.barras, estoque: p.estoque, codigo: p.codigo };
  }
  return { descricao: item.descricao || 'Diversos', precoVenda: item.valorUnitario, precoCompra: 0, barras: null, estoque: Infinity, codigo: '—' };
}

function calcularTotalCarrinho() { return cart.reduce((s, c) => s + getCartInfo(c).precoVenda * c.quantidade, 0); }
function calcularDesconto(sub) {
  const v = parseFloat(document.getElementById('pdv-desconto')?.value) || 0;
  const t = document.getElementById('pdv-desconto-tipo')?.value || 'R$';
  return Math.min(Math.max(t === '%' ? sub * v / 100 : v, 0), sub);
}
function totalComDesconto() { return calcularTotalCarrinho() - calcularDesconto(calcularTotalCarrinho()); }

function renderCart() {
  const lista = document.getElementById('cart-list');
  if (lista) lista.innerHTML = cart.map((c, i) => {
    const inf = getCartInfo(c);
    return `<tr><td>${i + 1}</td><td>${inf.barras || '—'}</td><td>${inf.descricao}</td><td class="num">${c.quantidade}</td><td class="num">${num(inf.precoVenda)}</td><td class="num">${num(inf.precoVenda * c.quantidade)}</td></tr>`;
  }).join('') || `<tr><td colspan="6" style="height:120px" class="empty"></td></tr>`;
  
  const sub = calcularTotalCarrinho(), d = calcularDesconto(sub), tot = sub - d;
  set('pdv-subtotal', num(tot));
  set('pdv-total', num(tot));
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
  set('pdv-recebido', fmt(pago));
  set('pdv-troco', fmt(Math.max(troco, 0)));
  const s = document.getElementById('pdv-saldo');
  if (s) { s.textContent = num(Math.abs(troco)); s.classList.toggle('negativo', troco < 0); }
  const st = document.getElementById('troco-status');
  if (st) st.textContent = pago === 0 ? '' : (troco >= 0 ? '✓ Troco: ' + fmt(troco) : '✗ Faltam ' + fmt(-troco));
}

async function finalizeSale() {
  if (!caixaAberto()) { alert('Abra o caixa antes de vender.'); openAberturaCaixa(); return; }
  if (cart.length === 0) { alert('Carrinho vazio.'); return; }
  
  const sub = calcularTotalCarrinho(), desconto = calcularDesconto(sub), total = sub - desconto;
  const pago = parseFloat(document.getElementById('pdv-valor-pago').value) || 0;
  
  if (currentPay === 'Dinheiro') {
    if (pago <= 0) { alert('Informe o valor pago.'); return; }
    if (pago < total) { alert('Valor pago menor que o total.'); return; }
  }
  
  const itens = cart.map(c => {
    if (c.tipo === 'produto') {
      const p = produtoById(c.produtoId);
      return { tipo: 'produto', produtoId: c.produtoId, quantidade: c.quantidade, valorUnitario: p.precoVenda, custoUnitario: p.precoCompra };
    }
    if (c.tipo === 'pizza2') {
      return { tipo: 'pizza2', produtoId: null, descricao: c.descricao, quantidade: c.quantidade, valorUnitario: c.valorUnitario, custoUnitario: c.custoUnitario || 0 };
    }
    return { tipo: 'diversos', produtoId: null, descricao: c.descricao, quantidade: c.quantidade, valorUnitario: c.valorUnitario, custoUnitario: 0 };
  });
  
  const venda = {
    itens, total, desconto, pagamento: currentPay,
    valorPago: currentPay === 'Dinheiro' ? pago : total,
    troco: currentPay === 'Dinheiro' ? Math.max(0, pago - total) : 0,
    cpf: (document.getElementById('pdv-cpf')?.value || '').trim()
  };
  
  const idVenda = await registrarVendaNoFirebase(venda);
  
  if (idVenda) {
    ultimaVenda = { id: idVenda, ...venda, dataHora: new Date().toISOString() };
    cart = [];
    document.getElementById('pdv-valor-pago').value = '';
    document.getElementById('pdv-cpf').value = '';
    document.getElementById('pdv-desconto').value = '';
    fecharPainelPagamento();
    mostrarVazio();
    renderCart();
    set('pdv-msg', `Venda ${fmt(total)} via ${currentPay} registrada.`);
    abrirCupom(ultimaVenda, true);
    focusScanner();
  }
}

// ==========================================================
// 14. PDV - SCANNER E BUSCA
// ==========================================================
function focusScanner() { const i = document.getElementById('pdv-scanner'); if (i) i.focus(); }
function setScannerStatus(m, err) {
  const s = document.getElementById('scanner-status'); if (!s) return;
  s.textContent = m; s.style.color = err ? '#ffb3a6' : '#bcd6ef';
}
function ehCodigoBarras(s) { s = (s || '').trim(); return /^\d{8,20}$/.test(s); }

function processarCodigoBarras(codigo) {
  const input = document.getElementById('pdv-scanner');
  codigo = (codigo || '').trim(); if (!codigo) return;
  const produto = produtoByBarras(codigo) || produtos.find(p => (p.codigo || '').trim() === codigo);
  
  if (!produto) {
    beep(false); setScannerStatus(`Código "${codigo}" não encontrado.`, true);
    if (input) { input.value = ''; input.focus(); } return;
  }
  
  if (produto.codigo === 'P02' || produto.descricao === 'Pizza 2 Sabores') {
    abrirPizzaDoisSabores(quantidadeInformada());
    if (input) { input.value = ''; input.focus(); } return;
  }
  
  if (adicionarItemAoCarrinho(produto.id, quantidadeInformada())) {
    beep(true); setScannerStatus(`✓ "${produto.descricao}" lançado.`, false);
    if (input) { input.value = ''; input.focus(); }
  } else { beep(false); if (input) input.focus(); }
}

function adicionarItemAoCarrinho(produtoId, quantidade) {
  const p = produtoById(produtoId); if (!p) return false;
  if (p.codigo === 'P02' || p.descricao === 'Pizza 2 Sabores') {
    abrirPizzaDoisSabores(quantidade); return false;
  }
  const noCart = cart.filter(c => c.tipo === 'produto' && c.produtoId === produtoId).reduce((s, c) => s + c.quantidade, 0);
  const disp = (p.estoque || 0) - noCart;
  if (quantidade > disp) { alert(`Estoque insuficiente de "${p.descricao}". Disponível: ${disp}`); return false; }
  
  const ex = cart.find(c => c.tipo === 'produto' && c.produtoId === produtoId);
  if (ex) ex.quantidade += quantidade; else cart.push({ tipo: 'produto', produtoId, quantidade });
  mostrarUltimoItem(p.descricao, p.codigo, p.precoVenda, p.precoVenda * quantidade);
  renderCart(); return true;
}

function quantidadeInformada() {
  const campo = document.getElementById('pdv-qtd');
  const quantidade = parseInt(campo?.value, 10) || 1;
  if (quantidade < 1) { if (campo) campo.value = 1; return 1; }
  return quantidade;
}

function buscarProdutos(t) {
  t = (t || '').toLowerCase().trim();
  return produtos.filter(p => !t || (p.codigo || '').toLowerCase().includes(t) || (p.descricao || '').toLowerCase().includes(t) || (p.barras || '').includes(t));
}

function renderBuscaDropdown() {
  const dd = document.getElementById('pdv-busca-dropdown'), input = document.getElementById('pdv-busca');
  if (!dd || !input) return;
  const termo = input.value, res = buscarProdutos(termo);
  if (!termo.trim()) { dd.classList.remove('show'); dd.innerHTML = ''; return; }
  let html = res.length === 0 ? `<div class="busca-item" style="color:var(--ink-soft)">Nenhum produto para "${escapeHtml(termo.trim())}".</div>`
    : res.slice(0, 8).map(p => `<div class="busca-item" onclick="addItemBusca('${p.id}')"><span><b>${p.codigo}</b> ${escapeHtml(p.descricao)}</span><span>${p.estoque}un · ${fmt(p.precoVenda)}</span></div>`).join('');
  html += `<div class="busca-item busca-diversos" onclick="openDiversosModalPelaBusca()">➕ Item Diversos</div>`;
  dd.innerHTML = html; dd.classList.add('show');
}

function addItemBusca(produtoId) {
  const q = parseInt(document.getElementById('pdv-qtd').value) || 1;
  if (produtoById(produtoId)?.codigo === 'P02') {
    document.getElementById('pdv-busca-dropdown').classList.remove('show');
    abrirPizzaDoisSabores(q); return;
  }
  if (adicionarItemAoCarrinho(produtoId, q)) {
    document.getElementById('pdv-busca').value = '';
    document.getElementById('pdv-busca-dropdown').classList.remove('show');
    document.getElementById('pdv-qtd').value = 1; focusScanner();
  }
}

function addItemBuscaPrimeiro() {
  const t = document.getElementById('pdv-busca').value, r = buscarProdutos(t);
  if (!t.trim()) { alert('Digite algo ou use Diversos.'); return; }
  if (!r.length) { openDiversosModalPelaBusca(); return; }
  addItemBusca(r[0].id);
}

// ==========================================================
// 15. PDV - PIZZA 2 SABORES E DIVERSOS
// ==========================================================
function saboresDePizza() {
  return produtos.filter(p => (p.categoria || '').toLowerCase() === 'pizza' && p.codigo !== 'P02' && p.descricao !== 'Pizza 2 Sabores' && Number(p.estoque) > 0);
}

function abrirPizzaDoisSabores(quantidade) {
  const sabores = saboresDePizza();
  if (sabores.length < 2) { alert('Cadastre pelo menos dois sabores de pizza.'); return; }
  const options = sabores.map(p => `<option value="${p.id}">${escapeHtml(p.descricao)} — ${fmt(p.precoVenda)}</option>`).join('');
  document.getElementById('pizza-sabor-1').innerHTML = options;
  document.getElementById('pizza-sabor-2').innerHTML = options;
  document.getElementById('pizza-sabor-2').selectedIndex = 1;
  document.getElementById('modal-pizza-sabores').dataset.quantidade = quantidade;
  atualizarPizzaDoisSabores();
  document.getElementById('modal-pizza-sabores').classList.add('show');
}

function atualizarPizzaDoisSabores() {
  const p1 = produtoById(Number(document.getElementById('pizza-sabor-1')?.value));
  const p2 = produtoById(Number(document.getElementById('pizza-sabor-2')?.value));
  set('pizza-valor-final', fmt(Math.max(p1?.precoVenda || 0, p2?.precoVenda || 0)));
}

function adicionarPizzaDoisSabores() {
  const p1 = produtoById(Number(document.getElementById('pizza-sabor-1').value));
  const p2 = produtoById(Number(document.getElementById('pizza-sabor-2').value));
  const quantidade = Number(document.getElementById('modal-pizza-sabores').dataset.quantidade) || 1;
  if (!p1 || !p2 || p1.id === p2.id) { alert('Escolha dois sabores diferentes.'); return; }
  const preco = Math.max(p1.precoVenda, p2.precoVenda);
  const custo = Math.max(p1.precoCompra || 0, p2.precoCompra || 0);
  const descricao = `Pizza 2 Sabores: ${p1.descricao.replace(/^Pizza\s+/i, '')} + ${p2.descricao.replace(/^Pizza\s+/i, '')}`;
  cart.push({ tipo: 'pizza2', codigo: 'P02', descricao, quantidade, valorUnitario: preco, custoUnitario: custo });
  mostrarUltimoItem(descricao, 'P02', preco, preco * quantidade);
  closeModal('modal-pizza-sabores'); renderCart();
  document.getElementById('pdv-busca').value = ''; document.getElementById('pdv-qtd').value = 1; focusScanner();
}

function openDiversosModal() {
  ['diversos-descricao', 'diversos-valor'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('diversos-qtd').value = 1;
  document.getElementById('modal-diversos').classList.add('show');
}

function openDiversosModalPelaBusca() {
  const t = document.getElementById('pdv-busca').value.trim();
  openDiversosModal();
  if (t) document.getElementById('diversos-descricao').value = t;
  const dd = document.getElementById('pdv-busca-dropdown'); if (dd) dd.classList.remove('show');
}

function adicionarItemDiversos() {
  const desc = document.getElementById('diversos-descricao').value.trim() || 'Item Diversos';
  const q = parseInt(document.getElementById('diversos-qtd').value);
  const v = parseFloat(document.getElementById('diversos-valor').value);
  if (!q || q <= 0) { alert('Qtd inválida.'); return; }
  if (isNaN(v) || v < 0) { alert('Valor inválido.'); return; }
  cart.push({ tipo: 'diversos', descricao: desc, quantidade: q, valorUnitario: v });
  mostrarUltimoItem(desc, '—', v, v * q);
  closeModal('modal-diversos'); renderCart();
  document.getElementById('pdv-busca').value = ''; focusScanner();
}

function mostrarUltimoItem(desc, cod, unit, tot) {
  set('pdv-banner', desc.toUpperCase()); set('pdv-banner-un', 'UN');
  set('pdv-vlr-unit', fmt(unit)); set('pdv-tot-item', fmt(tot));
  set('pdv-cod-int', cod || '—');
  const p = produtos.find(x => (x.codigo || '') === String(cod)) || produtos.find(x => x.descricao === desc);
  setFoto(p);
}

function mostrarVazio() {
  set('pdv-banner', caixaAberto() ? 'CAIXA ABERTO — AGUARDANDO PRODUTOS' : 'REALIZE A ABERTURA DO CAIXA');
  set('pdv-banner-un', ''); set('pdv-vlr-unit', fmt(0)); set('pdv-tot-item', fmt(0));
  set('pdv-cod-int', '—'); setFoto(null);
}

function setFoto(p) {
  const el = document.getElementById('pdv-photo'); if (!el) return;
  if (p && p.imagem) { el.innerHTML = `<img src="${p.imagem}" alt="">`; }
  else el.innerHTML = '<img src="logo.png" alt="Logo">';
}

function abrirProdutosPDV() {
  const categorias = [...new Set(produtos.map(p => p.categoria || 'Outros'))].sort();
  const el = document.getElementById('categorias-pdv');
  if (!el) return;
  el.innerHTML = categorias.map((categoria, index) => `<button class="categoria-pdv ${index === 0 ? 'selected' : ''}" onclick="mostrarProdutosCategoria('${escapeHtml(categoria)}',this)">${escapeHtml(categoria)}</button>`).join('');
  document.getElementById('modal-produtos-pdv').classList.add('show');
  mostrarProdutosCategoria(categorias[0] || 'Outros', el.querySelector('.categoria-pdv'));
}

function mostrarProdutosCategoria(categoria, botao) {
  document.querySelectorAll('.categoria-pdv').forEach(el => el.classList.remove('selected'));
  if (botao) botao.classList.add('selected');
  const lista = document.getElementById('lista-produtos-pdv');
  if (!lista) return;
  const itens = produtos.filter(p => (p.categoria || 'Outros') === categoria);
  lista.innerHTML = itens.map(p => `<button class="produto-pdv" onclick="selecionarProdutoPDV('${p.id}')"><span><b>${escapeHtml(p.descricao)}</b><small>${escapeHtml(p.codigo || '')} · ${p.estoque} un.</small></span><strong>${fmt(p.precoVenda)}</strong></button>`).join('') || '<div class="modal-hint">Nenhum produto.</div>';
}

function selecionarProdutoPDV(produtoId) {
  closeModal('modal-produtos-pdv');
  addItemBusca(produtoId);
}

function abrirDiversosPeloMenu() {
  closeModal('modal-produtos-pdv');
  openDiversosModal();
}

// ==========================================================
// 16. PDV - PAINEL DE PAGAMENTO
// ==========================================================
function abrirPainelPagamento() {
  const p = document.getElementById('erp-pay');
  if (p) { p.style.display = 'flex'; renderCart(); setTimeout(() => { const op = document.querySelector('.pay-opt[data-pay="' + currentPay + '"]'); if (op) op.focus(); }, 60); }
}

function fecharPainelPagamento() {
  const p = document.getElementById('erp-pay'); if (p) p.style.display = 'none';
  focusScanner();
}

function atalhoFinalizar() {
  if (modalAberto()) return;
  const pdv = document.getElementById('page-pdv');
  if (!pdv || !pdv.classList.contains('active')) return;
  if (!caixaAberto()) { alert('Abra o caixa antes de vender.'); openAberturaCaixa(); return; }
  if (cart.length === 0) { beep(false); setScannerStatus('Carrinho vazio.', true); return; }
  const pay = document.getElementById('erp-pay');
  const aberto = pay && pay.style.display === 'flex';
  if (!aberto) { abrirPainelPagamento(); return; }
  if (currentPay === 'Dinheiro') {
    const pago = parseFloat(document.getElementById('pdv-valor-pago').value) || 0;
    if (pago < totalComDesconto()) { const v = document.getElementById('pdv-valor-pago'); if (v) { v.focus(); v.select(); } return; }
  }
  finalizeSale();
}

// ==========================================================
// 17. CUPOM
// ==========================================================
function abrirUltimoCupom() {
  if (!ultimaVenda) { alert('Nenhuma venda finalizada ainda.'); return; }
  abrirCupom(ultimaVenda, false);
}

function abrirCupom(venda, perguntarImpressao) {
  const el = document.getElementById('cupom-preview');
  if (!el) return;
  const itens = venda.itens.map(item => {
    const descricao = item.tipo === 'produto' ? (produtoById(item.produtoId)?.descricao || 'Produto') : item.descricao || 'Item Diversos';
    return `<div class="cupom-item"><span>${item.quantidade}x ${escapeHtml(descricao)}</span><b>${fmt(item.valorUnitario * item.quantidade)}</b></div>`;
  }).join('');
  el.innerHTML = `<div class="cupom-paper">
    <div class="cupom-center"><strong>PADOCA DO VÉIO</strong><br><small>Pizzaria · Lanchonete · Panificadora</small></div>
    <div class="cupom-line">Venda #${venda.id} · ${new Date(venda.dataHora).toLocaleString('pt-BR')}</div>
    <div class="cupom-line">Operador: ${escapeHtml(venda.operadorNome || '—')}</div>
    <hr>${itens}<hr>
    <div class="cupom-total"><span>TOTAL</span><strong>${fmt(venda.total)}</strong></div>
    <div class="cupom-line">Pagamento: ${escapeHtml(venda.pagamento)}${venda.troco > 0 ? ' · Troco: ' + fmt(venda.troco) : ''}</div>
    ${venda.cpf ? `<div class="cupom-line">CPF: ${escapeHtml(venda.cpf)}</div>` : ''}
    <div class="cupom-center cupom-footer">Obrigado pela preferência!</div>
  </div>`;
  document.getElementById('modal-cupom').classList.add('show');
  if (perguntarImpressao && confirm('Venda finalizada. Deseja imprimir o cupom fiscal?')) imprimirCupom(false);
}

function imprimirCupom(confirmar = true) {
  if (!ultimaVenda) { alert('Nenhuma venda disponível.'); return; }
  if (confirmar && !confirm('Deseja imprimir?')) return;
  const papel = document.querySelector('#cupom-preview .cupom-paper');
  if (!papel) return;
  const janela = window.open('', '_blank', 'width=420,height=700');
  if (!janela) { alert('Permita pop-ups para imprimir.'); return; }
  janela.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cupom</title><style>
    @page { size: 72mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { width: 72mm; color: #111; font-family: "Courier New", monospace; font-size: 12px; }
    .cupom-paper { width: 72mm; box-sizing: border-box; padding: 18px 16px; }
    .cupom-center { text-align: center; line-height: 1.45; }
    .cupom-line { margin: 7px 0; line-height: 1.35; }
    .cupom-item, .cupom-total { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
    .cupom-total { font-size: 14px; margin: 6px 0; }
    .cupom-footer { margin-top: 12px; }
  </style></head><body>${papel.outerHTML}</body></html>`);
  janela.document.close();
  janela.addEventListener('load', () => { janela.focus(); janela.print(); janela.addEventListener('afterprint', () => janela.close(), { once: true }); }, { once: true });
}

// ==========================================================
// 18. CAIXA
// ==========================================================
function caixaAberto() { return caixaAtual && caixaAtual.status === 'aberto'; }

function renderCaixaBar() {
  const bar = document.getElementById('caixa-bar'); if (!bar) return;
  if (!caixaAberto()) {
    bar.style.display = 'flex';
    bar.innerHTML = `<span class="cb-dot" style="background:var(--red)"></span> REALIZE A ABERTURA DO CAIXA <span class="spacer"></span><button class="btn small" onclick="openAberturaCaixa()">Abrir caixa</button>`;
  } else {
    bar.style.display = 'none';
  }
}

function openAberturaCaixa() {
  document.getElementById('modal-abertura-caixa').classList.add('show');
}

function abrirCaixa() {
  const fundo = parseFloat(document.getElementById('caixa-fundo').value) || 0;
  caixaAtual = {
    id: 'caixa_' + Date.now(),
    operadorId: currentUser.uid,
    operadorNome: currentUser.nome,
    abertura: new Date().toISOString(),
    fundo,
    status: 'aberto',
    movimentacoes: []
  };
  registrarAuditoria('Caixa aberto', `Fundo ${fmt(fundo)}`);
  closeModal('modal-abertura-caixa');
  renderCaixaBar();
  mostrarVazio();
}

function checarCaixa() {
  const pdv = document.getElementById('page-pdv');
  if (pdv && pdv.classList.contains('active') && !caixaAberto()) openAberturaCaixa();
  renderCaixaBar();
}

function openMovCaixa() {
  if (!caixaAberto()) return;
  document.getElementById('modal-mov-caixa').classList.add('show');
}

function salvarMovCaixa() {
  const tipo = document.getElementById('mov-caixa-tipo').value;
  const valor = parseFloat(document.getElementById('mov-caixa-valor').value) || 0;
  const motivo = document.getElementById('mov-caixa-motivo').value.trim() || '—';
  if (valor <= 0) { alert('Valor inválido.'); return; }
  caixaAtual.movimentacoes.push({ tipo, valor, motivo, hora: new Date().toISOString() });
  registrarAuditoria(tipo === 'sangria' ? 'Sangria' : 'Suprimento', `${fmt(valor)} · ${motivo}`);
  closeModal('modal-mov-caixa');
  document.getElementById('mov-caixa-valor').value = '';
  document.getElementById('mov-caixa-motivo').value = '';
}

function openFechamentoCaixa() {
  if (!caixaAberto()) return;
  const r = resumoCaixa();
  document.getElementById('fecha-resumo').innerHTML = `<table style="margin-bottom:10px">
    <tr><td>Vendas</td><td class="num">${r.vd.length}</td></tr>
    <tr><td>Dinheiro</td><td class="num">${fmt(r.por['Dinheiro'])}</td></tr>
    <tr><td>Cartão</td><td class="num">${fmt(r.por['Cartão'])}</td></tr>
    <tr><td>PIX</td><td class="num">${fmt(r.por['PIX'])}</td></tr>
    <tr><td>Descontos</td><td class="num">${fmt(r.desc)}</td></tr>
    <tr><td>Fundo+supr−sang</td><td class="num">${fmt(caixaAtual.fundo + r.sup - r.san)}</td></tr>
    <tr><td><b>Esperado em dinheiro</b></td><td class="num"><b>${fmt(r.esperado)}</b></td></tr></table>`;
  document.getElementById('fecha-contado').value = '';
  set('fecha-diferenca', fmt(0));
  document.getElementById('modal-fecha-caixa').classList.add('show');
}

function resumoCaixa() {
  const hoje = hojeStr();
  const vd = vendas.filter(v => {
    const dataStr = v.dataHora ? (typeof v.dataHora === 'string' ? v.dataHora : v.dataHora.toDate().toISOString()) : '';
    return v.caixaId === caixaAtual.id && dataStr.slice(0, 10) === hoje;
  });
  const por = { Dinheiro: 0, 'Cartão': 0, PIX: 0 }; let desc = 0;
  vd.forEach(v => { por[v.pagamento] = (por[v.pagamento] || 0) + v.total; desc += v.desconto || 0; });
  const sup = (caixaAtual.movimentacoes || []).filter(m => m.tipo === 'suprimento').reduce((s, m) => s + m.valor, 0);
  const san = (caixaAtual.movimentacoes || []).filter(m => m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0);
  return { vd, por, desc, sup, san, esperado: caixaAtual.fundo + sup - san + por['Dinheiro'] };
}

function calcDiferenca() {
  const r = resumoCaixa(), c = parseFloat(document.getElementById('fecha-contado').value.replace(',', '.')) || 0;
  const el = document.getElementById('fecha-diferenca');
  el.textContent = fmt(c - r.esperado);
  el.classList.toggle('negativo', (c - r.esperado) < 0);
}

function confirmarFechamentoCaixa() {
  const r = resumoCaixa(), c = parseFloat(document.getElementById('fecha-contado').value.replace(',', '.')) || 0;
  registrarAuditoria('Caixa fechado', `Contado ${fmt(c)} · Diferença ${fmt(c - r.esperado)}`);
  caixaAtual = null;
  closeModal('modal-fecha-caixa');
  renderCaixaBar();
  mostrarVazio();
}

// ==========================================================
// 19. RELATÓRIOS
// ==========================================================
function vendasDoDia() {
  const h = hojeStr();
  return vendas.filter(v => {
    const dataStr = v.dataHora ? (typeof v.dataHora === 'string' ? v.dataHora : v.dataHora.toDate().toISOString()) : '';
    return dataStr.slice(0, 10) === h;
  });
}

function renderDashboard() {
  const l = document.getElementById('hoje-label');
  if (l) l.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const vd = vendasDoDia();
  const fat = vd.reduce((s, v) => s + (v.total || 0), 0);
  const q = vd.reduce((s, v) => s + (v.itens || []).reduce((a, i) => a + i.quantidade, 0), 0);
  const lu = vd.reduce((s, v) => s + (v.itens || []).reduce((a, i) => a + ((i.valorUnitario || 0) - (i.custoUnitario || 0)) * i.quantidade, 0), 0);
  set('kpi-fat', fmt(fat)); set('kpi-qtd', q); set('kpi-baixo', produtosBaixoEstoque().length); set('kpi-lucro', fmt(lu));
  
  const el = document.getElementById('tbl-ultimas-vendas');
  if (el) el.innerHTML = vd.length ? [...vd].reverse().slice(0, 8).map(v => {
    const dataStr = v.dataHora ? (typeof v.dataHora === 'string' ? v.dataHora : v.dataHora.toDate().toISOString()) : '';
    return `<tr><td>${new Date(dataStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td><td>${(v.itens || []).reduce((s, i) => s + i.quantidade, 0)} un.</td><td>${v.pagamento}</td><td class="num">${fmt(v.total)}</td></tr>`;
  }).join('') : `<tr><td colspan="4" class="empty">Nenhuma venda hoje.</td></tr>`;
}

function renderRelatorioCompras() {
  const el = document.getElementById('tbl-relatorio-compras'); if (!el) return;
  const de = document.getElementById('rc-de').value, ate = document.getElementById('rc-ate').value;
  const f = entradas.filter(e => {
    const dataStr = e.data ? (typeof e.data === 'string' ? e.data : e.data.toDate().toISOString()) : '';
    return (!de || dataStr >= de) && (!ate || dataStr <= ate);
  });
  let t = 0;
  el.innerHTML = f.map(e => {
    const p = produtoById(e.produtoId), fo = fornecedorById(e.fornecedorId); t += e.valor;
    const dataStr = e.data ? (typeof e.data === 'string' ? e.data : e.data.toDate().toISOString()) : '';
    return `<tr><td>${dataStr.slice(0, 10).split('-').reverse().join('/')}</td><td>${fo ? fo.razao : '—'}</td><td>${p ? p.descricao : '—'}</td><td class="num">${e.quantidade}</td><td class="num">${fmt(e.valor)}</td></tr>`;
  }).join('') || `<tr><td colspan="5" class="empty">Nada.</td></tr>`;
  set('rc-total', fmt(t));
}

function renderRelatorioVendas() {
  const el = document.getElementById('tbl-relatorio-vendas'); if (!el) return;
  const de = document.getElementById('rv-de').value, ate = document.getElementById('rv-ate').value;
  const fp = document.getElementById('rv-filtro-pagamento')?.value || '';
  const f = vendas.filter(v => {
    const dataStr = v.dataHora ? (typeof v.dataHora === 'string' ? v.dataHora : v.dataHora.toDate().toISOString()) : '';
    const d = dataStr.slice(0, 10);
    return (!de || d >= de) && (!ate || d <= ate) && (!fp || v.pagamento === fp);
  });
  const porP = {}, porPag = { Dinheiro: { qtd: 0, valor: 0 }, 'Cartão': { qtd: 0, valor: 0 }, PIX: { qtd: 0, valor: 0 } };
  let fat = 0, q = 0, lu = 0;
  f.forEach(v => {
    porPag[v.pagamento].qtd++; porPag[v.pagamento].valor += v.total; fat += v.total;
    (v.itens || []).forEach(i => {
      q += i.quantidade;
      const ch = i.tipo === 'diversos' ? 'div' : 'p' + i.produtoId;
      const nm = i.tipo === 'diversos' ? 'Diversos' : (produtoById(i.produtoId)?.descricao || '—');
      if (!porP[ch]) porP[ch] = { nome: nm, qtd: 0, valor: 0, lucro: 0 };
      porP[ch].qtd += i.quantidade; porP[ch].valor += i.valorUnitario * i.quantidade;
      porP[ch].lucro += ((i.valorUnitario || 0) - (i.custoUnitario || 0)) * i.quantidade;
      lu += ((i.valorUnitario || 0) - (i.custoUnitario || 0)) * i.quantidade;
    });
  });
  el.innerHTML = Object.entries(porP).sort((a, b) => b[1].qtd - a[1].qtd).slice(0, 10).map(([c, d]) => `<tr><td>${d.nome}</td><td class="num">${d.qtd}</td><td class="num">${fmt(d.valor)}</td><td class="num">${fmt(d.lucro)}</td></tr>`).join('') || `<tr><td colspan="4" class="empty">Nada.</td></tr>`;
  const pg = document.getElementById('tbl-rv-pagamento');
  if (pg) pg.innerHTML = Object.entries(porPag).map(([fo, d]) => `<tr><td>${fo}</td><td class="num">${d.qtd}</td><td class="num">${fmt(d.valor)}</td><td class="num">${fat > 0 ? ((d.valor / fat) * 100).toFixed(1) : '0,0'}%</td></tr>`).join('');
  set('rv-faturamento', fmt(fat)); set('rv-unidades', q); set('rv-lucro', fmt(lu)); set('rv-ticket', fmt(f.length ? fat / f.length : 0));
}

function renderRelatorioEstoque() {
  if (!document.getElementById('tbl-re-completo')) return;
  let vv = 0, vc = 0, ti = 0;
  produtos.forEach(p => { vv += (p.estoque || 0) * (p.precoVenda || 0); vc += (p.estoque || 0) * (p.precoCompra || 0); ti += (p.estoque || 0); });
  set('re-valor-venda', fmt(vv)); set('re-valor-custo', fmt(vc)); set('re-total-itens', ti); set('re-reposicao', produtosBaixoEstoque().length);
  
  const cv = produtos.filter(p => p.validade).map(p => ({ p, d: diasValidade(p.validade) })).sort((a, b) => a.d - b.d);
  document.getElementById('tbl-re-validade').innerHTML = cv.filter(x => x.d <= 30).map(({ p, d }) => `<tr><td>${p.descricao}</td><td>${p.lote || '—'}</td><td>${p.validade.split('-').reverse().join('/')}</td><td class="num">${d}</td><td class="num">${p.estoque}</td><td>${d < 0 ? '<span class="tag low">VENCIDO</span>' : `<span class="tag ${d <= 7 ? 'low' : 'mid'}">${d}d</span>`}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">Nenhum vencendo em 30d ✔</td></tr>`;
  
  document.getElementById('tbl-re-sugestao').innerHTML = produtosBaixoEstoque().map(p => {
    const s = Math.max((p.estoqueMinimo || 0) * 2 - (p.estoque || 0), 0), f = fornecedorById(p.fornecedorId);
    return `<tr><td>${p.descricao}</td><td>${f ? f.razao : '—'}</td><td class="num">${p.estoque || 0}</td><td class="num">${p.estoqueMinimo || 0}</td><td class="num"><b>${s}</b></td></tr>`;
  }).join('') || `<tr><td colspan="5" class="empty">Nenhuma reposição ✔</td></tr>`;
  
  document.getElementById('tbl-re-completo').innerHTML = [...produtos].sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '')).map(p => {
    const s = statusEstoque(p);
    return `<tr><td>${p.descricao}</td><td>${p.categoria || '—'}</td><td class="num">${p.estoque || 0}</td><td class="num">${p.estoqueMinimo || 0}</td><td class="num">${fmt(p.precoCompra)}</td><td class="num">${fmt(p.precoVenda)}</td><td><span class="tag ${s.classe}">${s.texto}</span></td></tr>`;
  }).join('');
}

function renderFechamento() {
  const vd = vendasDoDia();
  const por = { Dinheiro: 0, 'Cartão': 0, PIX: 0 }; let luc = 0;
  vd.forEach(v => { por[v.pagamento] = (por[v.pagamento] || 0) + v.total; luc += (v.itens || []).reduce((s, i) => s + ((i.valorUnitario || 0) - (i.custoUnitario || 0)) * i.quantidade, 0); });
  set('fz-dinheiro', fmt(por['Dinheiro'])); set('fz-cartao', fmt(por['Cartão'])); set('fz-pix', fmt(por['PIX']));
  set('fz-total', fmt(vd.reduce((s, v) => s + v.total, 0))); set('fz-lucro', fmt(luc));
  const el = document.getElementById('tbl-fechamento');
  if (el) el.innerHTML = vd.length ? [...vd].reverse().map(v => {
    const dataStr = v.dataHora ? (typeof v.dataHora === 'string' ? v.dataHora : v.dataHora.toDate().toISOString()) : '';
    return `<tr><td>${new Date(dataStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td><td>${(v.itens || []).reduce((s, i) => s + i.quantidade, 0)} un.</td><td>${v.pagamento}</td><td class="num">${fmt(v.total)}</td></tr>`;
  }).join('') : `<tr><td colspan="4" class="empty">Nenhuma venda hoje.</td></tr>`;
}

// ==========================================================
// 20. BACKUP E AUDITORIA
// ==========================================================
function renderAuditoria() {
  if (!isAdmin) return;
  const el = document.getElementById('tbl-auditoria'); if (!el) return;
  el.innerHTML = auditoria.map(r => {
    const dataStr = r.dataHora ? (typeof r.dataHora === 'string' ? r.dataHora : r.dataHora.toDate().toISOString()) : '';
    return `<tr><td>${new Date(dataStr).toLocaleString('pt-BR')}</td><td>${escapeHtml(r.usuarioNome || '—')}</td><td><b>${escapeHtml(r.acao)}</b></td><td>${escapeHtml(r.detalhes || '—')}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="empty">Nenhuma atividade.</td></tr>';
  set('auditoria-resumo', `${auditoria.length} registro(s)`);
}

async function exportarBackup() {
  if (!isAdmin) { alert('Acesso negado.'); return; }
  await registrarAuditoria('Backup exportado', 'Cópia completa');
  const backup = {
    versao: 1, aplicacao: 'Padoca do Véio', exportadoEm: new Date().toISOString(),
    produtos, fornecedores, entradas, vendas, movEstoque, auditoria
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `backup-padoca-${hojeStr()}.json`; link.click();
  set('backup-msg', 'Backup exportado.');
}

async function restaurarBackup() {
  if (!isAdmin) { alert('Acesso negado.'); return; }
  alert('Função de restauração ainda não implementada para o Firebase. Use o painel do Firebase para importar dados.');
}

// ==========================================================
// 21. NAVEGAÇÃO E BEEP
// ==========================================================
let audioCtx = null;
function beep(ok) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'square'; o.frequency.value = ok ? 880 : 220; g.gain.value = 0.06;
    o.start(); o.stop(audioCtx.currentTime + (ok ? 0.12 : 0.25));
  } catch (e) { }
}

function modalAberto() { return !!document.querySelector('.overlay.show'); }

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!isAdmin && btn.classList.contains('admin-only')) { alert('Acesso negado.'); return; }
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const pg = document.getElementById('page-' + btn.dataset.page); if (pg) pg.classList.add('active');
    refreshAll();
    if (btn.dataset.page === 'pdv') { focusScanner(); checarCaixa(); }
    registrarAuditoria('Navegação', `Tela ${btn.dataset.page}`);
  });
});

function refreshAll() {
  fillFornecedorSelects(); fillProdutoSelects();
  renderProdutos(); renderFornecedores(); renderEntradas(); renderMovEstoque();
  renderEstoque(); renderDashboard(); renderCart();
  renderRelatorioCompras(); renderRelatorioVendas(); renderRelatorioEstoque(); renderFechamento();
  if (isAdmin) renderAuditoria();
  renderCaixaBar();
}

// ==========================================================
// 22. ATALHOS DE TECLADO
// ==========================================================
function navegarFormaPagamento(direcao) {
  const opcoes = [...document.querySelectorAll('.pay-opt')];
  if (!opcoes.length) return;
  const atual = opcoes.findIndex(el => el.dataset.pay === currentPay);
  const proximo = (atual + direcao + opcoes.length) % opcoes.length;
  opcoes[proximo].focus();
  selectPay(opcoes[proximo]);
}

function alternarPagamento() {
  const o = ['Dinheiro', 'Cartão', 'PIX'];
  const n = o[(o.indexOf(currentPay) + 1) % o.length];
  const el = document.querySelector('.pay-opt[data-pay="' + n + '"]');
  if (el) selectPay(el);
  setScannerStatus('Pagamento: ' + n);
}

function removerUltimoItem() { abrirSelecaoExclusao(); }

function abrirSelecaoExclusao() {
  if (!cart.length) { setScannerStatus('Carrinho vazio.', true); return; }
  const lista = document.getElementById('lista-excluir-itens');
  if (!lista) return;
  lista.innerHTML = cart.map((item, index) => {
    const info = getCartInfo(item);
    return `<button class="item-excluir" onclick="excluirUmaUnidade(${index})"><span><b>${index + 1}. ${escapeHtml(info.descricao)}</b><small>${info.codigo || '—'} · ${fmt(info.precoVenda)}</small></span><strong>${item.quantidade} un.</strong></button>`;
  }).join('');
  document.getElementById('modal-excluir-item').classList.add('show');
}

function excluirUmaUnidade(index) {
  const item = cart[index]; if (!item) return;
  const descricao = getCartInfo(item).descricao;
  if (item.quantidade > 1) item.quantidade -= 1; else cart.splice(index, 1);
  closeModal('modal-excluir-item'); renderCart(); beep(false);
  setScannerStatus('Removida 1 unidade: ' + descricao);
}

function ajustarQtdUltimo(d) {
  if (!cart.length) return;
  const it = cart[cart.length - 1], info = getCartInfo(it), nv = it.quantidade + d;
  if (nv <= 0) cart.pop();
  else if (it.tipo === 'produto' && nv > info.estoque) { beep(false); return; }
  else it.quantidade = nv;
  renderCart();
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const pay = document.getElementById('erp-pay');
    if (pay && pay.style.display === 'flex') { fecharPainelPagamento(); return; }
    document.querySelectorAll('.overlay.show').forEach(o => o.classList.remove('show'));
    const dd = document.getElementById('pdv-busca-dropdown'); if (dd) dd.classList.remove('show');
    return;
  }
  
  const pdv = document.getElementById('page-pdv');
  if (!pdv || !pdv.classList.contains('active')) return;
  const alvo = e.target;
  const dig = alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT') && alvo.id !== 'pdv-scanner';
  
  switch (e.key) {
    case 'F1': e.preventDefault(); document.getElementById('modal-ajuda').classList.toggle('show'); break;
    case 'F2': e.preventDefault(); focusScanner(); break;
    case 'F3': e.preventDefault(); if (!modalAberto()) { const b = document.getElementById('pdv-busca'); if (b) b.focus(); } break;
    case 'F4': e.preventDefault(); atalhoFinalizar(); break;
    case 'F5': e.preventDefault(); if (!modalAberto()) openMovCaixa(); break;
    case 'F6': e.preventDefault(); if (!modalAberto() && cart.length && confirm('Cancelar venda?')) { cart = []; renderCart(); beep(false); mostrarVazio(); setScannerStatus('Venda cancelada.'); } break;
    case 'F7': e.preventDefault(); if (!modalAberto()) { if (e.ctrlKey) abrirProdutosPDV(); else openDiversosModal(); } break;
    case 'F8': e.preventDefault(); if (!modalAberto()) removerUltimoItem(); break;
    case 'F9': e.preventDefault(); if (!modalAberto()) alternarPagamento(); break;
    case 'F10': e.preventDefault(); if (confirm('Sair do sistema?')) sair(); break;
    case 'F11': if (e.ctrlKey) { e.preventDefault(); if (!modalAberto()) abrirUltimoCupom(); } break;
    case 'F12': e.preventDefault(); if (!modalAberto()) openFechamentoCaixa(); break;
    case '+': case '=': if (!dig && !modalAberto()) { e.preventDefault(); ajustarQtdUltimo(1); } break;
    case '-': case '_': if (!dig && !modalAberto()) { e.preventDefault(); ajustarQtdUltimo(-1); } break;
  }
});

// Enter confirma em modais
(function() {
  function bind(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); fn(); } });
  }
  bind('caixa-fundo', abrirCaixa);
  bind('mov-caixa-valor', salvarMovCaixa);
  bind('fecha-contado', confirmarFechamentoCaixa);
  bind('mve-qtd', salvarMovEstoque);
  bind('pdv-valor-pago', atalhoFinalizar);
})();

// ==========================================================
// 23. MENU EM ÁRVORE
// ==========================================================
function toggleTreeGroup(head) {
  const g = head.closest('.tree-group'); if (!g) return;
  g.classList.toggle('collapsed');
  const tw = head.querySelector('.tw');
  if (tw) tw.textContent = g.classList.contains('collapsed') ? '+' : '−';
}

function expandirTree(abrir) {
  document.querySelectorAll('.tree-group').forEach(g => {
    g.classList.toggle('collapsed', !abrir);
    const tw = g.querySelector('.tw');
    if (tw) tw.textContent = abrir ? '−' : '+';
  });
}

function filtrarTree() {
  const q = (document.getElementById('tree-busca')?.value || '').toLowerCase().trim();
  document.querySelectorAll('.tree > .leaf').forEach(l => {
    l.style.display = (!q || (l.textContent || '').toLowerCase().includes(q)) ? '' : 'none';
  });
  document.querySelectorAll('.tree-group').forEach(g => {
    const gname = (g.querySelector('.t-name')?.textContent || '').toLowerCase();
    let any = false;
    g.querySelectorAll('.leaf').forEach(l => {
      const txt = (l.textContent || '').toLowerCase();
      const show = !q || txt.includes(q) || gname.includes(q);
      l.style.display = show ? '' : 'none';
      if (show) any = true;
    });
    g.style.display = any ? '' : 'none';
    if (q && any) g.classList.remove('collapsed');
    const tw = g.querySelector('.tw');
    if (tw) tw.textContent = g.classList.contains('collapsed') ? '+' : '−';
  });
}

// ==========================================================
// 24. INICIALIZAÇÃO DO PDV
// ==========================================================
function setupPDVEvents() {
  const si = document.getElementById('pdv-scanner');
  if (si) {
    let scanDebounce = null;
    si.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(scanDebounce); processarCodigoBarras(si.value); } });
    si.addEventListener('input', () => { clearTimeout(scanDebounce); const v = si.value.trim(); if (ehCodigoBarras(v)) scanDebounce = setTimeout(() => processarCodigoBarras(v), 350); });
  }
  
  const bi = document.getElementById('pdv-busca');
  if (bi) {
    bi.addEventListener('input', renderBuscaDropdown);
    bi.addEventListener('focus', renderBuscaDropdown);
    bi.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!ehCodigoBarras(bi.value)) addItemBuscaPrimeiro();
        else { const dd = document.getElementById('pdv-busca-dropdown'); if (dd) dd.classList.remove('show'); processarCodigoBarras(bi.value); bi.value = ''; }
      }
      if (e.key === 'Escape') { const dd = document.getElementById('pdv-busca-dropdown'); if (dd) dd.classList.remove('show'); }
    });
  }
  
  document.addEventListener('click', e => {
    const pdv = document.getElementById('page-pdv');
    if (!pdv || !pdv.classList.contains('active')) return;
    const dd = document.getElementById('pdv-busca-dropdown');
    if (dd && !e.target.closest('.busca-wrap')) dd.classList.remove('show');
    const t = e.target.tagName;
    if (!(t === 'INPUT' || t === 'SELECT' || t === 'BUTTON' || t === 'OPTION')) focusScanner();
  });
}

// Focus guard
function setupFocusGuard() {
  setInterval(function() {
    const pdv = document.getElementById('page-pdv');
    if (!pdv || !pdv.classList.contains('active') || modalAberto()) return;
    const pay = document.getElementById('erp-pay');
    if (pay && pay.style.display === 'flex') return;
    const ae = document.activeElement, tag = ae ? ae.tagName : 'BODY';
    if (!(tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA')) {
      const s = document.getElementById('pdv-scanner');
      if (s && ae !== s) s.focus();
    }
  }, 400);
}

// Inicialização
set('sb-data', new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }));

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupPDVEvents();
    setupFocusGuard();
    setScannerStatus('Aguardando leitura...');
  });
} else {
  setupPDVEvents();
  setupFocusGuard();
  setScannerStatus('Aguardando leitura...');
}

// Capitalização automática em inputs
document.addEventListener('input', e => {
  const campo = e.target;
  if (!(campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement)) return;
  if (campo.type === 'password' || campo.type === 'email' || campo.type === 'number') return;
  const inicio = campo.selectionStart;
  campo.value = campo.value.toLocaleUpperCase('pt-BR');
  if (inicio !== null) campo.setSelectionRange(inicio, inicio);
});

console.log('[Padoca do Véio] Sistema carregado com Firebase.');

function openUsuarioModal(uid) {
  if (!isAdmin) return;
  const usuario = uid ? usuarios.find(item => item.uid === uid) : null;
  set('modal-usuario-titulo', usuario ? 'Editar usuário' : 'Novo usuário');
  document.getElementById('user-id').value = usuario?.uid || '';
  document.getElementById('user-nome').value = usuario?.nome || '';
  document.getElementById('user-username').value = usuario?.email || '';
  document.getElementById('user-password').value = '';
  document.getElementById('user-role').value = usuario?.role || 'user';
  document.getElementById('user-username').readOnly = Boolean(usuario);
  document.getElementById('modal-usuario').classList.add('show');
}

async function salvarUsuario() {
  if (!isAdmin) return;
  const uid = document.getElementById('user-id').value;
  const nome = document.getElementById('user-nome').value.trim();
  const email = document.getElementById('user-username').value.trim().toLowerCase();
  const senha = document.getElementById('user-password').value;
  const role = document.getElementById('user-role').value;
  if (!nome || !email) { alert('Informe nome e e-mail.'); return; }
  try {
    if (uid) {
      await updateDoc(doc(db, 'usuarios', uid), { nome, role, atualizadoEm: serverTimestamp() });
    } else {
      if (senha.length < 6) { alert('A senha precisa ter pelo menos 6 caracteres.'); return; }
      const credencial = await createUserWithEmailAndPassword(provisioningAuth, email, senha);
      await setDoc(doc(db, 'usuarios', credencial.user.uid), { nome, email, role, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
      await signOut(provisioningAuth);
    }
    closeModal('modal-usuario');
  } catch (error) {
    await signOut(provisioningAuth).catch(() => {});
    alert('Não foi possível salvar o usuário: ' + (error.code || error.message));
  }
}

function renderUsuarios() {
  const tabela = document.getElementById('tbl-usuarios'); if (!tabela) return;
  tabela.innerHTML = usuarios.map(usuario => `<tr><td>${usuario.uid.slice(0, 8)}</td><td><b>${usuario.nome || 'Sem nome'}</b></td><td>${usuario.email || '—'}</td><td>${usuario.role === 'admin' ? 'ADMINISTRADOR' : 'OPERADOR'}</td><td><button class="btn secondary small" onclick="openUsuarioModal('${usuario.uid}')">Editar</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum usuário encontrado.</td></tr>';
}

// O arquivo é um módulo ES. Expomos as funções usadas pelos onclick do HTML.
Object.assign(window, {
  sair, irPara, alternarMenuLateral, toggleTreeGroup, expandirTree, filtrarTree, closeModal,
  openProdutoModal, salvarProduto, excluirProduto, openFornecedorModal, salvarFornecedor, excluirFornecedor,
  registrarEntrada, excluirEntrada, openMovEstoque, salvarMovEstoque, renderRelatorioCompras,
  renderRelatorioVendas, renderRelatorioEstoque, abrirUltimoCupom, abrirProdutosPDV,
  abrirDiversosPeloMenu, adicionarItemDiversos, adicionarPizzaDoisSabores, atualizarPizzaDoisSabores,
  selectPay, calcularTroco, atalhoFinalizar, abrirCaixa, openAberturaCaixa, openMovCaixa,
  salvarMovCaixa, openFechamentoCaixa, confirmarFechamentoCaixa, calcDiferenca, imprimirCupom,
  exportarBackup, restaurarBackup, renderAuditoria
  , openUsuarioModal, salvarUsuario
});
