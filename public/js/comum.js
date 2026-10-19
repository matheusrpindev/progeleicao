// Funções compartilhadas pelas telas de admin, mesário e resultado.

async function api(metodo, url, corpo) {
  const resp = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const erro = new Error(dados.erro || `Erro ${resp.status}`);
    erro.status = resp.status;
    erro.dados = dados;
    throw erro;
  }
  return dados;
}

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const formatarDataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—');
const formatarHora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');
const formatarData = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

function mostrarAviso(elemento, tipo, texto) {
  elemento.className = `aviso ${tipo}`;
  elemento.textContent = texto;
}

// Mostra a tela de login (ou de criação da senha) e chama aoEntrar quando autenticado.
async function exigirLogin(aoEntrar) {
  const sessao = await api('GET', '/api/sessao');
  if (sessao.autenticado) return aoEntrar();

  const conteudo = document.querySelector('main');
  conteudo.classList.add('oculto');
  const caixa = document.createElement('div');
  caixa.className = 'cartao login';
  document.body.appendChild(caixa);

  if (!sessao.senhaDefinida && !sessao.local) {
    caixa.innerHTML = `<h2>Senha ainda não definida</h2>
      <p>A senha de acesso deve ser criada no computador servidor, abrindo o endereço <b>http://localhost:${location.port || 80}/admin</b>.</p>`;
    return;
  }

  const criando = !sessao.senhaDefinida;
  caixa.innerHTML = `
    <h2>${criando ? 'Criar senha de acesso' : 'Acesso restrito'}</h2>
    ${criando ? '<p>Primeira execução: escolha a senha que será usada no Admin, no Mesário e no Resultado. Guarde-a bem: ela não pode ser recuperada.</p>' : ''}
    <form>
      <label for="senha">Senha</label>
      <input type="password" id="senha" autocomplete="current-password" required autofocus>
      ${criando ? '<label for="senha2">Repita a senha</label><input type="password" id="senha2" required>' : ''}
      <div class="aviso oculto"></div>
      <div class="acoes"><button type="submit">${criando ? 'Criar senha e entrar' : 'Entrar'}</button></div>
    </form>`;
  const aviso = caixa.querySelector('.aviso');
  caixa.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const senha = caixa.querySelector('#senha').value;
    try {
      if (criando) {
        if (senha !== caixa.querySelector('#senha2').value) throw new Error('As duas senhas não são iguais.');
        await api('POST', '/api/senha', { senha });
      } else {
        await api('POST', '/api/login', { senha });
      }
      caixa.remove();
      conteudo.classList.remove('oculto');
      aoEntrar();
    } catch (erro) {
      mostrarAviso(aviso, 'erro', erro.message);
    }
  });
}

async function sair() {
  await api('POST', '/api/logout');
  location.reload();
}

const NOMES_STATUS = { preparacao: 'Em preparação', aberta: 'Votação aberta', encerrada: 'Votação encerrada' };
