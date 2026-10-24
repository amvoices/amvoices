const API = {
    faixas: "/api/faixas-horarias",
    programas: "/api/programas"
};

const FUSO_HORARIO = "America/Manaus";

const el = {
    audio: document.getElementById("audio-radio"),
    botaoPlay: document.getElementById("botao-play"),
    iconePlay: document.getElementById("icone-play"),
    textoPlay: document.getElementById("texto-play"),
    programaAtual: document.getElementById("programa-atual"),
    descricaoPrograma: document.getElementById("descricao-programa"),
    horarioInicio: document.getElementById("horario-inicio"),
    horarioFim: document.getElementById("horario-fim"),
    statusAudio: document.getElementById("status-audio"),
    listaProgramacao: document.getElementById("lista-programacao"),
    dataProgramacao: document.getElementById("data-programacao"),
    anoAtual: document.getElementById("ano-atual")
};

let faixas = [];
let programas = [];
let playlistAtual = [];
let indiceAtual = 0;
let faixaAtual = null;
let reproduzindo = false;
let verificacaoHorario = null;
let audioCarregado = false;

let idiomaSelecionado = "";
let acordeoesInicializados = false;
const faixasAbertas = new Set();

/* --------------------------------------------------
   FUNÇÕES GERAIS
-------------------------------------------------- */

function status(mensagem) {
    if (el.statusAudio) {
        el.statusAudio.textContent = mensagem;
    }
}

function normalizar(valor) {
    return String(valor ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function escapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, caractere => {
        const entidades = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entidades[caractere];
    });
}

function estaAtivo(valor) {
    if (valor === false || valor === 0 || valor === "0") {
        return false;
    }

    if (typeof valor === "string") {
        return !["false", "inativo", "não", "nao"].includes(
            normalizar(valor)
        );
    }

    return true;
}

async function buscarJSON(url) {
    const resposta = await fetch(url, {
        method: "GET",
        headers: {
            Accept: "application/json"
        },
        cache: "no-store"
    });

    if (!resposta.ok) {
        throw new Error(`Erro ao consultar ${url}: ${resposta.status}`);
    }

    return resposta.json();
}

function obterAudio(url) {
    if (typeof url !== "string" || !url.trim()) {
        return "";
    }

    try {
        const endereco = new URL(url.trim());

        if (
            endereco.protocol !== "https:" &&
            endereco.protocol !== "http:"
        ) {
            return "";
        }

        return endereco.href;
    } catch {
        return "";
    }
}

function obterPdf(url) {
    if (typeof url !== "string" || !url.trim()) {
        return "";
    }

    try {
        const endereco = new URL(url.trim());

        if (endereco.protocol !== "https:") {
            return "";
        }

        return endereco.href;
    } catch {
        return "";
    }
}

/* --------------------------------------------------
   DATA E HORÁRIO DE MANAUS
-------------------------------------------------- */

function partesHora(data = new Date()) {
    const partes = new Intl.DateTimeFormat("en-CA", {
        timeZone: FUSO_HORARIO,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(data);

    const resultado = {};

    for (const parte of partes) {
        if (parte.type !== "literal") {
            resultado[parte.type] = parte.value;
        }
    }

    return resultado;
}

function segundosAtuais() {
    const partes = partesHora();

    return (
        Number(partes.hour) * 3600 +
        Number(partes.minute) * 60 +
        Number(partes.second)
    );
}

function diaAtualManaus() {
    const partes = partesHora();

    const dias = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6
    };

    return dias[partes.weekday];
}

function dataAtualManaus() {
    const partes = partesHora();

    return `${partes.day}/${partes.month}/${partes.year}`;
}

function diaCorresponde(diaSemana) {
    if (
        diaSemana === null ||
        diaSemana === undefined ||
        diaSemana === ""
    ) {
        return true;
    }

    const dias = Array.isArray(diaSemana)
        ? diaSemana
        : String(diaSemana).split(",");

    return dias.some(dia => {
        const valor = normalizar(String(dia).trim());

        if (valor === "" || valor === "todos") {
            return true;
        }

        const numero = Number(valor);

        if (Number.isInteger(numero) && numero >= 0 && numero <= 6) {
            return numero === diaAtualManaus();
        }

        const nomesDias = {
            domingo: 0,
            dom: 0,
            segunda: 1,
            "segunda-feira": 1,
            seg: 1,
            terca: 2,
            "terca-feira": 2,
            ter: 2,
            quarta: 3,
            "quarta-feira": 3,
            qua: 3,
            quinta: 4,
            "quinta-feira": 4,
            qui: 4,
            sexta: 5,
            "sexta-feira": 5,
            sex: 5,
            sabado: 6,
            sab: 6
        };

        return nomesDias[valor] === diaAtualManaus();
    });
}

function paraSegundos(horario) {
    if (!horario) {
        return null;
    }

    const partes = String(horario).split(":");

    if (partes.length < 2) {
        return null;
    }

    const horas = Number(partes[0]);
    const minutos = Number(partes[1]);
    const segundos = Number(partes[2] || 0);

    if (
        !Number.isFinite(horas) ||
        !Number.isFinite(minutos) ||
        !Number.isFinite(segundos) ||
        horas < 0 ||
        horas > 23 ||
        minutos < 0 ||
        minutos > 59 ||
        segundos < 0 ||
        segundos > 59
    ) {
        return null;
    }

    return horas * 3600 + minutos * 60 + segundos;
}

function horarioValido(faixa) {
    const inicio = paraSegundos(faixa.inicio);
    const fim = paraSegundos(faixa.fim);
    const agora = segundosAtuais();

    if (inicio === null || fim === null) {
        return false;
    }

    if (inicio === fim) {
        return true;
    }

    if (inicio < fim) {
        return agora >= inicio && agora < fim;
    }

    return agora >= inicio || agora < fim;
}

/* --------------------------------------------------
   PROGRAMAS E PLAYLISTS
-------------------------------------------------- */

function obterListaDaFaixa(faixa) {
    if (!faixa || !Array.isArray(faixa.playlist)) {
        return [];
    }

    return [...faixa.playlist].sort((a, b) => {
        return Number(a.ordem || 0) - Number(b.ordem || 0);
    });
}

function nomeDoPrograma(item) {
    return (
        item.titulo ||
        item.nome ||
        item.programaNome ||
        item.programa_nome ||
        "Programa sem título"
    );
}

function descricaoDoPrograma(item) {
    return item.descricao || "";
}

function prepararPlaylist(faixa) {
    return obterListaDaFaixa(faixa)
        .filter(item => {
            return (
                estaAtivo(item.ativo) &&
                obterAudio(
                    item.audioUrl ||
                    item.urlAudio ||
                    item.url_audio ||
                    item.audio ||
                    ""
                ) !== ""
            );
        })
        .map(item => ({
            id: item.programaId || item.programa_id || item.id || null,
            nome: nomeDoPrograma(item),
            descricao: descricaoDoPrograma(item),
            audio: obterAudio(
                item.audioUrl ||
                item.urlAudio ||
                item.url_audio ||
                item.audio ||
                ""
            ),
            pdfUrl: obterPdf(
                item.pdfUrl ||
                item.pdf_url ||
                item.urlPdf ||
                ""
            )
        }));
}

/* --------------------------------------------------
   IDENTIFICAÇÃO DOS IDIOMAS
-------------------------------------------------- */

const IDIOMAS_RADIO = {
    pt: {
        nome: "Português",
        bandeira: "🇧🇷"
    },
    en: {
        nome: "English",
        bandeira: "🇬🇧"
    },
    es: {
        nome: "Español",
        bandeira: "🇪🇸"
    },
    ja: {
        nome: "Japonês",
        bandeira: "🇯🇵"
    },
    de: {
        nome: "Deutsch",
        bandeira: "🇩🇪"
    },
    fr: {
        nome: "Français",
        bandeira: "🇫🇷"
    },
    outros: {
        nome: "Outros",
        bandeira: "🌐"
    }
};

function idiomaPorTexto(valor, aceitarSiglas = false) {
    const texto = normalizar(valor);

    if (!texto) {
        return "";
    }

    if (/\b(portugues|portuguese)\b/.test(texto)) {
        return "pt";
    }

    if (/\b(ingles|english)\b/.test(texto)) {
        return "en";
    }

    if (/\b(espanhol|spanish|espanol)\b/.test(texto)) {
        return "es";
    }

    if (/\b(japones|japanese|nihongo)\b/.test(texto)) {
        return "ja";
    }

    if (/\b(alemao|german|deutsch)\b/.test(texto)) {
        return "de";
    }

    if (/\b(frances|french)\b/.test(texto)) {
        return "fr";
    }

    if (aceitarSiglas) {
        const codigo = texto.replace(/_/g, "-");

        if (/^(pt|pt-br|pt-pt)$/.test(codigo)) return "pt";
        if (/^(en|en-us|en-gb)$/.test(codigo)) return "en";
        if (/^(es|es-es|es-mx)$/.test(codigo)) return "es";
        if (/^(ja|ja-jp)$/.test(codigo)) return "ja";
        if (/^(de|de-de)$/.test(codigo)) return "de";
        if (/^(fr|fr-fr)$/.test(codigo)) return "fr";
    }

    return "";
}

function identificarIdioma(faixa) {
    const itens = obterListaDaFaixa(faixa);

    const idiomasInformados = [
        faixa.idioma,
        faixa.linguagem,
        ...itens.map(item => item.idioma),
        ...itens.map(item => item.linguagem)
    ].filter(valor =>
        valor !== null &&
        valor !== undefined &&
        String(valor).trim()
    );

    for (const idioma of idiomasInformados) {
        const identificado = idiomaPorTexto(idioma, true);

        if (identificado) {
            return identificado;
        }
    }

    const texto = [
        faixa.nome,
        faixa.descricao,
        ...itens.map(item => nomeDoPrograma(item)),
        ...itens.map(item => item.descricao)
    ].join(" ");

    return idiomaPorTexto(texto, false) || "outros";
}

/* --------------------------------------------------
   ESCOLHA DA FAIXA ATUAL
-------------------------------------------------- */

function pontuacaoIngles(faixa) {
    const texto = normalizar([
        faixa.nome,
        faixa.descricao,
        ...obterListaDaFaixa(faixa).map(item => {
            return `${nomeDoPrograma(item)} ${item.idioma || ""}`;
        })
    ].join(" "));

    let pontos = 0;

    if (texto.includes("ingles")) pontos += 5;
    if (texto.includes("english")) pontos += 5;
    if (texto.includes("aula")) pontos += 1;
    if (texto.includes("idioma")) pontos += 1;

    return pontos;
}

function identificarIngles(faixa) {
    return pontuacaoIngles(faixa) > 0;
}

function encontrarFaixaAtiva() {
    return faixas.find(faixa => {
        return (
            estaAtivo(faixa.ativo) &&
            diaCorresponde(faixa.diaSemana) &&
            horarioValido(faixa)
        );
    }) || null;
}

function encontrarFaixaPadraoIngles() {
    return faixas
        .filter(faixa => {
            return (
                estaAtivo(faixa.ativo) &&
                prepararPlaylist(faixa).length > 0 &&
                identificarIngles(faixa)
            );
        })
        .sort((a, b) => {
            return pontuacaoIngles(b) - pontuacaoIngles(a);
        })[0] || null;
}

function encontrarFaixaDesejada() {
    const ativa = encontrarFaixaAtiva();

    if (ativa && prepararPlaylist(ativa).length > 0) {
        return ativa;
    }

    return encontrarFaixaPadraoIngles();
}

/* --------------------------------------------------
   PLAYER DA RÁDIO
-------------------------------------------------- */

function atualizarBotao() {
    if (el.iconePlay) {
        el.iconePlay.textContent = reproduzindo ? "❚❚" : "▶";
    }

    if (el.textoPlay) {
        el.textoPlay.textContent = reproduzindo
            ? "PAUSAR RÁDIO"
            : "OUVIR AGORA";
    }

    if (el.botaoPlay) {
        el.botaoPlay.setAttribute(
            "aria-label",
            reproduzindo ? "Pausar rádio" : "Ouvir rádio"
        );
    }
}

function atualizarInformacoes(faixa) {
    if (!faixa) {
        if (el.programaAtual) {
            el.programaAtual.textContent = "Amazon Voices Radio";
        }

        if (el.descricaoPrograma) {
            el.descricaoPrograma.textContent =
                "Muitas vozes, uma conexão.";
        }

        if (el.horarioInicio) {
            el.horarioInicio.textContent = "--:--";
        }

        if (el.horarioFim) {
            el.horarioFim.textContent = "--:--";
        }

        return;
    }

    if (el.programaAtual) {
        el.programaAtual.textContent =
            faixa.nome || "Amazon Voices Radio";
    }

    if (el.descricaoPrograma) {
        el.descricaoPrograma.textContent =
            faixa.descricao || "Acompanhe nossa programação.";
    }

    if (el.horarioInicio) {
        el.horarioInicio.textContent = faixa.inicio || "--:--";
    }

    if (el.horarioFim) {
        el.horarioFim.textContent = faixa.fim || "--:--";
    }
}

async function reproduzirIndice(indice) {
    if (!playlistAtual.length || !el.audio) {
        status("Não há áudio disponível nesta programação.");
        reproduzindo = false;
        atualizarBotao();
        return;
    }

    if (indice < 0 || indice >= playlistAtual.length) {
        indice = 0;
    }

    indiceAtual = indice;

    const item = playlistAtual[indiceAtual];

    el.audio.src = item.audio;
    el.audio.load();
    audioCarregado = true;

    if (el.programaAtual) {
        el.programaAtual.textContent = item.nome;
    }

    if (el.descricaoPrograma) {
        el.descricaoPrograma.textContent =
            item.descricao || "Amazon Voices Radio";
    }

    try {
        await el.audio.play();

        reproduzindo = true;
        atualizarBotao();
        status(`Reproduzindo: ${item.nome}`);
    } catch (erro) {
        reproduzindo = false;
        atualizarBotao();

        status(
            "Não foi possível iniciar o áudio. Toque em Ouvir Agora para tentar novamente."
        );

        console.error("Erro ao reproduzir áudio:", erro);
    }
}

async function tocarRadio() {
    if (!el.audio) {
        return;
    }

    if (reproduzindo && !el.audio.paused) {
        el.audio.pause();
        reproduzindo = false;
        atualizarBotao();
        status("Rádio pausada.");
        return;
    }

    if (
        audioCarregado &&
        el.audio.src &&
        el.audio.paused &&
        !el.audio.ended
    ) {
        try {
            await el.audio.play();

            reproduzindo = true;
            atualizarBotao();
            status("Rádio tocando.");
            return;
        } catch (erro) {
            console.error("Erro ao retomar áudio:", erro);
        }
    }

    const faixa = encontrarFaixaDesejada();

    if (!faixa) {
        status("Não há programação com áudio disponível neste momento.");
        return;
    }

    faixaAtual = faixa;
    playlistAtual = prepararPlaylist(faixa);

    atualizarInformacoes(faixa);

    if (!playlistAtual.length) {
        status("Esta programação ainda não possui áudios disponíveis.");
        return;
    }

    await reproduzirIndice(0);
}

function avancarAudio() {
    if (!playlistAtual.length) {
        reproduzindo = false;
        atualizarBotao();
        status("Não há mais áudios nesta playlist.");
        return;
    }

    const proximo = (indiceAtual + 1) % playlistAtual.length;

    reproduzirIndice(proximo);
}

/* --------------------------------------------------
   MATERIAIS EM PDF
-------------------------------------------------- */

function obterPdfDaPlaylist(item) {
    return obterPdf(
        item.pdfUrl ||
        item.pdf_url ||
        item.urlPdf ||
        item.pdf ||
        ""
    );
}

function renderizarMateriaisPdf(faixa) {
    const itens = obterListaDaFaixa(faixa);

    const materiais = itens
        .map(item => {
            const url = obterPdfDaPlaylist(item);

            if (!url) {
                return "";
            }

            const nome = escapar(nomeDoPrograma(item));

            return `
                <div class="material-pdf">
                    <span class="material-pdf-nome">${nome}</span>

                    <a
                        class="material-pdf-link"
                        href="${escapar(url)}"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Abrir PDF de ${nome}"
                    >
                        📄 Abrir material em PDF
                    </a>
                </div>
            `;
        })
        .filter(Boolean);

    if (!materiais.length) {
        return "";
    }

    return `
        <div class="materiais-pdf">
            <strong>Materiais de apoio:</strong>
            ${materiais.join("")}
        </div>
    `;
}

function textoDias(faixa) {
    const dia = faixa.diaSemana;

    if (
        dia === null ||
        dia === undefined ||
        dia === "" ||
        normalizar(dia) === "todos"
    ) {
        return "Todos os dias";
    }

    const nomes = [
        "Domingo",
        "Segunda-feira",
        "Terça-feira",
        "Quarta-feira",
        "Quinta-feira",
        "Sexta-feira",
        "Sábado"
    ];

    const lista = Array.isArray(dia)
        ? dia
        : String(dia).split(",");

    const resultado = lista.map(valor => {
        const texto = String(valor).trim();
        const numero = Number(texto);

        if (
            texto !== "" &&
            Number.isInteger(numero) &&
            numero >= 0 &&
            numero <= 6
        ) {
            return nomes[numero];
        }

        return texto;
    });

    return resultado.join(", ");
}

/* --------------------------------------------------
   PROGRAMAÇÃO PÚBLICA POR IDIOMA E HORÁRIO
-------------------------------------------------- */

function chaveDaFaixa(faixa, indice) {
    return String(
        faixa.id ??
        `${faixa.nome || "faixa"}-${faixa.inicio || ""}-${faixa.fim || ""}-${indice}`
    );
}

function renderizarConteudoFaixa(faixa) {
    const nome = escapar(faixa.nome || "Programação");

    const descricao = escapar(
        faixa.descricao ||
        "Acompanhe esta programação da Amazon Voices."
    );

    const inicio = escapar(faixa.inicio || "--:--");
    const fim = escapar(faixa.fim || "--:--");
    const dias = escapar(textoDias(faixa));

    const playlist = obterListaDaFaixa(faixa);
    const quantidadeAudios = prepararPlaylist(faixa).length;
    const materiaisPdf = renderizarMateriaisPdf(faixa);

    const programasHtml = playlist.length
        ? `
            <div class="programas-da-faixa">
                ${playlist.map(item => {
                    const titulo = escapar(nomeDoPrograma(item));

                    const idioma = item.idioma
                        ? `
                            <span class="programa-idioma">
                                ${escapar(item.idioma)}
                            </span>
                        `
                        : "";

                    return `
                        <div class="programa-da-faixa">
                            <span>${titulo}</span>
                            ${idioma}
                        </div>
                    `;
                }).join("")}
            </div>
        `
        : `
            <p class="programacao-quantidade">
                Nenhum programa cadastrado nesta faixa.
            </p>
        `;

    return `
        <div class="faixa-resumo">
            <span class="item-programacao-horario">
                ${inicio} – ${fim}
            </span>

            <span class="faixa-resumo-dias">${dias}</span>
        </div>

        <div class="item-programacao-conteudo">
            <h3>${nome}</h3>
            <p>${descricao}</p>

            ${programasHtml}

            <p class="programacao-quantidade">
                ${quantidadeAudios} áudio(s) nesta programação
            </p>

            ${materiaisPdf}
        </div>
    `;
}

function renderizarProgramacao() {
    if (!el.listaProgramacao) {
        return;
    }

    if (el.dataProgramacao) {
        el.dataProgramacao.textContent =
            `Programação de hoje — ${dataAtualManaus()}`;
    }

    const listaOrdenada = faixas
        .map((faixa, indice) => ({ faixa, indice }))
        .filter(({ faixa }) => estaAtivo(faixa.ativo))
        .sort((a, b) => {
            const inicioA = paraSegundos(a.faixa.inicio) ?? 0;
            const inicioB = paraSegundos(b.faixa.inicio) ?? 0;

            return inicioA - inicioB;
        });

    if (!listaOrdenada.length) {
        el.listaProgramacao.innerHTML = `
            <p class="programacao-vazia">
                A programação ainda não está disponível.
            </p>
        `;
        return;
    }

    const grupos = {};

    listaOrdenada.forEach(({ faixa, indice }) => {
        const idioma = identificarIdioma(faixa);

        if (!grupos[idioma]) {
            grupos[idioma] = [];
        }

        grupos[idioma].push({ faixa, indice });
    });

    const ordemPreferida = [
        "pt",
        "en",
        "es",
        "ja",
        "de",
        "fr",
        "outros"
    ];

    const idiomasDisponiveis = [
        ...ordemPreferida.filter(idioma => grupos[idioma]),
        ...Object.keys(grupos).filter(
            idioma => !ordemPreferida.includes(idioma)
        )
    ];

    if (!grupos[idiomaSelecionado]) {
        idiomaSelecionado = idiomasDisponiveis[0];
    }

    const abas = idiomasDisponiveis.map(idioma => {
        const info = IDIOMAS_RADIO[idioma] || {
            nome: idioma,
            bandeira: "🌐"
        };

        const selecionado = idioma === idiomaSelecionado;

        return `
            <button
                type="button"
                class="aba-idioma ${selecionado ? "ativa" : ""}"
                data-idioma="${escapar(idioma)}"
                aria-pressed="${selecionado}"
            >
                <span
                    class="aba-idioma-bandeira"
                    aria-hidden="true"
                >${info.bandeira}</span>

                <span>${escapar(info.nome)}</span>

                <span class="aba-idioma-contagem">
                    ${grupos[idioma].length}
                </span>
            </button>
        `;
    }).join("");

    const faixasHtml = grupos[idiomaSelecionado].map(
        ({ faixa, indice }, posicao) => {
            const chave = chaveDaFaixa(faixa, indice);

            // NOVO: identifica o idioma ensinado e sua bandeira.
            const idiomaFaixa = identificarIdioma(faixa);

            const bandeiraFaixa =
                (IDIOMAS_RADIO[idiomaFaixa] || IDIOMAS_RADIO.outros)
                    .bandeira;

            const aberta = faixasAbertas.has(chave) ||
                (!acordeoesInicializados && posicao === 0);

            return `
                <details
                    class="faixa-acordeao"
                    data-chave-faixa="${escapar(chave)}"
                    ${aberta ? "open" : ""}
                >
                    <summary class="faixa-acordeao-cabecalho">
                        <span class="faixa-acordeao-horario">
                            ${escapar(faixa.inicio || "--:--")}
                            <span aria-hidden="true">–</span>
                            ${escapar(faixa.fim || "--:--")}
                        </span>

                        <span class="faixa-acordeao-titulo">
                            <span
                                class="faixa-acordeao-bandeira"
                                aria-hidden="true"
                            >${bandeiraFaixa}</span>
                            ${escapar(faixa.nome || "Programação")}
                        </span>

                        <span
                            class="faixa-acordeao-seta"
                            aria-hidden="true"
                        >⌄</span>
                    </summary>

                    <div class="faixa-acordeao-corpo">
                        ${renderizarConteudoFaixa(faixa)}
                    </div>
                </details>
            `;
        }
    ).join("");

    el.listaProgramacao.innerHTML = `
        <div
            class="abas-idiomas"
            role="group"
            aria-label="Escolha o idioma da programação"
        >
            ${abas}
        </div>

        <div class="lista-faixas-idioma">
            ${faixasHtml}
        </div>
    `;

    acordeoesInicializados = true;
}

/* --------------------------------------------------
   TROCA AUTOMÁTICA DE PROGRAMAÇÃO
-------------------------------------------------- */

function verificarMudancaDeHorario() {
    const faixaEncontrada = encontrarFaixaDesejada();

    if (!faixaEncontrada) {
        return;
    }

    const mudouFaixa =
        !faixaAtual ||
        faixaEncontrada.id !== faixaAtual.id;

    if (mudouFaixa) {
        faixaAtual = faixaEncontrada;
        playlistAtual = prepararPlaylist(faixaEncontrada);
        indiceAtual = 0;

        atualizarInformacoes(faixaEncontrada);

        if (reproduzindo && playlistAtual.length > 0) {
            reproduzirIndice(0);
        } else if (!playlistAtual.length) {
            status("Aguardando áudio disponível na programação.");
        }
    }
}

/* --------------------------------------------------
   CARREGAMENTO DOS DADOS
-------------------------------------------------- */

async function carregarDados() {
    try {
        const [dadosFaixas, dadosProgramas] = await Promise.all([
            buscarJSON(API.faixas),
            buscarJSON(API.programas).catch(() => [])
        ]);

        faixas = Array.isArray(dadosFaixas)
            ? dadosFaixas
            : [];

        programas = Array.isArray(dadosProgramas)
            ? dadosProgramas
            : [];

        renderizarProgramacao();

        const faixa = encontrarFaixaDesejada();

        if (faixa) {
            faixaAtual = faixa;
            atualizarInformacoes(faixa);

            if (!reproduzindo) {
                status("Pronto para ouvir.");
            }
        } else {
            atualizarInformacoes(null);
            status("Aguardando a próxima programação.");
        }

        verificarMudancaDeHorario();
    } catch (erro) {
        console.error("Erro ao carregar a programação:", erro);

        if (el.listaProgramacao) {
            el.listaProgramacao.innerHTML = `
                <p class="programacao-vazia">
                    Não foi possível carregar a programação.
                    Tente atualizar a página.
                </p>
            `;
        }

        status("Não foi possível carregar os dados da rádio.");
    }
}

/* --------------------------------------------------
   EVENTOS DO PLAYER E DA PROGRAMAÇÃO
-------------------------------------------------- */

if (el.botaoPlay) {
    el.botaoPlay.addEventListener("click", tocarRadio);
}

if (el.listaProgramacao) {
    el.listaProgramacao.addEventListener("click", evento => {
        const aba = evento.target.closest("[data-idioma]");

        if (!aba || !el.listaProgramacao.contains(aba)) {
            return;
        }

        idiomaSelecionado = aba.dataset.idioma;
        renderizarProgramacao();
    });

    el.listaProgramacao.addEventListener("toggle", evento => {
        const faixa = evento.target;

        if (
            !faixa.matches(".faixa-acordeao") ||
            !faixa.dataset.chaveFaixa
        ) {
            return;
        }

        acordeoesInicializados = true;

        if (faixa.open) {
            faixasAbertas.add(faixa.dataset.chaveFaixa);
        } else {
            faixasAbertas.delete(faixa.dataset.chaveFaixa);
        }
    }, true);
}

if (el.audio) {
    el.audio.addEventListener("ended", () => {
        avancarAudio();
    });

    el.audio.addEventListener("play", () => {
        reproduzindo = true;
        atualizarBotao();
    });

    el.audio.addEventListener("pause", () => {
        reproduzindo = false;
        atualizarBotao();
    });

    el.audio.addEventListener("error", () => {
        reproduzindo = false;
        atualizarBotao();
        status("Não foi possível carregar este áudio.");
    });
}

if (el.anoAtual) {
    el.anoAtual.textContent = new Date().getFullYear();
}

atualizarBotao();
carregarDados();

verificacaoHorario = setInterval(() => {
    verificarMudancaDeHorario();

    // Atualiza a programação para exibir alterações feitas no painel.
    carregarDados();
}, 60000);

/* --------------------------------------------------
   CONTADOR DE VISITAS
   Registra uma visita por carregamento da página.
   Não fica dentro do intervalo de 60 segundos.
-------------------------------------------------- */

(async function registrarVisitaRadio() {
    const elemento = document.getElementById("total-visitas");

    if (!elemento) {
        return;
    }

    try {
        const resposta = await fetch("/api/visitas", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: "{}"
        });

        if (!resposta.ok) {
            throw new Error(
                `Não foi possível registrar a visita: ${resposta.status}`
            );
        }

        const dados = await resposta.json();

        if (dados.total === undefined || dados.total === null) {
            throw new Error("O servidor não retornou o total de visitas.");
        }

        elemento.textContent =
            Number(dados.total).toLocaleString("pt-BR");
    } catch (erro) {
        console.error("Erro no contador de visitas:", erro);
        elemento.textContent = "Indisponível";
    }
})();
