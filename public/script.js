
/* =========================================
   AMAZON VOICES RADIO
   Arquivo: public/script.js
   ========================================= */

"use strict";

// Endereços da API do servidor.
const API = {
    programacao: "/api/programacao",
    programas: "/api/programas"
};

// Elementos da página.
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

// Estado da aplicação.
let programacao = [];
let programas = [];
let programaSelecionado = null;
let tocando = false;


/* =========================================
   1. FUNÇÕES AUXILIARES
   ========================================= */

// Obtém a hora atual no fuso de Manaus.
function obterHoraManaus() {
    return new Date(
        new Date().toLocaleString("en-US", {
            timeZone: "America/Manaus"
        })
    );
}

// Converte uma hora "HH:MM" em minutos.
function converterMinutos(hora) {
    if (typeof hora !== "string") {
        return null;
    }

    const resultado = hora.match(/^(\d{1,2}):(\d{2})$/);

    if (!resultado) {
        return null;
    }

    const horas = Number(resultado[1]);
    const minutos = Number(resultado[2]);

    if (horas > 23 || minutos > 59) {
        return null;
    }

    return horas * 60 + minutos;
}

// Obtém o horário atual em minutos.
function minutosAtuais() {
    const agora = obterHoraManaus();

    return agora.getHours() * 60 + agora.getMinutes();
}

// Formata a data para o público brasileiro.
function formatarData() {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Manaus",
        weekday: "long",
        day: "2-digit",
        month: "long"
    }).format(new Date());
}

// Procura uma propriedade entre possíveis nomes.
function obterCampo(objeto, nomes, padrao = "") {
    for (const nome of nomes) {
        if (
            objeto &&
            objeto[nome] !== undefined &&
            objeto[nome] !== null
        ) {
            return objeto[nome];
        }
    }

    return padrao;
}

// Exibe uma mensagem na área de status do áudio.
function informarAudio(mensagem) {
    if (elementos.statusAudio) {
        elementos.statusAudio.textContent = mensagem;
    }
}

// Atualiza o texto e o ícone do botão.
function atualizarBotao(estaTocando) {
    if (!elementos.botaoPlay) {
        return;
    }

    tocando = estaTocando;

    elementos.iconePlay.textContent = estaTocando ? "Ⅱ" : "▶";

    elementos.textoPlay.textContent = estaTocando
        ? "PAUSAR RÁDIO"
        : "OUVIR AGORA";

    elementos.botaoPlay.setAttribute(
        "aria-label",
        estaTocando ? "Pausar rádio" : "Tocar rádio"
    );

    elementos.botaoPlay.setAttribute(
        "aria-pressed",
        String(estaTocando)
    );
}


/* =========================================
   2. BUSCA DOS DADOS NO SERVIDOR
   ========================================= */

async function buscarJSON(url) {
    const resposta = await fetch(url, {
        headers: {
            Accept: "application/json"
        },
        cache: "no-store"
    });

    if (!resposta.ok) {
        throw new Error(
            `Falha ao consultar ${url}: HTTP ${resposta.status}`
        );
    }

    return resposta.json();
}

async function carregarDados() {
    try {
        informarAudio("Carregando a programação...");

        const resultados = await Promise.allSettled([
            buscarJSON(API.programacao),
            buscarJSON(API.programas)
        ]);

        if (resultados[0].status === "fulfilled") {
            const dados = resultados[0].value;

            programacao = Array.isArray(dados)
                ? dados
                : Array.isArray(dados.programacao)
                    ? dados.programacao
                    : Array.isArray(dados.horarios)
                        ? dados.horarios
                        : [];
        } else {
            console.error(
                "Erro ao carregar programação:",
                resultados[0].reason
            );

            programacao = [];
        }

        if (resultados[1].status === "fulfilled") {
            const dados = resultados[1].value;

            programas = Array.isArray(dados)
                ? dados
                : Array.isArray(dados.programas)
                    ? dados.programas
                    : [];
        } else {
            console.error(
                "Erro ao carregar programas:",
                resultados[1].reason
            );

            programas = [];
        }

        renderizarProgramacao();
        atualizarProgramaAtual();

        if (programacao.length === 0) {
            informarAudio(
                "A programação ainda não está disponível."
            );
        } else if (!tocando) {
            informarAudio(
                "Escolha ouvir para iniciar a rádio."
            );
        }
    } catch (erro) {
        console.error("Erro ao carregar dados:", erro);

        informarAudio(
            "Não foi possível carregar os dados da rádio."
        );
    }
}


/* =========================================
   3. IDENTIFICAÇÃO DO PROGRAMA ATUAL
   ========================================= */

function obterDadosHorario(item) {
    return {
        inicio: obterCampo(
            item,
            ["inicio", "horaInicio", "hora_inicio", "start"],
            ""
        ),

        fim: obterCampo(
            item,
            ["fim", "horaFim", "hora_fim", "end"],
            ""
        ),

        nome: obterCampo(
            item,
            ["nome", "titulo", "programa", "nomePrograma"],
            "Programa da rádio"
        ),

        descricao: obterCampo(
            item,
            ["descricao", "description", "detalhes"],
            ""
        ),

        audio: obterCampo(
            item,
            [
                "url",
                "audio",
                "link",
                "urlAudio",
                "url_audio",
                "arquivo"
            ],
            ""
        ),

        original: item
    };
}

function encontrarProgramaAtual() {
    const agora = minutosAtuais();

    for (const item of programacao) {
        const dados = obterDadosHorario(item);

        const inicio = converterMinutos(dados.inicio);
        const fim = converterMinutos(dados.fim);

        if (inicio === null || fim === null || inicio === fim) {
            continue;
        }

        // Também permite programas que atravessam a meia-noite.
        const estaNoHorario = inicio < fim
            ? agora >= inicio && agora < fim
            : agora >= inicio || agora < fim;

        if (estaNoHorario) {
            return dados;
        }
    }

    return null;
}

function atualizarProgramaAtual() {
    const atual = encontrarProgramaAtual();

    if (!atual) {
        programaSelecionado = null;

        elementos.programaAtual.textContent =
            "Intervalo de programação";

        elementos.descricaoPrograma.textContent =
            "Em breve, novas atrações na Amazon Voices Radio.";

        elementos.horarioInicio.textContent = "--:--";
        elementos.horarioFim.textContent = "--:--";

        renderizarProgramacao();
        return;
    }

    programaSelecionado = atual;

    elementos.programaAtual.textContent = atual.nome;

    elementos.descricaoPrograma.textContent =
        atual.descricao || "Acompanhe este programa na nossa rádio.";

    elementos.horarioInicio.textContent = atual.inicio;
    elementos.horarioFim.textContent = atual.fim;

    renderizarProgramacao();
}


/* =========================================
   4. LISTA DE PROGRAMAÇÃO
   ========================================= */

function criarElemento(tag, classe, texto) {
    const elemento = document.createElement(tag);

    if (classe) {
        elemento.className = classe;
    }

    if (texto !== undefined) {
        elemento.textContent = texto;
    }

    return elemento;
}

function renderizarProgramacao() {
    if (!elementos.listaProgramacao) {
        return;
    }

    elementos.listaProgramacao.replaceChildren();

    if (elementos.dataProgramacao) {
        elementos.dataProgramacao.textContent = formatarData();
    }

    if (elementos.anoAtual) {
        elementos.anoAtual.textContent = new Date().getFullYear();
    }

    if (programacao.length === 0) {
        elementos.listaProgramacao.appendChild(
            criarElemento(
                "p",
                "mensagem-carregamento",
                "Nenhum horário de programação cadastrado."
            )
        );

        return;
    }

    const listaOrdenada = [...programacao].sort((a, b) => {
        const horaA = converterMinutos(
            obterDadosHorario(a).inicio
        );

        const horaB = converterMinutos(
            obterDadosHorario(b).inicio
        );

        return (horaA ?? 0) - (horaB ?? 0);
    });

    for (const item of listaOrdenada) {
        const dados = obterDadosHorario(item);

        const cartao = criarElemento(
            "article",
            "item-programacao"
        );

        const horario = criarElemento(
            "div",
            "item-horario",
            `${dados.inicio || "--:--"} – ${dados.fim || "--:--"}`
        );

        const detalhes = criarElemento("div", "item-detalhes");

        detalhes.appendChild(
            criarElemento("h3", "", dados.nome)
        );

        if (dados.descricao) {
            detalhes.appendChild(
                criarElemento("p", "", dados.descricao)
            );
        }

        if (
            programaSelecionado &&
            dados.inicio === programaSelecionado.inicio &&
            dados.fim === programaSelecionado.fim &&
            dados.nome === programaSelecionado.nome
        ) {
            cartao.classList.add("ativo");

            detalhes.appendChild(
                criarElemento("span", "item-status", "No ar agora")
            );
        }

        cartao.append(horario, detalhes);

        elementos.listaProgramacao.appendChild(cartao);
    }
}


/* =========================================
   5. REPRODUÇÃO DE ÁUDIO
   ========================================= */

function obterURLAudio(programa) {
    if (!programa) {
        return "";
    }

    const url = programa.audio;

    if (typeof url !== "string" || !url.trim()) {
        return "";
    }

    try {
        const endereco = new URL(url, window.location.origin);

        if (!["http:", "https:"].includes(endereco.protocol)) {
            return "";
        }

        return endereco.href;
    } catch {
        return "";
    }
}

async function tocarRadio() {
    if (!elementos.audio) {
        informarAudio("O reprodutor de áudio não foi encontrado.");
        return;
    }

    // Se já estiver tocando, o botão passa a pausar.
    if (!elementos.audio.paused) {
        elementos.audio.pause();
        return;
    }

    const atual = encontrarProgramaAtual();

    if (!atual) {
        informarAudio(
            "Não há um programa ativo neste horário."
        );

        return;
    }

    const url = obterURLAudio(atual);

    if (!url) {
        informarAudio(
            "O áudio deste programa ainda não foi configurado."
        );

        return;
    }

    try {
        const audio = elementos.audio;

        if (audio.src !== url) {
            audio.src = url;
            audio.load();
        }

        informarAudio("Conectando à rádio...");

        await audio.play();

        atualizarBotao(true);
        informarAudio("Você está ouvindo a Amazon Voices Radio.");
    } catch (erro) {
        console.error("Erro ao reproduzir áudio:", erro);

        atualizarBotao(false);

        informarAudio(
            "Não foi possível reproduzir o áudio. Verifique o link e tente novamente."
        );
    }
}


/* =========================================
   6. EVENTOS DO REPRODUTOR
   ========================================= */

if (elementos.botaoPlay) {
    elementos.botaoPlay.addEventListener("click", tocarRadio);
}

if (elementos.audio) {
    elementos.audio.addEventListener("play", () => {
        atualizarBotao(true);
        informarAudio("Você está ouvindo a Amazon Voices Radio.");
    });

    elementos.audio.addEventListener("pause", () => {
        atualizarBotao(false);
    });

    elementos.audio.addEventListener("ended", () => {
        atualizarBotao(false);
        informarAudio("A reprodução terminou.");
    });

    elementos.audio.addEventListener("error", () => {
        atualizarBotao(false);

        informarAudio(
            "Erro ao carregar o áudio. Confira o endereço do arquivo."
        );
    });
}


/* =========================================
   7. ATUALIZAÇÃO AUTOMÁTICA
   ========================================= */

// Reavalia o programa a cada 30 segundos.
// Isso não interrompe intencionalmente o áudio em reprodução.
setInterval(() => {
    atualizarProgramaAtual();
}, 30000);

// Atualiza os dados quando a página volta a ficar visível.
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        carregarDados();
    }
});

// Inicialização.
carregarDados();
