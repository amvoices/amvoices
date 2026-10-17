
"use strict";

// Amazon Voices Radio — Player com playlist de vários áudios.

const API = {
  faixas: "/api/faixas-horarias",
  programas: "/api/programas"
};

const FUSO_HORARIO = "America/Manaus";

const el = {
  audio: document.getElementById("audio-radio"),
  botao: document.getElementById("botao-play"),
  icone: document.getElementById("icone-play"),
  texto: document.getElementById("texto-play"),
  status: document.getElementById("status-audio"),
  programa: document.getElementById("programa-atual"),
  descricao: document.getElementById("descricao-programa"),
  inicio: document.getElementById("horario-inicio"),
  fim: document.getElementById("horario-fim"),
  lista: document.getElementById("lista-programacao"),
  data: document.getElementById("data-programacao"),
  ano: document.getElementById("ano-atual")
};

let faixas = [];
let programas = [];
let faixaEmReproducao = null;
let playlistAtual = [];
let indiceAtual = 0;
let tocando = false;
let carregando = false;
let modoTeste = false;
let verificacaoHorario = null;

function status(mensagem) {
  if (el.status) el.status.textContent = mensagem;
}

function normalizar(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function escapar(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, caractere => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[caractere]);
}

function estaAtivo(item) {
  return item?.ativo !== false &&
    item?.ativo !== 0 &&
    item?.ativo !== "false";
}

async function buscarJSON(url) {
  const resposta = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  if (!resposta.ok) {
    throw new Error(`${url}: HTTP ${resposta.status}`);
  }

  const dados = await resposta.json();

  if (Array.isArray(dados)) return dados;
  if (Array.isArray(dados?.dados)) return dados.dados;
  if (Array.isArray(dados?.programas)) return dados.programas;

  return [];
}

function partesHora() {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO_HORARIO,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const obter = tipo =>
    partes.find(p => p.type === tipo)?.value ?? "00";

  const dias = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3,
    Thu: 4, Fri: 5, Sat: 6
  };

  return {
    dia: dias[obter("weekday")],
    hora: obter("hour"),
    minuto: obter("minute"),
    segundo: obter("second")
  };
}

function segundosAtuais() {
  const p = partesHora();

  return Number(p.hora) * 3600 +
    Number(p.minuto) * 60 +
    Number(p.segundo);
}

function diaCorresponde(dia) {
  if (dia === null || dia === undefined || dia === "") {
    return true;
  }

  const atual = partesHora().dia;

  if (typeof dia === "number" || /^\d+$/.test(String(dia))) {
    return Number(dia) === atual;
  }

  const nomes = {
    domingo: 0, dom: 0, sunday: 0,
    segunda: 1, "segunda-feira": 1, seg: 1, monday: 1,
    terca: 2, "terca-feira": 2, ter: 2, tuesday: 2,
    quarta: 3, "quarta-feira": 3, qua: 3, wednesday: 3,
    quinta: 4, "quinta-feira": 4, qui: 4, thursday: 4,
    sexta: 5, sex: 5, friday: 5,
    sabado: 6, sab: 6, saturday: 6
  };

  return nomes[normalizar(dia)] === atual;
}

function paraSegundos(hora) {
  const resultado = String(hora ?? "").match(/^(\d{1,2}):(\d{2})/);

  if (!resultado) return null;

  return Number(resultado[1]) * 3600 +
    Number(resultado[2]) * 60;
}

function horarioValido(faixa) {
  const inicio = paraSegundos(faixa.inicio);
  const fim = paraSegundos(faixa.fim);
  const agora = segundosAtuais();

  if (inicio === null || fim === null || inicio === fim) {
    return false;
  }

  if (inicio < fim) {
    return agora >= inicio && agora < fim;
  }

  // Também aceita horários que atravessam a meia-noite.
  return agora >= inicio || agora < fim;
}

function encontrarFaixaAtiva() {
  return faixas.find(faixa =>
    estaAtivo(faixa) &&
    diaCorresponde(faixa.diaSemana ?? faixa.dia_semana) &&
    horarioValido(faixa) &&
    Array.isArray(faixa.playlist) &&
    faixa.playlist.some(item => estaAtivo(item) && obterAudio(item))
  ) ?? null;
}

function obterAudio(item) {
  const url =
    item?.audioUrl ??
    item?.url_audio ??
    item?.url ??
    item?.audio ??
    "";

  if (typeof url !== "string" || !url.trim()) return "";

  try {
    const endereco = new URL(url.trim(), window.location.origin);

    if (!["http:", "https:"].includes(endereco.protocol)) {
      return "";
    }

    return endereco.href;
  } catch {
    return "";
  }
}

function prepararPlaylist(faixa) {
  if (!faixa || !Array.isArray(faixa.playlist)) return [];

  return faixa.playlist
    .filter(item => estaAtivo(item) && obterAudio(item))
    .sort((a, b) => Number(a.ordem ?? 0) - Number(b.ordem ?? 0))
    .map(item => ({
      nome: item.titulo ?? item.nome ?? "Áudio da rádio",
      descricao: item.descricao ?? "",
      audio: obterAudio(item)
    }));
}

function atualizarBotao() {
  if (el.texto) {
    el.texto.textContent = tocando ? "PAUSAR" : "OUVIR AGORA";
  }

  if (el.icone) {
    el.icone.textContent = tocando ? "❚❚" : "▶";
  }

  if (el.botao) {
    el.botao.setAttribute(
      "aria-label",
      tocando ? "Pausar rádio" : "Ouvir rádio"
    );
  }
}

function atualizarInformacoes(faixa, item) {
  if (el.programa) {
    el.programa.textContent =
      item?.nome ?? faixa?.nome ?? "Amazon Voices";
  }

  if (el.descricao) {
    el.descricao.textContent =
      item?.descricao || faixa?.descricao ||
      "Você está ouvindo a Amazon Voices Radio.";
  }

  if (el.inicio) el.inicio.textContent = faixa?.inicio ?? "--:--";
  if (el.fim) el.fim.textContent = faixa?.fim ?? "--:--";
}

function renderizarProgramacao() {
  if (!el.lista) return;

  const ordenadas = [...faixas]
    .filter(estaAtivo)
    .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));

  if (!ordenadas.length) {
    el.lista.innerHTML =
      '<p class="programacao-vazia">Nenhuma faixa horária cadastrada.</p>';
    return;
  }

  el.lista.innerHTML = ordenadas.map(faixa => {
    const quantidade = prepararPlaylist(faixa).length;
    const dia = faixa.diaSemana ?? faixa.dia_semana;
    const nomeDia = dia === null || dia === undefined
      ? "Todos os dias"
      : ["Domingo", "Segunda", "Terça", "Quarta",
         "Quinta", "Sexta", "Sábado"][Number(dia)] ?? "";

    return `
      <div class="item-programacao">
        <div class="item-programacao-horario">
          ${escapar(faixa.inicio)} – ${escapar(faixa.fim)}
        </div>
        <div class="item-programacao-conteudo">
          <strong>${escapar(faixa.nome)}</strong>
          <p>${escapar(faixa.descricao || nomeDia)}</p>
          <p>${quantidade} áudio(s) na playlist</p>
        </div>
      </div>
    `;
  }).join("");
}

function atualizarData() {
  if (el.data) {
    el.data.textContent = new Intl.DateTimeFormat("pt-BR", {
      timeZone: FUSO_HORARIO,
      dateStyle: "full"
    }).format(new Date());
  }

  if (el.ano) {
    el.ano.textContent = new Intl.DateTimeFormat("pt-BR", {
      timeZone: FUSO_HORARIO,
      year: "numeric"
    }).format(new Date());
  }
}

function pararRadio(mensagem = "Rádio pausada.") {
  if (el.audio) el.audio.pause();

  tocando = false;
  atualizarBotao();
  status(mensagem);
}

async function reproduzirIndice(indice) {
  if (!el.audio || !playlistAtual.length) {
    status("Não há áudios disponíveis nesta playlist.");
    return;
  }

  // Confere se ainda estamos dentro do horário desta faixa.
  if (!modoTeste) {
    const ativa = encontrarFaixaAtiva();

    if (!ativa || String(ativa.id) !== String(faixaEmReproducao?.id)) {
      pararRadio("Esta faixa horária terminou. Aguardando a próxima programação.");
      return;
    }
  }

  indiceAtual = indice;

  const item = playlistAtual[indiceAtual];

  if (!item?.audio) {
    status("O endereço de um dos áudios está inválido.");
    return;
  }

  try {
    el.audio.pause();
    el.audio.src = item.audio;
    el.audio.load();

    atualizarInformacoes(faixaEmReproducao, item);
    status(`Carregando áudio ${indiceAtual + 1} de ${playlistAtual.length}: ${item.nome}`);

    await el.audio.play();

    tocando = true;
    atualizarBotao();
    status(`Reproduzindo ${indiceAtual + 1} de ${playlistAtual.length}: ${item.nome}`);
  } catch (erro) {
    console.error("Erro ao reproduzir áudio:", erro);

    tocando = false;
    atualizarBotao();

    status("Não foi possível tocar este áudio. Verifique se o link do MP3 está acessível.");
  }
}

async function tocarRadio() {
  if (carregando) return;

  if (!el.audio) {
    status("O player de áudio não foi encontrado na página.");
    return;
  }

  if (tocando) {
    pararRadio();
    return;
  }

  carregando = true;

  try {
    const ativa = encontrarFaixaAtiva();

    if (ativa) {
      faixaEmReproducao = ativa;
      playlistAtual = prepararPlaylist(ativa);
      modoTeste = false;
    } else {
      // Permite testar uma playlist cadastrada fora do seu horário.
      const teste = faixas.find(f =>
        estaAtivo(f) && prepararPlaylist(f).length > 0
      );

      if (!teste) {
        status("Não há uma playlist disponível. Confira o painel administrativo.");
        return;
      }

      faixaEmReproducao = teste;
      playlistAtual = prepararPlaylist(teste);
      modoTeste = true;

      status("Modo de teste: reproduzindo uma playlist fora do horário programado.");
    }

    if (!playlistAtual.length) {
      status("Esta faixa horária não possui áudios válidos.");
      return;
    }

    await reproduzirIndice(0);
  } finally {
    carregando = false;
  }
}

async function avancarAudio() {
  if (!tocando || !playlistAtual.length) return;

  // A faixa pode ter terminado enquanto o áudio estava tocando.
  if (!modoTeste) {
    const ativa = encontrarFaixaAtiva();

    if (!ativa) {
      pararRadio("A faixa horária terminou. Aguardando a próxima programação.");
      return;
    }

    if (String(ativa.id) !== String(faixaEmReproducao?.id)) {
      faixaEmReproducao = ativa;
      playlistAtual = prepararPlaylist(ativa);

      if (!playlistAtual.length) {
        pararRadio("A próxima faixa não possui áudios disponíveis.");
        return;
      }

      modoTeste = false;
      await reproduzirIndice(0);
      return;
    }
  }

  // Próximo áudio; depois do último, volta ao primeiro.
  const proximo = (indiceAtual + 1) % playlistAtual.length;
  await reproduzirIndice(proximo);
}

async function verificarMudancaDeHorario() {
  if (!tocando || modoTeste) return;

  const ativa = encontrarFaixaAtiva();

  if (!ativa) {
    pararRadio("A faixa horária terminou. Aguardando a próxima programação.");
    return;
  }

  if (String(ativa.id) !== String(faixaEmReproducao?.id)) {
    faixaEmReproducao = ativa;
    playlistAtual = prepararPlaylist(ativa);
    indiceAtual = 0;

    if (playlistAtual.length) {
      await reproduzirIndice(0);
    } else {
      pararRadio("A próxima faixa não possui áudios disponíveis.");
    }
  }
}

async function carregarDados() {
  status("Carregando programação...");

  try {
    const resultados = await Promise.allSettled([
      buscarJSON(API.faixas),
      buscarJSON(API.programas)
    ]);

    if (resultados[0].status === "fulfilled") {
      faixas = resultados[0].value;
    } else {
      console.error("Erro ao carregar faixas:", resultados[0].reason);
      faixas = [];
    }

    if (resultados[1].status === "fulfilled") {
      programas = resultados[1].value;
    } else {
      programas = [];
    }

    renderizarProgramacao();
    atualizarData();

    if (encontrarFaixaAtiva()) {
      status("Programação carregada. Clique em Ouvir Agora.");
    } else if (faixas.length) {
      status("Programação carregada. Não há faixa ativa neste momento; você pode testar uma playlist.");
    } else {
      status("Nenhuma faixa horária foi encontrada.");
    }
  } catch (erro) {
    console.error("Erro ao carregar a rádio:", erro);
    status("Não foi possível carregar a programação.");
  }
}

if (el.botao) {
  el.botao.addEventListener("click", tocarRadio);
}

if (el.audio) {
  el.audio.addEventListener("ended", avancarAudio);

  el.audio.addEventListener("playing", () => {
    tocando = true;
    atualizarBotao();
  });

  el.audio.addEventListener("pause", () => {
    if (!el.audio.ended) {
      tocando = false;
      atualizarBotao();
    }
  });

  el.audio.addEventListener("error", () => {
    console.error("Erro no player:", el.audio.error);
    tocando = false;
    atualizarBotao();
    status("Erro ao abrir o áudio. Verifique o link MP3 cadastrado.");
  });
}

carregarDados();

if (verificacaoHorario) clearInterval(verificacaoHorario);
verificacaoHorario = setInterval(verificarMudancaDeHorario, 5000);
