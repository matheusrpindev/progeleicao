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

// Placas de rede "de mentira" criadas por VirtualBox, VMware, WSL, Hyper-V, Docker, VPNs...
// As urnas nunca alcançam o servidor por elas (o VirtualBox, por exemplo, usa 192.168.56.1).
const VIRTUAL = /virtual|vbox|vmware|vmnet|vethernet|hyper-v|wsl|docker|br-|veth|loopback|bluetooth|tailscale|zerotier|hamachi|vpn|tap|tun/i;

// Endereços IPv4 da rede local ({ ip, placa }), do mais provável ao menos provável:
// placas reais antes das virtuais e, entre elas, as faixas de roteadores domésticos.
function enderecosLocais(interfaces = os.networkInterfaces()) {
  const faixa = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  const prioridade = (e) => (VIRTUAL.test(e.placa) ? 10 : 0) + faixa(e.ip);
  return Object.entries(interfaces)
    .flatMap(([placa, lista]) => (lista || []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ ip: i.address, placa })))
    .sort((a, b) => prioridade(a) - prioridade(b));
}

const ipsLocais = () => enderecosLocais().map((e) => e.ip);

function mostrarBanner(porta) {
  const enderecos = enderecosLocais();
  const ips = enderecos.map((e) => e.ip);
  const linha = '='.repeat(78);
  console.log(`\n${linha}\n  SISTEMA DE VOTAÇÃO LIGADO — NÃO FECHE ESTA JANELA\n${linha}\n`);
  if (!ips.length) {
    console.log('  ATENÇÃO: este computador não está conectado a nenhuma rede.');
    console.log('  Ligue o cabo de rede ou o Wi-Fi do roteador e reinicie o sistema.\n');
  } else {
    console.log('  Nas urnas, digite no navegador o endereço:\n');
    console.log(letrasGrandes(`${ips[0]}:${porta}`).replace(/^/gm, '  '));
    console.log(`\n    Endereço completo das urnas:  http://${ips[0]}:${porta}/urna   (placa de rede: ${enderecos[0].placa})`);
    console.log('    (cada urna pede o código de vinculação que aparece na tela do Mesário)');
    if (enderecos.length > 1) {
      console.log('\n  Se as urnas não conectarem, tente os outros endereços deste computador:');
      for (const e of enderecos.slice(1)) console.log(`    http://${e.ip}:${porta}/urna   (placa de rede: ${e.placa})`);
    }
  }
  console.log('\n  Neste computador (mesário):');
  console.log(`    Mesário:    http://localhost:${porta}/mesario`);
  console.log(`    Admin:      http://localhost:${porta}/admin`);
  console.log(`    Resultado:  http://localhost:${porta}/resultado`);
  console.log(`\n${linha}\n`);
}

module.exports = { mostrarBanner, ipsLocais, enderecosLocais };
