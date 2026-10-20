# Urna Eletrônica do Grêmio Estudantil

Sistema para a eleição do grêmio da escola: **1 computador servidor** (que também é a mesa do mesário) e **quantos computadores-urna você quiser** (cadastrados no Admin), todos ligados no mesmo roteador. **Não precisa de internet no dia da eleição.**

---

## O que você vai precisar

- 1 computador servidor e 1 computador por urna, com Windows 10 ou 11 e o navegador **Google Chrome**.
- 1 roteador (pode ser um roteador comum de casa) e cabos de rede (ou Wi-Fi do roteador).
- Uma impressora ligada ao computador servidor (para a zerésima e a ata).
- **Internet só uma vez, antes do dia**, para fazer a instalação.

---

## 1. Instalação (faça alguns dias antes, com internet)

Só no **computador servidor**:

1. Acesse **https://nodejs.org**, baixe a versão marcada como **LTS** (22 ou mais nova) e instale clicando em "Próximo" até o fim.
2. Copie a pasta do sistema (`progeleicao`) para o computador, por exemplo para a Área de Trabalho.
3. Abra a pasta e dê dois cliques em **`iniciar.bat`**.
   - Na primeira vez ele instala os componentes (precisa de internet e demora alguns minutos).
   - Se o Windows perguntar se o **Node.js** pode usar a rede, marque **"Redes privadas"** e clique em **Permitir acesso**. Sem isso as urnas não conseguem se conectar.
4. Vai aparecer uma janela preta com o **endereço em letras grandes**, por exemplo `192.168.0.10:3000`. Esse é o endereço que as urnas vão usar.
5. No próprio servidor, abra o Chrome e entre em **http://localhost:3000/admin**.
   - Na primeira vez ele pede para **criar a senha**. Escolha uma senha e **anote em lugar seguro**: ela serve para o Admin, o Mesário e o Resultado e **não tem como recuperar**.

Nos computadores-urna não é preciso instalar nada, só ter o Chrome.

### Cadastrar a eleição (ainda antes do dia)

Em **http://localhost:3000/admin**:

1. Preencha o **nome da escola** e o **nome da eleição** e clique em **Salvar dados**.
2. Cadastre cada chapa: **número com 2 dígitos** (ex.: 10, 25), **nome** e, se quiser, a **foto ou logo**.
3. Na seção **Urnas**, clique em **+ Adicionar urna** uma vez para cada computador que vai receber votos (pode ser 1, 4, 10…). Cada urna ganha um **código de 6 dígitos**.
4. Confira tudo com calma. Depois que a votação for aberta, **nada disso pode ser alterado**.

> Faça um ensaio completo antes do dia (pode votar à vontade). Depois do ensaio, encerre a votação e use **Iniciar nova eleição** no Admin (veja o Passo 6): os votos do ensaio são zerados e as chapas continuam cadastradas.

---

## 2. Ligando tudo no dia

1. Ligue o roteador e conecte o servidor e os computadores-urna nele. **Não deixe outros aparelhos (celulares de alunos etc.) entrarem nessa rede.**
2. No servidor, dê dois cliques em **`iniciar.bat`**. **Não feche essa janela preta durante a eleição.**
3. Anote o endereço que aparece em letras grandes (ex.: `192.168.0.10:3000`).
4. Em **cada urna**, abra o Chrome e digite o endereço das urnas. É o **mesmo endereço para todas**: `http://192.168.0.10:3000/urna` (troque `192.168.0.10` pelo endereço que apareceu na **sua** tela; ele também aparece no Admin, na seção Urnas).
5. **Vincule cada computador à sua urna (só na primeira vez):** a urna mostra "Vincular este computador a uma urna". Abra a tela do **Mesário** no servidor: cada urna sem computador mostra um **código de 6 dígitos**. Digite o código no teclado da urna e aperte **CONFIRMA**.
   - Cada urna aceita **um único computador**: depois de usado, o código deixa de valer, e nenhum outro computador consegue abrir aquela urna.
   - O vínculo fica guardado no Chrome daquele computador e vale para as próximas eleições. Para usar outro computador, veja "Problemas".
6. Aperte **F11** para deixar o Chrome em tela cheia.
   - **Melhor ainda (modo quiosque):** crie um atalho na área de trabalho da urna com o destino abaixo. Assim o eleitor não consegue sair da tela de votação.
     ```
     "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk "http://192.168.0.10:3000/urna"
     ```
     Para sair do modo quiosque: **Alt + F4**.
7. Nas configurações de energia do Windows das urnas, coloque **"Desligar a tela: Nunca"** e **"Suspender: Nunca"**.
8. Ligue o som (caixinha ou alto-falante) das urnas: o "piiii" de confirmação ajuda o mesário a saber que o voto terminou.

Cada urna deve mostrar **"A votação ainda não foi aberta"** e, no cantinho de baixo, **"online"**.

---

## 3. Conduzindo a eleição

### Passo 1: Zerésima (antes de abrir)
No **Admin**, clique em **1. Emitir zerésima**. Abre um relatório mostrando que todas as urnas estão com **0 votos**. Clique em **Imprimir zerésima** e peça para o presidente da comissão, o mesário e os fiscais assinarem.

### Passo 2: Abrir a votação
No **Admin**, clique em **2. Abrir votação**. As urnas passam a mostrar **"Aguardando liberação do mesário"**.

### Passo 3: Liberar cada voto
Abra a tela do **Mesário**: **http://localhost:3000/mesario**. Ela mostra todas as urnas e o **total de votantes**.

Para cada pessoa que chegar:
1. Indique uma urna que esteja **Livre**.
2. Clique em **Liberar voto** daquela urna, ou aperte a tecla **"** (aspas) no teclado do servidor: ela libera a **próxima urna livre** e aparece em letras grandes "URNA 2 LIBERADA", para você indicar ao eleitor. No teclado brasileiro é a tecla logo abaixo do Esc; não precisa segurar o Shift. A urna mostra a tela de votação.
3. O eleitor digita o número da chapa (aparecem o nome e a foto) e aperta **CONFIRMA** (verde).
   - **BRANCO**: vota em branco.
   - **CORRIGE** (laranja): apaga e começa de novo.
   - Número que não existe: aparece **VOTO NULO**. Se confirmar, conta como nulo.
4. Toca o som de confirmação, aparece **FIM** e a urna volta a ficar bloqueada.

**Liberar na própria urna:** a mesma tecla **"** (aspas) apertada no teclado do computador da urna, quando ela mostra "Aguardando liberação do mesário", libera um novo voto ali mesmo. Ela não faz nada no meio de um voto nem na tela FIM. Atenção: o eleitor também usa esse teclado e poderia apertar a tecla depois de votar, então use só com o mesário acompanhando a urna. O painel do mesário mostra quantas liberações foram feitas assim em cada urna. Para desligar, desmarque a opção na seção **Urnas** do Admin.

Cada liberação vale **um único voto**. O mesário vê **quantos** votos cada urna recebeu, **nunca em quem**.

O que significa cada situação no painel:

| Situação | Significado |
|---|---|
| **Livre** | Urna bloqueada, pronta para a próxima liberação. |
| **Aguardando eleitor** | Liberada, ninguém digitou nada ainda. |
| **Votando** | O eleitor está digitando. |
| **Desconectada** | A urna não está falando com o servidor (veja "Problemas"). |
| **Sem computador** | Nenhum computador foi vinculado ainda: digite o código mostrado no computador da urna. |

### Passo 4: Encerrar
Quando o último eleitor terminar, no **Admin** clique em **3. Encerrar votação**.
Se alguma urna ainda estiver liberada, o sistema avisa. O ideal é esperar o eleitor terminar. Se ninguém vai usar aquela liberação, dá para encerrar assim mesmo, e a ata vai registrar "liberação sem voto".

### Passo 5: Resultado e ata
Abra **http://localhost:3000/resultado** (só funciona depois de encerrar):
- Mostra a **chapa vencedora** (com quantos votos teve e a porcentagem dos votos válidos), o **boletim de cada urna** e o **total geral**. Votos válidos são os dados a chapas: brancos e nulos não contam. Se duas chapas empatarem em primeiro, aparece **EMPATE**, e o desempate segue o regulamento da eleição.
- A **conferência** precisa estar **verde** ("Conferência OK"). Se aparecer aviso amarelo ou vermelho, leia a mensagem: normalmente é uma urna que ficou desconectada com voto guardado (veja abaixo).
- Clique em **Verificar integridade**: precisa aparecer **"Integridade OK"**. Se aparecer **ADULTERADO**, alguém mexeu no banco de dados por fora do sistema.
- Clique em **Imprimir ata** e colha as assinaturas.
- **Exportar CSV** (abre no Excel) e **Exportar JSON** guardam o resultado em arquivo.

Ao final, copie a pasta **`dados`** inteira para um pendrive. Ela tem o banco da eleição (`eleicao.db`), o backup e as eleições anteriores (`arquivo/`).

### Passo 6: Nova eleição (quando precisar)
Para fazer outra eleição (um segundo turno, a eleição do ano seguinte, ou começar de novo depois do ensaio):
1. Com a votação **encerrada**, imprima a ata e exporte o resultado.
2. No **Admin**, aparece o quadro **Nova eleição**. Marque **"Apagar também as chapas"** só se as chapas forem outras.
3. Digite a senha e clique em **Iniciar nova eleição**.

Uma cópia completa da eleição anterior fica guardada em `dados/arquivo/` (um arquivo com a data e a hora). A senha e os nomes da escola e da eleição continuam (dá para editar). Os votos e as liberações voltam a zero, e o caminho recomeça pela **zerésima**.
Se alguma urna ficou com uma liberação sem voto, o sistema avisa antes: se ela estava desconectada, ligue-a na rede primeiro para enviar algum voto que tenha ficado guardado nela.

---

## 4. Problemas e o que fazer

**Uma urna mostra "offline" ou aparece "Desconectada" no mesário**
- Verifique o cabo de rede ou o Wi-Fi dessa urna e se o roteador está ligado.
- Assim que a rede voltar, a urna se reconecta **sozinha**. Não precisa fazer nada.
- Se o eleitor votou enquanto a urna estava offline, o voto **fica guardado na urna** (aparece "1 voto(s) aguardando envio") e é enviado automaticamente quando a rede voltar. **Não apague o histórico do navegador da urna.**

**Uma urna travou ou a tela ficou estranha**
- Aperte **F5** (ou feche e abra o Chrome no mesmo endereço). A urna volta ao estado certo. Se ela estava liberada, continua liberada. Nenhum voto confirmado se perde.
- Se o computador da urna quebrou de vez: na tela do **Mesário**, clique em **Trocar computador** naquela urna. Aparece um código novo; abra o endereço das urnas no computador substituto e digite o código. O computador antigo deixa de funcionar como urna. Atenção: se a urna quebrada tinha um voto "aguardando envio", ele só é recuperado ligando aquela máquina na rede e vinculando-a de novo **à mesma urna**.

**Na urna aparece "conexão recusada" ou "não é possível acessar esse site"**
- Na urna, **nunca use `localhost`**: `localhost` quer dizer "este próprio computador", e o sistema roda no servidor. Use o IP do servidor, que aparece em letras grandes na janela preta e no Admin (ex.: `http://192.168.0.15:3000/urna`).
- Se mesmo com o IP não abrir:
  1. No servidor, mude o perfil da rede para **Privada** (Configurações → Rede e Internet → clique na rede). Ou, no **Firewall do Windows Defender → Permitir um aplicativo**, marque **Node.js** em **Privada** e **Pública**.
  2. Confira se o servidor e as urnas estão ligados **no mesmo roteador**.
  3. Redes de escola e de governo costumam impedir que um computador fale com o outro. Use um roteador próprio, sem internet, só para a eleição.

**A urna pede o código de vinculação de novo**
- Alguém clicou em "Trocar computador", ou o histórico do Chrome daquele computador foi apagado. Digite o código que aparece no Mesário para aquela urna.

**Apareceu "Esta urna foi aberta em outra aba deste computador"**
- A urna foi aberta duas vezes no mesmo computador. Feche a janela antiga. Só a última aberta funciona.

**A janela preta do servidor foi fechada, ou o servidor desligou ou travou**
- Ligue o computador e dê dois cliques em **`iniciar.bat`** de novo. Tudo continua de onde parou: votos, liberações e situação da votação ficam gravados.
- Nas urnas, se aparecer uma página de erro do Chrome, aperte **F5** depois que o servidor voltar.
- No Mesário e no Admin, digite a senha de novo.

**O endereço mudou depois de reiniciar o roteador**
- Veja o novo endereço na janela preta do servidor e abra as urnas de novo com ele.

**"A porta 3000 já está em uso"**
- O sistema já está aberto em outra janela preta. Use aquela, ou feche as duas e abra de novo.

**Esqueci a senha**
- Não tem como recuperar. Antes da eleição: feche o sistema, renomeie a pasta `dados` (por exemplo para `dados-antigo`) e cadastre tudo de novo, criando outra senha. **Durante a eleição, não mexa em nada**: chame o responsável técnico.

---

## Informações técnicas

- `npm install` e depois `npm start` (o mesmo que o `iniciar.bat` faz). A porta pode ser trocada com a variável `PORT`.
- `npm test` roda o **teste de concorrência**: sobe um servidor temporário, cadastra e vincula 4 urnas e simula as 4 votando ao mesmo tempo (500 votações, com reenvios duplicados, quedas de conexão e queda do servidor no meio) e confere se a contagem final bate exatamente.
- Dados em `dados/`: `eleicao.db` (SQLite em modo WAL), `fotos/`, `arquivo/` (cópias das eleições anteriores, feitas por "Iniciar nova eleição") e `backup/eleicao-backup.db` (substituído a cada minuto em que houve voto, e também ao ligar o sistema, ao abrir e ao encerrar a votação).
- **Sigilo do voto:** a tabela `votos` guarda só um id aleatório (UUID gerado na urna), a urna e a escolha, além dos hashes do encadeamento. Não tem horário nem número sequencial (`WITHOUT ROWID`). A cadeia de hash segue a ordem do id aleatório, não a ordem de chegada, então não revela a sequência dos eleitores. As liberações ficam em outra tabela, só como contadores. Pelo mesmo motivo, o backup é um único arquivo substituído, e não uma série de cópias que poderiam ser comparadas entre si.
- **Sons da urna:** gerados pelo navegador (Web Audio), sem arquivos: um bip por tecla e o "pililili" na confirmação. Para usar gravações do som original, coloque `tecla.mp3` e `confirma.mp3` na pasta `public/urna/sons/` (veja o `LEIA-ME.txt` de lá).
- **Vínculo das urnas:** cada urna tem um código de 6 dígitos de uso único. O computador que digita o código recebe um token secreto, guardado no navegador dele; o servidor guarda só o hash desse token e recusa qualquer outro computador naquela urna. Depois de 5 códigos errados, aquele computador espera 1 minuto para tentar de novo.
- **Integridade:** cada voto guarda o hash do anterior, e o hash final também fica gravado à parte e sai impresso na ata. A verificação recalcula a cadeia inteira.
