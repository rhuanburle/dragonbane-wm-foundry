// A janela do /wm: conectar a chave do mestre, escolher a missão e a paleta do
// mapa. ApplicationV2 cru (sem Handlebars): existe do v12 ao v14 sem mudar.
import { CREDITO_DA_ARTE, GRUPOS, PALETA, arteDaPeca } from "../../../src/data/mapa/paleta";
import { MOD, avisar, cfg, gravarCfg, hub, mesa } from "./comum.js";
import { sincronizarFichas, ultimaMesa } from "./fichas.js";
import { cenaDoMapa, escolherFerramenta, ferramentaAtual, ligarMapa, sincronizarMapa } from "./mapa.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);


const CSS = `
.wm-mesa .window-content { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
.wm-mesa section { border: 1px solid var(--color-border-light-tertiary, #8884); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.wm-mesa h3 { margin: 0; border: 0; font-size: 1.05em; }
.wm-mesa .linha { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.wm-mesa .linha > input[type=text], .wm-mesa .linha > input[type=password], .wm-mesa .linha > select { flex: 1; min-width: 0; }
.wm-mesa .muted { opacity: .75; font-size: .9em; }
.wm-mesa .erro { color: #c0392b; }
.wm-mesa ul { margin: 0; padding-left: 18px; }
.wm-mesa .pecas { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 4px; }
.wm-mesa .peca { padding: 2px; height: auto; line-height: 1; background: #0001; border: 2px solid transparent; }
.wm-mesa .peca.on, .wm-mesa .on { border-color: #d48a1e; }
.wm-mesa .peca img { width: 44px; height: 44px; border: 0; }
.wm-mesa button { flex: 0 0 auto; width: auto; }
`;

let quemSou = null;
let erro = "";
let aba = "floresta";
let rot = 0;

export class JanelaDaMesa extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "wm-mesa",
    classes: ["wm-mesa"],
    window: { title: "West Marches — Mesa", resizable: true },
    position: { width: 440, height: 640 },
  };

  static #aberta = null;

  static abrir() {
    if (!game.user.isGM) {
      avisar("a mesa do West Marches é do mestre. A sua ficha está no hub.", "warn");
      return;
    }
    JanelaDaMesa.#aberta ??= new JanelaDaMesa();
    JanelaDaMesa.#aberta.render({ force: true });
    if (cfg("chave") && !quemSou) void JanelaDaMesa.conectar(cfg("chave"));
  }

  static redesenhar() {
    if (JanelaDaMesa.#aberta?.rendered) JanelaDaMesa.#aberta.render();
  }

  static async conectar(chave) {
    try {
      quemSou = await mesa("quemSou", {}, chave);
      erro = "";
      if (chave !== cfg("chave")) await gravarCfg("chave", chave);
      void sincronizarFichas().catch(() => undefined);
    } catch (e) {
      quemSou = null;
      erro = e.message;
    }
    JanelaDaMesa.redesenhar();
  }

  async _renderHTML() {
    const div = document.createElement("div");
    div.innerHTML = `<style>${CSS}</style>${this.#conexao()}${this.#missao()}${this.#mapa()}`;
    return div;
  }

  _replaceHTML(resultado, conteudo) {
    conteudo.replaceChildren(...resultado.childNodes);
  }

  #conexao() {
    const status = quemSou
      ? `Conectado como <b>${esc(quemSou.mestre?.nome)}</b>.`
      : cfg("chave")
        ? "Chave guardada, conferindo…"
        : `Gere a chave no Perfil do hub (<a href="${esc(hub())}/perfil" target="_blank">${esc(hub())}</a>) e cole aqui. Ela fica só neste navegador.`;
    return `<section>
      <h3>Chave do mestre</h3>
      <div class="linha"><input type="password" name="chave" placeholder="wm_…" value="${esc(cfg("chave"))}" autocomplete="off"><button type="button" data-acao="conectar">Conectar</button></div>
      <span class="muted">${status}</span>
      ${erro ? `<span class="erro">${esc(erro)}</span>` : ""}
    </section>`;
  }

  #missao() {
    if (!quemSou) return "";
    const callId = cfg("callId");
    const chamados = quemSou.chamados ?? [];
    const opcoes = chamados
      .map((c) => {
        const quando = c.quando ? new Date(c.quando).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "sem data";
        const de = c.meu ? "" : " (de outro mestre)";
        return `<option value="${esc(c.id)}" ${c.id === callId ? "selected" : ""}>${esc(c.titulo)} — ${esc(quando)}${de}</option>`;
      })
      .join("");
    const mesaAtual = ultimaMesa?.chamado?.id === callId ? ultimaMesa : null;
    const herois = (mesaAtual?.herois ?? [])
      .map((h) => {
        const f = h.ficha;
        const pv = f ? ` — PV ${f.hp?.value ?? "?"}/${f.hp?.max ?? "?"} · PD ${f.wp?.value ?? "?"}/${f.wp?.max ?? "?"}` : " — sem ficha";
        const nota = !h.fichaNoHub ? " (ficha ainda no Foundry antigo: PV/PD não voltam)" : h.estado !== "alive" ? " (caído)" : "";
        return `<li>${esc(h.nome)}${esc(pv)}${esc(nota)}</li>`;
      })
      .join("");
    return `<section>
      <h3>Missão</h3>
      ${
        chamados.length
          ? `<div class="linha"><select name="callId"><option value="">— escolha —</option>${opcoes}</select><button type="button" data-acao="importar">Importar agora</button></div>`
          : `<span class="muted">Nenhuma missão confirmada sua no hub. O mapa da região, abaixo, funciona mesmo assim.</span>`
      }
      ${callId ? (herois ? `<ul>${herois}</ul>` : `<span class="muted">Buscando os heróis…</span>`) : ""}
      <span class="muted">Os heróis entram na pasta "West Marches" e se atualizam sozinhos a cada 10 s. PV e PD mexidos aqui voltam para o hub; o resto se mexe na ficha do hub.</span>
    </section>`;
  }

  #mapa() {
    if (!quemSou) return "";
    const ligado = cfg("mapaLigado");
    const f = ferramentaAtual();
    const pecas = PALETA.filter((p) => p.grupo === aba)
      .map((p) => {
        const on = f?.tipo === "peca" && f.id === p.id;
        const giro = rot ? `style="transform: rotate(${rot}deg)"` : "";
        return `<button type="button" class="peca ${on ? "on" : ""}" title="${esc(p.nome)}" data-peca="${esc(p.id)}"><img src="${esc(hub() + arteDaPeca(p.id))}" alt="" ${giro}></button>`;
      })
      .join("");
    const dica = f
      ? f.tipo === "borracha"
        ? "Borracha armada: clique no hex (apaga o carimbo de cima). Esc solta."
        : "Clique nos hexes da cena para carimbar. Esc solta a ferramenta."
      : "Escolha uma peça e clique no hex. Os carimbos vêm travados; destravar e apagar (Delete) também apaga no hub.";
    return `<section>
      <h3>Mapa da região</h3>
      <label class="linha"><input type="checkbox" name="mapaLigado" ${ligado ? "checked" : ""}> Ter o mapa da região neste mundo (é o mesmo de todos os mestres)</label>
      ${
        ligado
          ? `<div class="linha"><button type="button" data-acao="abrirCena" ${cenaDoMapa() ? "" : "disabled"}>Abrir a cena</button><button type="button" data-acao="atualizarMapa">Atualizar</button></div>
      <div class="linha">${GRUPOS.map(({ id, nome }) => `<button type="button" data-aba="${id}" class="${aba === id ? "on" : ""}">${nome}</button>`).join("")}</div>
      <div class="pecas">${pecas}</div>
      <div class="linha"><span class="muted">Girar</span><button type="button" data-girar="-60">⟲</button><button type="button" data-girar="60">⟳</button><span>${rot}°</span></div>
      <div class="linha"><input type="text" name="texto" maxlength="60" placeholder="Nome do lugar" value="${f?.tipo === "texto" ? esc(f.texto) : ""}"><button type="button" data-acao="texto" class="${f?.tipo === "texto" ? "on" : ""}">Rótulo</button></div>
      <div class="linha"><button type="button" data-acao="borracha" class="${f?.tipo === "borracha" ? "on" : ""}">Borracha</button><button type="button" data-acao="soltar" ${f ? "" : "disabled"}>Soltar</button></div>
      <span class="muted">${dica}</span>
      <span class="muted">${esc(CREDITO_DA_ARTE)}</span>`
          : ""
      }
    </section>`;
  }

  _onRender() {
    const el = this.element;
    const valor = (n) => el.querySelector(`[name="${n}"]`)?.value?.trim() ?? "";
    el.querySelector('[data-acao="conectar"]')?.addEventListener("click", () => void JanelaDaMesa.conectar(valor("chave")));
    el.querySelector('[name="callId"]')?.addEventListener("change", async (e) => {
      await gravarCfg("callId", e.target.value);
      this.render();
      void sincronizarFichas().catch((err) => avisar(err.message, "error"));
    });
    el.querySelector('[data-acao="importar"]')?.addEventListener("click", () =>
      sincronizarFichas()
        .then(() => avisar("heróis atualizados."))
        .catch((err) => avisar(err.message, "error")),
    );
    el.querySelector('[name="mapaLigado"]')?.addEventListener("change", (e) =>
      ligarMapa(e.target.checked)
        .catch((err) => avisar(err.message, "error"))
        .finally(() => this.render()),
    );
    el.querySelector('[data-acao="abrirCena"]')?.addEventListener("click", () => void cenaDoMapa()?.view());
    el.querySelector('[data-acao="atualizarMapa"]')?.addEventListener("click", () =>
      sincronizarMapa(true)
        .then(() => this.render())
        .catch((err) => avisar(err.message, "error")),
    );
    for (const b of el.querySelectorAll("[data-aba]"))
      b.addEventListener("click", () => {
        aba = b.dataset.aba;
        this.render();
      });
    for (const b of el.querySelectorAll("[data-peca]"))
      b.addEventListener("click", () => {
        const f = ferramentaAtual();
        escolherFerramenta(f?.tipo === "peca" && f.id === b.dataset.peca ? null : { tipo: "peca", id: b.dataset.peca, rot });
      });
    for (const b of el.querySelectorAll("[data-girar]"))
      b.addEventListener("click", () => {
        rot = (rot + Number(b.dataset.girar) + 360) % 360;
        const f = ferramentaAtual();
        if (f?.tipo === "peca") escolherFerramenta({ ...f, rot });
        else this.render();
      });
    el.querySelector('[data-acao="texto"]')?.addEventListener("click", () => {
      const texto = valor("texto");
      if (!texto) return avisar("escreva o nome do lugar.", "warn");
      escolherFerramenta({ tipo: "texto", texto });
    });
    el.querySelector('[data-acao="borracha"]')?.addEventListener("click", () =>
      escolherFerramenta(ferramentaAtual()?.tipo === "borracha" ? null : { tipo: "borracha" }),
    );
    el.querySelector('[data-acao="soltar"]')?.addEventListener("click", () => escolherFerramenta(null));
  }
}

Hooks.on(`${MOD}.mesa`, () => JanelaDaMesa.redesenhar());
Hooks.on(`${MOD}.ferramenta`, () => JanelaDaMesa.redesenhar());
