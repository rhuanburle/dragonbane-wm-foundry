// O que as partes do módulo dividem: id, configurações, a conversa com o hub e a
// fila que impede duas sincronizações de se cruzarem.
//
// A chave do mestre fica no escopo `client` (só neste navegador): o mundo é
// compartilhado com os jogadores, e uma chave no escopo `world` seria lida por
// qualquer um que abrisse o console.

export const MOD = "dragonbane-wm-mesa";
export const HUB_PADRAO = "https://dragonbane-west-marches.web.app";

export function registrarConfiguracoes() {
  game.settings.register(MOD, "chave", { scope: "client", config: false, type: String, default: "" });
  game.settings.register(MOD, "hub", {
    name: "Endereço do hub",
    hint: "Só mude se for testar com outro hub. A API da mesa é <hub>/api/mesa.",
    scope: "world",
    config: true,
    type: String,
    default: HUB_PADRAO,
  });
  game.settings.register(MOD, "callId", { scope: "world", config: false, type: String, default: "" });
  game.settings.register(MOD, "mapaLigado", { scope: "world", config: false, type: Boolean, default: false });
  // Heróis que o mestre excluiu da mesa: { callId, ids: [heroId] }. Vale só para
  // a missão em que foram excluídos — trocar de missão começa a lista do zero.
  game.settings.register(MOD, "excluidos", { scope: "world", config: false, type: Object, default: { callId: "", ids: [] } });
}

/** heroIds excluídos da missão escolhida agora. */
export function excluidos() {
  const e = cfg("excluidos") ?? {};
  return e.callId === cfg("callId") && Array.isArray(e.ids) ? e.ids : [];
}

/** Marca (ou desmarca) um herói como excluído da missão escolhida. */
export async function marcarExcluido(heroId, excluir) {
  const ids = new Set(excluidos());
  if (excluir) ids.add(heroId);
  else ids.delete(heroId);
  await gravarCfg("excluidos", { callId: cfg("callId"), ids: [...ids] });
}

export const cfg = (k) => game.settings.get(MOD, k);
export const gravarCfg = (k, v) => game.settings.set(MOD, k, v);

export const hub = () => String(cfg("hub") || HUB_PADRAO).replace(/\/+$/, "");

/** Opções de escrita que marcam "fomos nós" — os hooks ignoram para não fazer eco.
 *  Um objeto NOVO a cada escrita: o Foundry 14 grava `parent` e companhia dentro
 *  das opções, e um objeto reaproveitado levava o pai de um item para a escrita
 *  seguinte do ator ("Actor is not a valid embedded Document within the Actor"). */
export const doSync = () => ({ [MOD]: { sync: true } });
export const ehDoSync = (options) => options?.[MOD]?.sync === true;

/** Só o mestre ativo fala com o hub: com dois mestres logados no mesmo mundo,
 *  os dois criariam o mesmo ator e mandariam o mesmo dano duas vezes. */
export function souGmAtivo() {
  const ativo = game.users?.activeGM;
  return ativo ? ativo.isSelf : game.user?.isGM === true;
}

export class ErroDaMesa extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Uma ação da API da mesa (functions: mesa). */
export async function mesa(acao, corpo = {}, chave = cfg("chave")) {
  if (!chave) throw new ErroDaMesa("Cole a sua chave de mestre (Perfil do hub) — digite /wm no chat.", 401);
  const r = await fetch(`${hub()}/api/mesa`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-wm-chave": chave },
    body: JSON.stringify({ acao, origem: "foundry", ...corpo }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroDaMesa(String(b.error ?? `O hub respondeu ${r.status}.`), r.status);
  return b;
}

/** Uma sincronização por vez. O laço e os botões da janela se cruzam: rodando
 *  juntas, as duas criariam o mesmo ator/carimbo duas vezes. Chamada durante
 *  outra espera ela acabar; várias nesse meio viram UMA (e `forcar` de qualquer
 *  uma delas vale para essa). Mesma ideia do `umPorVez` da extensão do Owlbear. */
export function umPorVez(fn) {
  let fila = Promise.resolve();
  let esperando = false;
  let forcar = false;
  return (f = false) => {
    forcar ||= f;
    if (esperando) return fila;
    esperando = true;
    fila = fila
      .catch(() => undefined)
      .then(() => {
        esperando = false;
        const agora = forcar;
        forcar = false;
        return fn(agora);
      });
    return fila;
  };
}

/** Link de imagem que o Foundry aceita como `img` (o DoDActor recusa o ator
 *  inteiro com uma URL sem extensão de imagem). Mesma regra do pull.js antigo. */
export function imagemValida(url) {
  if (typeof url !== "string") return false;
  const t = url.trim();
  return /^https?:\/\//i.test(t) && /\.(png|jpe?g|webp|gif|svg|avif|bmp|tiff?|apng)$/i.test(t.split(/[?#]/)[0]);
}

export const avisar = (msg, tipo = "info") => ui.notifications?.[tipo]?.(`West Marches: ${msg}`);
