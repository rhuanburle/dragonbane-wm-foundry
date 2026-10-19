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

const CICLO_MS = 10_000;

/** Uma volta do laço: falha de rede não para o laço (o próximo ciclo tenta de
 *  novo) e não vira aviso na tela a cada 10 s — o erro fica no console. */
let ultimoErro = "";
async function ciclo() {
  if (!game.user.isGM || !cfg("chave")) return;
  // fichas só no mestre ativo; o mapa todo mestre busca (só o ativo escreve)
  for (const [nome, fn] of [
    ["fichas", souGmAtivo() ? sincronizarFichas : null],
    ["mapa", sincronizarMapa],
  ]) {
    if (!fn) continue;
    try {
      await fn();
    } catch (e) {
      const msg = `${nome}: ${e.message}`;
      if (msg !== ultimoErro) console.warn(`${MOD} | ${msg}`);
      ultimoErro = msg;
    }
  }
}

Hooks.once("init", () => {
  registrarConfiguracoes();
  game.modules.get(MOD).api = { abrir: () => JanelaDaMesa.abrir() };
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  vigiarPvPd();
  vigiarApagados();
  prepararCarimbo();
  void ciclo();
  setInterval(() => void ciclo(), CICLO_MS);
});

// /wm no chat abre a janela (e não vira mensagem).
Hooks.on("chatMessage", (_log, mensagem) => {
  if (!/^\/wm\b/i.test(String(mensagem).trim())) return;
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
