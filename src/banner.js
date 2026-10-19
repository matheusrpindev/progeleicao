const os = require('os');

// Letras grandes (5 linhas) para os caracteres de um endereço IP com porta.
const FONTE = {
  0: ['█████', '█   █', '█   █', '█   █', '█████'],
  1: ['  █  ', ' ██  ', '  █  ', '  █  ', ' ███ '],
  2: ['█████', '    █', '█████', '█    ', '█████'],
  3: ['█████', '    █', ' ████', '    █', '█████'],
  4: ['█   █', '█   █', '█████', '    █', '    █'],
  5: ['█████', '█    ', '█████', '    █', '█████'],
  6: ['█████', '█    ', '█████', '█   █', '█████'],
  7: ['█████', '    █', '   █ ', '  █  ', '  █  '],
  8: ['█████', '█   █', '█████', '█   █', '█████'],
  9: ['█████', '█   █', '█████', '    █', '█████'],
  '.': ['  ', '  ', '  ', '  ', '██'],
  ':': ['  ', '██', '  ', '██', '  '],
};

const letrasGrandes = (texto) =>
  [0, 1, 2, 3, 4].map((linha) => [...texto].map((c) => FONTE[c]?.[linha] ?? ' ').join(' ')).join('\n');

// IPv4 da rede local, priorizando as faixas usadas por roteadores domésticos.
function ipsLocais() {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  const prioridade = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return ips.sort((a, b) => prioridade(a) - prioridade(b));
}

function mostrarBanner(porta, numUrnas) {
  const ips = ipsLocais();
  const linha = '='.repeat(78);
  console.log(`\n${linha}\n  SISTEMA DE VOTAÇÃO LIGADO — NÃO FECHE ESTA JANELA\n${linha}\n`);
  if (!ips.length) {
    console.log('  ATENÇÃO: este computador não está conectado a nenhuma rede.');
    console.log('  Ligue o cabo de rede ou o Wi-Fi do roteador e reinicie o sistema.\n');
  } else {
    console.log('  Nas urnas, digite no navegador o endereço:\n');
    console.log(letrasGrandes(`${ips[0]}:${porta}`).replace(/^/gm, '  '));
    console.log('');
    for (let i = 1; i <= numUrnas; i++) console.log(`    Urna ${i}:  http://${ips[0]}:${porta}/urna?id=${i}`);
    if (ips.length > 1) console.log(`\n  (Outros endereços deste computador: ${ips.slice(1).join(', ')})`);
  }
  console.log('\n  Neste computador (mesário):');
  console.log(`    Mesário:    http://localhost:${porta}/mesario`);
  console.log(`    Admin:      http://localhost:${porta}/admin`);
  console.log(`    Resultado:  http://localhost:${porta}/resultado`);
  console.log(`\n${linha}\n`);
}

module.exports = { mostrarBanner };
