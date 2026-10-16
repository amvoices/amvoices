
"use strict";

const API = {
  programacao: "/api/programacao",
  programas: "/api/programas"
};

const elementos = {
  audio: document.getElementById("audio-radio"),
  botaoPlay: document.getElementById("botao-play"),
  iconePlay: document.getElementById("icone-play"),
  textoPlay: document.getElementById("texto-play"),
  statusAudio: document.getElementById("status-audio"),
  programaAtual: document.getElementById("programa-atual"),
  descricaoPrograma: document.getElementById("descricao-programa"),
  horarioInicio: document.getElementById("horario-inicio"),
  horarioFim: document.getElementById("horario-fim"),
  listaProgramacao: document.getElementById("lista-programacao"),
  dataProgramacao: document.getElementById("data-programacao"),
  anoAtual: document.getElementById("ano-atual")
};

let programacao = [];
let programas = [];
let programaSelecionado = null;
let tocando = false;
let carregando = false;

const FUSO_HORARIO = "America/Manaus";

function definirStatus(mensagem) {
  if (elementos.statusAudio) {
    elementos.statusAudio.textContent = mensagem;
  }
}

function normalizar(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function escaparHTML(valor) {
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
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  if (!resposta.ok) {
    throw new Error(
      `Erro ao consultar ${url}: HTTP ${resposta.status}`
    );
  }

  const dados = await resposta.json();

  if (Array.isArray(dados)) {
    return dados;
  }

  if (Array.isArray(dados?.dados)) {
    return dados.dados;
  }

  if (Array.isArray(dados?.programacao)) {
    return dados.programacao;
  }

  if (Array.isArray(dados?.programas)) {
    return dados.programas;
  }

  return [];
}

/* Relaciona cada horário ao programa cadastrado.
   Exemplo: horario.programaId === programa.id */

function encontrarProgramaRelacionado(horario) {
  const identificador =
    horario?.programaId ??
    horario?.programa_id ??
    horario?.idPrograma ??
    horario?.id_programa;

  if (identificador !== undefined && identificador !== null) {
    const encontrado = programas.find(programa =>
      String(
        programa.id ??
        programa.programaId ??
        programa.programa_id ??
        ""
      ) === String(identificador)
    );

    if (encontrado) {
      return encontrado;
    }
  }

  const nomeHorario =
    horario?.nome ??
    horario?.titulo ??
    horario?.programa ??
    horario?.nomePrograma ??
    horario?.nome_programa;

  if (nomeHorario) {
    const nomeNormalizado = normalizar(nomeHorario);

    return programas.find(programa =>
      normalizar(programa.nome ?? programa.titulo) === nomeNormalizado
    ) ?? null;
  }

  return null;
}

function obterDadosHorario(horario) {
  const programa = encontrarProgramaRelacionado(horario);

  const inicio =
    horario?.inicio ??
    horario?.horarioInicio ??
    horario?.horario_inicio ??
    horario?.horario ??
    "";

  const fim =
    horario?.fim ??
    horario?.horarioFim ??
    horario?.horario_fim ??
    "";

  return {
    original: horario,
    programa: programa,
    id: programa?.id ?? horario?.programaId ?? horario?.id,
    nome:
      programa?.nome ??
      programa?.titulo ??
      horario?.nome ??
      horario?.titulo ??
      "Programa da rádio",
    descricao:
      programa?.descricao ??
      horario?.descricao ??
      "",
    idioma: programa?.idioma ?? "",
    audio:
      programa?.audioUrl ??
      programa?.url_audio ??
      programa?.url ??
      programa?.audio ??
      horario?.audioUrl ??
      horario?.url_audio ??
      horario?.url ??
      horario?.audio ??
      "",
    inicio: String(inicio).slice(0, 5),
    fim: String(fim).slice(0, 5),
    ativo: estaAtivo(horario) && (!programa || estaAtivo(programa)),
    diaSemana:
      horario?.diaSemana ??
      horario?.dia_semana ??
      horario?.dia ??
      null
  };
}

function obterHoraManaus() {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO_HORARIO,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const hora = partes.find(parte => parte.type === "hour")?.value ?? "00";
  const minuto = partes.find(parte => parte.type === "minute")?.value ?? "00";

  return `${hora}:${minuto}`;
}

function obterDiaSemanaManaus() {
  const dia = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_HORARIO,
    weekday: "short"
  }).format(new Date());

  const dias = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  return dias[dia];
}

function diaCorresponde(valor) {
  // Sem dia definido significa que vale todos os dias.
  if (valor === null || valor === undefined || valor === "") {
    return true;
  }

  const diaAtual = obterDiaSemanaManaus();

  if (typeof valor === "number" || /^\d+$/.test(String(valor))) {
    return Number(valor) === diaAtual;
  }

  const nomesDias = {
    domingo: 0,
    dom: 0,
    sunday: 0,
    segunda: 1,
    "segunda-feira": 1,
    seg: 1,
    monday: 1,
    terca: 2,
    "terca-feira": 2,
    ter: 2,
    tuesday: 2,
    quarta: 3,
    "quarta-feira": 3,
    qua: 3,
    wednesday: 3,
    quinta: 4,
    "quinta-feira": 4,
    qui: 4,
    thursday: 4,
    sexta: 5,
    "sexta-feira": 5,
    sex: 5,
    friday: 5,
    sabado: 6,
    sab: 6,
    saturday: 6
  };

  const texto = normalizar(valor);

  if (texto.includes(",")) {
    return texto.split(",").some(dia => diaCorresponde(dia.trim()));
  }

  return nomesDias[texto] === diaAtual;
}

function horarioEstaValido(dados) {
  if (!dados.inicio || !dados.fim) {
    return false;
  }

  const horaAtual = obterHoraManaus();

  // Horário normal, por exemplo, 09:00 às 11:00.
  if (dados.inicio < dados.fim) {
    return horaAtual >= dados.inicio && horaAtual < dados.fim;
  }

  // Também permite programação que passa da meia-noite.
  if (dados.inicio > dados.fim) {
    return horaAtual >= dados.inicio || horaAtual < dados.fim;
  }

  return false;
}

function obterProgramacaoTratada() {
  return programacao
    .map(obterDadosHorario)
    .filter(item => item.ativo && item.programa);
}

function encontrarProgramaAtual() {
  return obterProgramacaoTratada().find(item =>
    diaCorresponde(item.diaSemana) && horarioEstaValido(item)
  ) ?? null;
}

function obterPrimeiroProgramaDisponivel() {
  return programas.find(programa =>
    estaAtivo(programa) &&
    Boolean(
      programa.audioUrl ??
      programa.url_audio ??
      programa.url ??
      programa.audio
    )
  ) ?? null;
}

function atualizarInformacoesPrograma(dados) {
  if (!dados) {
    if (elementos.programaAtual) {
      elementos.programaAtual.textContent = "Amazon Voices";
    }

    if (elementos.descricaoPrograma) {
      elementos.descricaoPrograma.textContent =
        "Aguarde a próxima programação.";
    }

    if (elementos.horarioInicio) {
      elementos.horarioInicio.textContent = "--:--";
    }

    if (elementos.horarioFim) {
      elementos.horarioFim.textContent = "--:--";
    }

    return;
  }

  if (elementos.programaAtual) {
    elementos.programaAtual.textContent = dados.nome;
  }

  if (elementos.descricaoPrograma) {
    elementos.descricaoPrograma.textContent =
      dados.descricao || "Ouça a programação da Amazon Voices.";
  }

  if (elementos.horarioInicio) {
    elementos.horarioInicio.textContent = dados.inicio || "--:--";
  }

  if (elementos.horarioFim) {
    elementos.horarioFim.textContent = dados.fim || "--:--";
  }
}

function renderizarProgramacao() {
  if (!elementos.listaProgramacao) {
    return;
  }

  const lista = obterProgramacaoTratada()
    .sort((a, b) => a.inicio.localeCompare(b.inicio));

  if (lista.length === 0) {
    elementos.listaProgramacao.innerHTML =
      '<p class="programacao-vazia">Nenhuma programação cadastrada.</p>';
    return;
  }

  elementos.listaProgramacao.innerHTML = lista.map(item => `
    <div class="item-programacao">
      <div class="item-programacao-horario">
        ${escaparHTML(item.inicio)} - ${escaparHTML(item.fim)}
      </div>
      <div class="item-programacao-conteudo">
        <strong>${escaparHTML(item.nome)}</strong>
        <p>${escaparHTML(item.descricao || item.idioma || "")}</p>
      </div>
    </div>
  `).join("");
}

function atualizarData() {
  if (elementos.dataProgramacao) {
    elementos.dataProgramacao.textContent =
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: FUSO_HORARIO,
        dateStyle: "full"
      }).format(new Date());
  }

  if (elementos.anoAtual) {
    elementos.anoAtual.textContent =
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: FUSO_HORARIO,
        year: "numeric"
      }).format(new Date());
  }
}

function atualizarBotao() {
  if (elementos.textoPlay) {
    elementos.textoPlay.textContent = tocando
      ? "PAUSAR"
      : "OUVIR AGORA";
  }

  if (elementos.iconePlay) {
    elementos.iconePlay.textContent = tocando ? "❚❚" : "▶";
  }

  if (elementos.botaoPlay) {
    elementos.botaoPlay.setAttribute(
      "aria-label",
      tocando ? "Pausar rádio" : "Ouvir rádio"
    );
  }
}

async function tocarRadio() {
  if (carregando) {
    return;
  }

  if (!elementos.audio) {
    definirStatus("Não foi encontrado o player de áudio na página.");
    return;
  }

  carregando = true;

  try {
    let dados = encontrarProgramaAtual();

    // Se não houver programa no horário atual, permite testar
    // o primeiro programa ativo cadastrado.
    if (!dados) {
      const primeiro = obterPrimeiroProgramaDisponivel();

      if (primeiro) {
        dados = {
          programa: primeiro,
          nome: primeiro.nome ?? primeiro.titulo ?? "Amazon Voices",
          descricao: primeiro.descricao ?? "",
          audio:
            primeiro.audioUrl ??
            primeiro.url_audio ??
            primeiro.url ??
            primeiro.audio,
          inicio: "",
          fim: ""
        };

        definirStatus(
          "Fora do horário programado. Reproduzindo o primeiro áudio cadastrado."
        );
      }
    }

    if (!dados || !dados.audio) {
      definirStatus(
        "Nenhum áudio disponível. Confira o programa e o endereço do MP3."
      );
      return;
    }

    const urlAudio = String(dados.audio).trim();

    if (!/^https?:\/\/\S+$/i.test(urlAudio)) {
      definirStatus("O endereço do áudio não é válido.");
      return;
    }

    if (
      !programaSelecionado ||
      programaSelecionado.audio !== urlAudio
    ) {
      elementos.audio.pause();
      elementos.audio.src = urlAudio;
      elementos.audio.load();
      programaSelecionado = {
        ...dados,
        audio: urlAudio
      };
    }

    atualizarInformacoesPrograma(dados);
    definirStatus("Conectando ao áudio...");

    await elementos.audio.play();

    tocando = true;
    atualizarBotao();
    definirStatus(`Reproduzindo: ${dados.nome}`);
  } catch (erro) {
    console.error("Erro ao iniciar o áudio:", erro);

    tocando = false;
    atualizarBotao();

    definirStatus(
      "Não foi possível reproduzir o áudio. Verifique a conexão e se o MP3 está acessível."
    );
  } finally {
    carregando = false;
  }
}

function pausarRadio() {
  if (!elementos.audio) {
    return;
  }

  elementos.audio.pause();
  tocando = false;
  atualizarBotao();
  definirStatus("Rádio pausada.");
}

async function carregarDados() {
  definirStatus("Carregando programação...");

  try {
    const resultados = await Promise.allSettled([
      buscarJSON(API.programacao),
      buscarJSON(API.programas)
    ]);

    if (resultados[0].status === "fulfilled") {
      programacao = resultados[0].value;
    } else {
      console.error(
        "Erro ao carregar programação:",
        resultados[0].reason
      );
      programacao = [];
    }

    if (resultados[1].status === "fulfilled") {
      programas = resultados[1].value;
    } else {
      console.error(
        "Erro ao carregar programas:",
        resultados[1].reason
      );
      programas = [];
    }

    renderizarProgramacao();
    atualizarData();

    const atual = encontrarProgramaAtual();

    atualizarInformacoesPrograma(atual);

    if (programacao.length === 0) {
      definirStatus("A programação ainda não está disponível.");
    } else if (programas.length === 0) {
      definirStatus("Não foi possível encontrar os programas cadastrados.");
    } else if (!atual) {
      definirStatus(
        "Programação carregada. Fora do horário programado; você pode testar o áudio pelo botão."
      );
    } else {
      definirStatus("Programação carregada. Clique em Ouvir Agora.");
    }
  } catch (erro) {
    console.error("Erro ao carregar os dados da rádio:", erro);
    definirStatus("Não foi possível carregar os dados da rádio.");
  }
}

if (elementos.botaoPlay) {
  elementos.botaoPlay.addEventListener("click", () => {
    if (tocando) {
      pausarRadio();
    } else {
      tocarRadio();
    }
  });
} else {
  console.error('Não foi encontrado o botão com id "botao-play".');
}

if (elementos.audio) {
  elementos.audio.addEventListener("ended", () => {
    tocando = false;
    atualizarBotao();
    definirStatus("O áudio terminou.");
  });

  elementos.audio.addEventListener("error", () => {
    tocando = false;
    atualizarBotao();
    definirStatus(
      "Erro no áudio. O endereço pode estar indisponível ou o servidor pode bloquear a reprodução."
    );
    console.error(
      "Erro no elemento de áudio:",
      elementos.audio.error
    );
  });

  elementos.audio.addEventListener("playing", () => {
    tocando = true;
    atualizarBotao();
  });

  elementos.audio.addEventListener("pause", () => {
    if (!elementos.audio.ended) {
      tocando = false;
      atualizarBotao();
    }
  });
}

carregarDados();
