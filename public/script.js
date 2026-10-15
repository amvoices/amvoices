
const loginArea = document.getElementById("area-login");
const painelArea = document.getElementById("area-painel");
const formLogin = document.getElementById("form-login");
const senhaAdmin = document.getElementById("senha-admin");
const mensagemLogin = document.getElementById("mensagem-login");

function mostrarMensagem(elemento, texto, tipo = "") {
    elemento.textContent = texto;
    elemento.className = "admin-mensagem";

    if (tipo) {
        elemento.classList.add(tipo);
    }
}

async function requisicao(url, opcoes = {}) {
    const resposta = await fetch(url, {
        credentials: "same-origin",
        ...opcoes,
        headers: {
            ...(opcoes.headers || {}),
            "Content-Type": "application/json"
        }
    });

    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
        throw new Error(
            dados.erro ||
            dados.mensagem ||
            `Falha na solicitação (${resposta.status}).`
        );
    }

    return dados;
}

// Verifica se a sessão está realmente autenticada.
async function verificarSessao() {
    try {
        const sessao = await requisicao("/api/admin/sessao");

        if (sessao.autenticado === true) {
            loginArea.classList.add("admin-oculto");
            painelArea.classList.remove("admin-oculto");
            await atualizarListas();
        } else {
            loginArea.classList.remove("admin-oculto");
            painelArea.classList.add("admin-oculto");
        }
    } catch (erro) {
        loginArea.classList.remove("admin-oculto");
        painelArea.classList.add("admin-oculto");

        mostrarMensagem(
            mensagemLogin,
            "Não foi possível verificar a sessão. Tente entrar novamente.",
            "erro"
        );
    }
}

// Login administrativo.
formLogin.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    mostrarMensagem(mensagemLogin, "Verificando acesso...");

    try {
        const resultado = await requisicao("/api/admin/login", {
            method: "POST",
            body: JSON.stringify({
                senha: senhaAdmin.value
            })
        });

        if (resultado.sucesso !== true) {
            throw new Error("O servidor não confirmou o acesso.");
        }

        senhaAdmin.value = "";

        // Confirma a sessão criada pelo servidor antes de abrir o painel.
        const sessao = await requisicao("/api/admin/sessao");

        if (sessao.autenticado !== true) {
            throw new Error(
                "Login recebido, mas a sessão não foi reconhecida. " +
                "Verifique os cookies e a configuração do servidor."
            );
        }

        loginArea.classList.add("admin-oculto");
        painelArea.classList.remove("admin-oculto");

        mostrarMensagem(mensagemLogin, "");

        await atualizarListas();
    } catch (erro) {
        mostrarMensagem(
            mensagemLogin,
            erro.message,
            "erro"
        );
    }
});

// Sair do painel.
document.getElementById("botao-sair")
    .addEventListener("click", async () => {
        try {
            await requisicao("/api/admin/logout", {
                method: "POST"
            });
        } catch (erro) {
            console.error("Erro ao sair:", erro);
        }

        painelArea.classList.add("admin-oculto");
        loginArea.classList.remove("admin-oculto");

        mostrarMensagem(
            mensagemLogin,
            "Você saiu do painel."
        );
    });

// Cria texto seguro para exibição.
function criarTexto(texto, classe) {
    const elemento = document.createElement("p");
    elemento.className = classe;
    elemento.textContent = texto;
    return elemento;
}

// Carrega programas e atualiza a lista e o seletor de horários.
async function atualizarListas() {
    const lista = document.getElementById("lista-programas");
    const seletor = document.getElementById("horario-programa");
    const mensagem = document.getElementById("mensagem-listas");

    lista.replaceChildren();
    seletor.replaceChildren();

    try {
        const dados = await requisicao("/api/programas");

        const itens = Array.isArray(dados)
            ? dados
            : Array.isArray(dados.programas)
                ? dados.programas
                : [];

        const opcaoInicial = document.createElement("option");
        opcaoInicial.value = "";
        opcaoInicial.textContent = "Selecione um programa";
        seletor.appendChild(opcaoInicial);

        for (const programa of itens) {
            const nome = programa.nome || programa.titulo || "Programa";
            const id = programa.id ?? programa.programaId;

            const opcao = document.createElement("option");
            opcao.value = String(id);
            opcao.textContent = nome;
            seletor.appendChild(opcao);

            const cartao = document.createElement("article");
            cartao.className = "admin-item";

            const titulo = document.createElement("h3");
            titulo.textContent = nome;
            cartao.appendChild(titulo);

            if (programa.idioma) {
                cartao.appendChild(
                    criarTexto("Idioma: " + programa.idioma, "")
                );
            }

            if (programa.descricao) {
                cartao.appendChild(
                    criarTexto(programa.descricao, "")
                );
            }

            const urlAudio =
                programa.audioUrl ||
                programa.url_audio ||
                programa.url ||
                programa.audio ||
                programa.link;

            if (urlAudio) {
                const link = document.createElement("a");
                link.href = urlAudio;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = "Abrir áudio";
                cartao.appendChild(link);
            }

            lista.appendChild(cartao);
        }

        if (itens.length === 0) {
            lista.appendChild(
                criarTexto("Nenhum programa cadastrado.", "admin-ajuda")
            );
        }

        mostrarMensagem(
            mensagem,
            `${itens.length} programa(s) carregado(s).`,
            "sucesso"
        );
    } catch (erro) {
        mostrarMensagem(
            mensagem,
            "Não foi possível carregar os programas: " + erro.message,
            "erro"
        );

        lista.appendChild(
            criarTexto(
                "Verifique a conexão com o servidor.",
                "admin-ajuda"
            )
        );
    }
}

// Botão para atualizar as listas.
document.getElementById("botao-atualizar")
    .addEventListener("click", atualizarListas);

// Cadastro de programas.
document.getElementById("form-programa")
    .addEventListener("submit", async (evento) => {
        evento.preventDefault();

        const formulario = evento.currentTarget;
        const mensagem = document.getElementById("mensagem-programa");
        const botao = formulario.querySelector('button[type="submit"]');
        const dados = Object.fromEntries(new FormData(formulario));

        // O servidor aceita nome, descrição e URL do áudio.
        mostrarMensagem(mensagem, "Salvando programa...");
        botao.disabled = true;

        try {
            const resultado = await requisicao(
                "/api/admin/programas",
                {
                    method: "POST",
                    body: JSON.stringify(dados)
                }
            );

            if (resultado.sucesso !== true) {
                throw new Error("O servidor não confirmou o cadastro.");
            }

            formulario.reset();

            mostrarMensagem(
                mensagem,
                "Programa cadastrado com sucesso!",
                "sucesso"
            );

            await atualizarListas();
        } catch (erro) {
            mostrarMensagem(
                mensagem,
                "Não foi possível cadastrar: " + erro.message,
                "erro"
            );
        } finally {
            botao.disabled = false;
        }
    });

// Cadastro de horários da programação.
document.getElementById("form-horario")
    .addEventListener("submit", async (evento) => {
        evento.preventDefault();

        const formulario = evento.currentTarget;
        const mensagem = document.getElementById("mensagem-horario");
        const botao = formulario.querySelector('button[type="submit"]');
        const dados = Object.fromEntries(new FormData(formulario));

        if (!dados.programaId || !dados.inicio || !dados.fim) {
            mostrarMensagem(
                mensagem,
                "Selecione o programa e informe os horários de início e fim.",
                "erro"
            );
            return;
        }

        if (dados.inicio === dados.fim) {
            mostrarMensagem(
                mensagem,
                "O início e o fim não podem ser iguais.",
                "erro"
            );
            return;
        }

        mostrarMensagem(mensagem, "Salvando horário...");
        botao.disabled = true;

        try {
            // A rota PUT recebe a lista completa. Preservamos os horários
            // existentes antes de acrescentar o novo.
            const atual = await requisicao("/api/programacao");

            const horarios = Array.isArray(atual)
                ? atual
                : Array.isArray(atual.programacao)
                    ? atual.programacao
                    : [];

            horarios.push({
                programaId: dados.programaId,
                inicio: dados.inicio,
                fim: dados.fim,
                descricao: dados.descricao || "",
                ativo: true
            });

            const resultado = await requisicao(
                "/api/admin/programacao",
                {
                    method: "PUT",
                    body: JSON.stringify(horarios)
                }
            );

            if (resultado.sucesso !== true) {
                throw new Error("O servidor não confirmou a programação.");
            }

            formulario.reset();

            mostrarMensagem(
                mensagem,
                "Horário salvo com sucesso!",
                "sucesso"
            );
        } catch (erro) {
            mostrarMensagem(
                mensagem,
                "Não foi possível salvar o horário: " + erro.message,
                "erro"
            );
        } finally {
            botao.disabled = false;
        }
    });

// Verifica a sessão assim que a página abre.
verificarSessao();
