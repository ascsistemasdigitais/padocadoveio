import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

// Mantém o login ao trocar de página ou atualizar o navegador.
// O Firebase costuma usar esta opção por padrão, mas defini-la evita depender
// da configuração padrão do navegador.
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Não foi possível configurar a persistência do login:", error);
});

const form = document.getElementById('login-form');
const erroBox = document.getElementById('login-erro');
const inputEmail = document.getElementById('login-email');
const inputSenha = document.getElementById('login-senha');
const btnToggleSenha = document.getElementById('toggle-senha');
const btnEntrar = document.getElementById('btn-entrar');

btnToggleSenha.addEventListener('click', () => {
  const isPassword = inputSenha.type === 'password';
  inputSenha.type = isPassword ? 'text' : 'password';
  btnToggleSenha.textContent = isPassword ? '🙈' : '👁';
});

window.addEventListener('DOMContentLoaded', () => {
  const lembrado = localStorage.getItem('padoca_email_lembrado');
  if (lembrado) {
    inputEmail.value = lembrado;
    document.getElementById('login-lembrar').checked = true;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroBox.textContent = '';
  erroBox.classList.remove('show');
  
  const email = inputEmail.value.trim().toLowerCase();
  const senha = inputSenha.value;
  const lembrar = document.getElementById('login-lembrar').checked;

  btnEntrar.disabled = true;
  btnEntrar.textContent = 'Verificando...';

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, senha);
    const user = userCredential.user;

    sessionStorage.setItem('padoca_uid', user.uid);
    sessionStorage.setItem('padoca_email', user.email);
    
    if (lembrar) {
      localStorage.setItem('padoca_email_lembrado', email);
    } else {
      localStorage.removeItem('padoca_email_lembrado');
    }

    window.location.href = 'index.html';

  } catch (error) {
    console.error("Erro no login:", error.code);
    let mensagemErro = "Ocorreu um erro ao tentar entrar.";
    switch (error.code) {
      case 'auth/invalid-email': mensagemErro = "Formato de e-mail inválido."; break;
      case 'auth/user-not-found': mensagemErro = "E-mail não cadastrado no sistema."; break;
      case 'auth/wrong-password': mensagemErro = "Senha incorreta."; break;
      case 'auth/too-many-requests': mensagemErro = "Muitas tentativas. Tente mais tarde."; break;
      case 'auth/network-request-failed': mensagemErro = "Erro de conexão. Verifique a internet."; break;
    }
    erroBox.textContent = mensagemErro;
    erroBox.classList.add('show');
    btnEntrar.disabled = false;
    btnEntrar.textContent = '→ Entrar';
  }
});
