# Dragonbane West Marches — Mesa (módulo do Foundry VTT)

Módulo para o mestre da campanha **Dragonbane West Marches** jogar no **próprio Foundry**.

- As **fichas dos heróis vêm do hub**. A ficha oficial mora lá; no Foundry fica uma cópia que se atualiza sozinha.
- **PV e PD voltam para o hub**: dano no token ou na ficha do Foundry vale na ficha oficial.
- O **mapa da região** é o mesmo de todos os mestres. O que você carimbar aqui aparece no hub, no Foundry dos outros mestres e no Owlbear.

> Joga no Owlbear Rodeo? Veja a [extensão do Owlbear](https://github.com/rhuanburle/dragonbane-wm-owlbear).

---

## Antes de começar

| Você precisa de | Observação |
|---|---|
| Foundry VTT **v12, v13 ou v14** | Testado no v14. |
| Sistema **Dragonbane** instalado no mundo | Qualquer versão a partir da 3.0. |
| Conta de **mestre** no hub | <https://dragonbane-west-marches.web.app> |
| Uma **missão confirmada** sua no hub | É dela que vêm os heróis da mesa. |

Os jogadores **não** instalam nada. Só o mestre.

---

## Instalação (uma vez)

1. No Foundry, na tela inicial, abra **Módulos complementares → Instalar módulo**.
2. No campo **URL do manifesto** (embaixo), cole:

   ```
   https://dragonbane-west-marches.web.app/foundry/module.json
   ```

3. Clique em **Instalar**.
4. Abra o seu mundo de Dragonbane e ative o módulo em **Configurações → Gerenciar módulos → Dragonbane West Marches — Mesa**.

Quando sair uma versão nova, o Foundry oferece a atualização na lista de módulos, como qualquer outro módulo.

---

## Conectar com o hub

1. No hub, abra o **Perfil** e procure o cartão **"Sua mesa no VTT"**.
2. Clique para **gerar a chave**. Ela aparece **uma vez só**; copie na hora. Se perder, gere outra (a antiga deixa de valer).
3. No Foundry, digite **`/wm`** no chat, aperte **Shift+M**, clique no **dragão** na barra da esquerda (grupo dos Tokens) ou no botão **West Marches** no topo da aba **Atores**.
4. Cole a chave e clique em **Conectar**. Deve aparecer "Conectado como *seu nome*".

A chave fica guardada **só neste navegador**, nunca no mundo, que os jogadores também leem. Em outro computador, cole de novo.

---

## Jogar uma missão

1. Na janela do `/wm`, escolha a **missão** da sessão.
2. Em alguns segundos os heróis confirmados aparecem na pasta **"West Marches"** da aba Atores, com a ficha completa: idade, atributos, PV, PD, perícias, habilidades, magias, equipamento, dinheiro e condições.
3. Excluir o ator de um herói tira ele **desta missão** (não volta sozinho); a janela do `/wm` lista os excluídos com **trazer de volta**.
4. **Dê a posse do ator ao jogador** (clique direito no ator → Configurar posse) se ele for mexer no próprio token.
4. Jogue normalmente. Os testes rolam no Foundry, como sempre.

### O que vai e o que volta

| Mudou… | Onde vale |
|---|---|
| PV ou PD no Foundry (token ou ficha) | Vai para o hub na hora. |
| Qualquer coisa na ficha do hub (PV, PD, condições, itens, dinheiro, perícias) | Chega ao Foundry em poucos segundos. |
| Itens, condições, dinheiro ou perícias **no Foundry** | **Não volta.** É sobrescrito na próxima atualização do hub. |

Por isso a regra da mesa é: **mexa na ficha pelo hub**. A ficha do hub fica aberta durante o jogo (o jogador marca condições, consome itens, equipa). O Foundry é o lugar da rolagem e do token.

Herói caído, ou cuja ficha ainda não passou para o hub, aparece na mesa mas não aceita PV/PD pelo Foundry. O módulo avisa e devolve o valor do hub. Ajuste pelo hub.

---

## Mapa da região

1. Na janela do `/wm`, marque **"Ter o mapa da região neste mundo"**.
2. O módulo cria a cena **"Mapa da região (West Marches)"** com todos os carimbos do hub. Clique em **Abrir a cena**.
3. Para carimbar: escolha uma peça em **Terreno**, **Caminhos** ou **Marcos** e clique no hex da cena.
   - **⟲ ⟳** giram a peça (estradas e rios).
   - **Rótulo**: escreva o nome do lugar e clique no hex.
   - **Borracha**: clique no hex para apagar o carimbo de cima.
   - **Esc** ou **Soltar** desarmam a ferramenta.
4. O que você carimbar ou apagar vale **para todos os mestres**, no hub e nos outros VTTs.

Os carimbos vêm **travados**, para não serem arrastados sem querer. Apagar um carimbo pelo Foundry (destravar + Delete) também apaga no hub. Mas apagar **muitos de uma vez** (por exemplo, limpar todos os tiles) **não** apaga nada no hub: os carimbos voltam no ciclo seguinte. É uma proteção para o mapa de todos.

---

## Perguntas frequentes

**Os heróis não aparecem.**
Confira se a missão está **confirmada** no hub e se você escolheu a missão certa no `/wm`. Abra o console (F12) e procure mensagens começando com `dragonbane-wm-mesa`.

**Apareceram perícias repetidas.**
O módulo casa as perícias pelo **nome em português** (como no hub). Num mundo com o sistema em outro idioma, ele cria as perícias em português ao lado das que o sistema já pôs. Use o mundo em português.

**"Não achei … neste mundo".**
Ancestralidade, profissão ou item que não existe no seu mundo nem nos compêndios do sistema. O resto da ficha entra normalmente; o item entra como item comum, com o nome e o valor do hub.

**Dois mestres no mesmo mundo?**
Funciona. Só o **mestre ativo** (o primeiro logado) traz as fichas e desenha o mapa. Qualquer mestre com a chave pode carimbar.

**Perdi ou vazou a chave.**
Gere outra no Perfil do hub. A antiga para de funcionar na hora.

---

## Código

`src/` é o código-fonte do módulo e `scripts/main.js` é o módulo pronto (sem minificar, para dar para ler no F12). O empacotamento roda junto com o hub, que reaproveita a paleta e a geometria do mapa. Problemas e sugestões: abra uma *issue* aqui.
