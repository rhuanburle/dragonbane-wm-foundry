// Dragonbane West Marches — Mesa. O módulo que cada mestre instala no PRÓPRIO
// Foundry: as fichas vêm do hub (a ficha oficial mora lá), PV e PD voltam, e o
// mapa da região é o mesmo de todos os mestres. Fala com o hub pela chave
// pessoal do mestre (Perfil → "Sua mesa no VTT"), na API /api/mesa.
//
// Fonte em foundry/dragonbane-wm-mesa/src; `npm run build` empacota em
// dist/foundry (module.json + module.zip) junto com o hub.
import { MOD, cfg, registrarConfiguracoes, souGmAtivo } from "./comum.js";
import { sincronizarFichas, vigiarPvPd } from "./fichas.js";
import { JanelaDaMesa } from "./janela.js";
import { prepararCarimbo, sincronizarMapa, vigiarApagados } from "./mapa.js";

// Fichas a cada 3 s: é por aqui que o PV mexido no hub (ou noutro VTT) chega no
// ator. O mapa muda pouco e custa mais: 10 s.
const FICHAS_MS = 3_000;
const MAPA_MS = 10_000;

/** Uma volta do laço: falha de rede não para o laço (o próximo ciclo tenta de
 *  novo) e não vira aviso na tela a cada volta — o erro fica no console. */
const ultimoErro = {};
async function ciclo(nome) {
  if (!game.user.isGM || !cfg("chave")) return;
  // fichas só no mestre ativo; o mapa todo mestre busca (só o ativo escreve)
  const fn = nome === "fichas" ? (souGmAtivo() ? sincronizarFichas : null) : sincronizarMapa;
  if (!fn) return;
  try {
    await fn();
    ultimoErro[nome] = "";
  } catch (e) {
    if (e.message !== ultimoErro[nome]) console.warn(`${MOD} | ${nome}: ${e.message}`);
    ultimoErro[nome] = e.message;
  }
}

Hooks.once("init", () => {
  registrarConfiguracoes();
  game.modules.get(MOD).api = { abrir: () => JanelaDaMesa.abrir() };
  // Atalho para reabrir a janela depois de fechada (dá para trocar em Configurar Atalhos).
  game.keybindings.register(MOD, "abrir", {
    name: "Abrir a mesa do West Marches",
    editable: [{ key: "KeyM", modifiers: ["Shift"] }],
    restricted: true,
    onDown: () => {
      JanelaDaMesa.abrir();
      return true;
    },
  });
});

// Botão na barra da esquerda, no grupo dos Tokens: abre a janela (heróis e as
// peças do mapa para carimbar). Do v13 em diante grupos e ferramentas são
// objetos e o botão usa onChange; até o v12 são listas e usa onClick.
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const tool = {
    name: "wm-mesa",
    title: "West Marches — Mesa (Shift+M)",
    icon: "fas fa-dragon",
    button: true,
    visible: true,
    order: 99,
    onChange: () => JanelaDaMesa.abrir(),
    onClick: () => JanelaDaMesa.abrir(),
  };
  if (Array.isArray(controls)) controls.find((c) => c.name === "token")?.tools.push(tool);
  else if (controls.tokens) controls.tokens.tools[tool.name] = tool;
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  vigiarPvPd();
  vigiarApagados();
  prepararCarimbo();
  void ciclo("fichas");
  void ciclo("mapa");
  setInterval(() => void ciclo("fichas"), FICHAS_MS);
  setInterval(() => void ciclo("mapa"), MAPA_MS);
});

// /wm no chat abre a janela (e não vira mensagem). Do v14 em diante o chat é um
// editor rico e a mensagem chega como HTML ("<p>/wm</p>"), daí tirar as tags.
Hooks.on("chatMessage", (_log, mensagem) => {
  const texto = String(mensagem).replace(/<[^>]*>/g, "").trim();
  if (!/^\/wm\b/i.test(texto)) return;
  JanelaDaMesa.abrir();
  return false;
});

// Um botão no topo da aba de Atores, para quem não lembra do /wm. O hook passa
// jQuery até o v12 e HTMLElement do v13 em diante.
Hooks.on("renderActorDirectory", (_app, html) => {
  if (!game.user.isGM) return;
  const el = html instanceof HTMLElement ? html : html?.[0];
  const onde = el?.querySelector(".header-actions");
  if (!onde || onde.querySelector(".wm-mesa-abrir")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "wm-mesa-abrir";
  b.innerHTML = '<i class="fas fa-dragon"></i> West Marches';
  b.addEventListener("click", () => JanelaDaMesa.abrir());
  onde.append(b);
});
