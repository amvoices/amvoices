
const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");

const PROGRAMACAO_FILE = path.join(DATA_DIR, "programacao.json");
const PROGRAMAS_FILE = path.join(DATA_DIR, "programas.json");

// Exige variáveis de ambiente para proteger a área administrativa.
if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD) {
  console.error(
    "Configure SESSION_SECRET e ADMIN_PASSWORD nas variáveis de ambiente."
  );
  process.exit(1);
}

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    name: "amvoices.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: "auto",
      sameSite: "lax",
      maxAge: 4 * 60 * 60 * 1000
    }
  })
);

// Cria as pastas e os JSONs iniciais quando necessário.
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

function prepararArquivo(arquivo, conteudoInicial) {
  if (!fs.existsSync(arquivo)) {
    fs.writeFileSync(
      arquivo,
      JSON.stringify(conteudoInicial, null, 2),
      "utf8"
    );
  }
}

prepararArquivo(PROGRAMACAO_FILE, []);
prepararArquivo(PROGRAMAS_FILE, []);

function lerJSON(arquivo) {
  return JSON.parse(fs.readFileSync(arquivo, "utf8"));
}

function salvarJSON(arquivo, dados) {
  const temporario = arquivo + ".tmp";

  fs.writeFileSync(
    temporario,
    JSON.stringify(dados, null, 2),
    "utf8"
  );

  fs.renameSync(temporario, arquivo);
}

function exigirAdmin(req, res, next) {
  if (req.session && req.session.admin === true) {
    return next();
  }

  return res.status(401).json({
    erro: "Acesso administrativo necessário."
  });
}

function textoValido(valor, limite = 200) {
  return (
    typeof valor === "string" &&
    valor.trim().length > 0 &&
    valor.trim().length <= limite
  );
}

// Página principal da rádio.
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Painel administrativo.
app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

// Publica os arquivos HTML, CSS e JavaScript.
app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    dotfiles: "deny"
  })
);

// Teste de funcionamento.
app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    radio: "Amazon Voices Radio",
    slogan: "Many Voices, One Connection",
    horarioServidor: new Date().toISOString()
  });
});

// Lista pública da programação.
app.get("/api/programacao", (req, res) => {
  try {
    res.json(lerJSON(PROGRAMACAO_FILE));
  } catch (erro) {
    console.error("Erro ao ler programação:", erro);
    res.status(500).json({
      erro: "Não foi possível carregar a programação."
    });
  }
});

// Lista pública de programas.
app.get("/api/programas", (req, res) => {
  try {
    res.json(lerJSON(PROGRAMAS_FILE));
  } catch (erro) {
    console.error("Erro ao ler programas:", erro);
    res.status(500).json({
      erro: "Não foi possível carregar os programas."
    });
  }
});

// Login administrativo.
app.post("/api/admin/login", (req, res, next) => {
  const { senha } = req.body || {};

  if (
    typeof senha !== "string" ||
    senha.length > 1024 ||
    senha !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      erro: "Senha incorreta."
    });
  }

  req.session.regenerate((erro) => {
    if (erro) return next(erro);

    req.session.admin = true;

    req.session.save((erroSalvar) => {
      if (erroSalvar) return next(erroSalvar);

      res.json({
        sucesso: true,
        mensagem: "Acesso autorizado."
      });
    });
  });
});

// Consulta o estado da sessão.
app.get("/api/admin/sessao", (req, res) => {
  res.json({
    autenticado: req.session?.admin === true
  });
});

// Encerra a sessão.
app.post("/api/admin/logout", exigirAdmin, (req, res, next) => {
  req.session.destroy((erro) => {
    if (erro) return next(erro);

    res.clearCookie("amvoices.sid");

    res.json({ sucesso: true });
  });
});

// Salva a lista completa de horários.
app.put(
  "/api/admin/programacao",
  exigirAdmin,
  (req, res) => {
    const programacao = req.body;

    if (!Array.isArray(programacao) || programacao.length > 500) {
      return res.status(400).json({
        erro: "Envie uma lista válida de até 500 horários."
      });
    }

    const ids = new Set();

    for (const item of programacao) {
      if (
        !item ||
        !textoValido(item.id, 100) ||
        !textoValido(item.programaId, 100) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.horario || "") ||
        typeof item.ativo !== "boolean" ||
        ids.has(item.id)
      ) {
        return res.status(400).json({
          erro: "Há um horário inválido ou um identificador duplicado."
        });
      }

      ids.add(item.id);
    }

    try {
      salvarJSON(PROGRAMACAO_FILE, programacao);

      res.json({
        sucesso: true,
        total: programacao.length
      });
    } catch (erro) {
      console.error("Erro ao salvar programação:", erro);

      res.status(500).json({
        erro: "Não foi possível salvar a programação."
      });
    }
  }
);

// Cadastra um novo programa.
app.post(
  "/api/admin/programas",
  exigirAdmin,
  (req, res) => {
    const {
      id,
      titulo,
      idioma,
      descricao,
      audioUrl
    } = req.body || {};

    if (
      !textoValido(id, 100) ||
      !textoValido(titulo, 150) ||
      !textoValido(idioma, 50) ||
      !textoValido(descricao, 500) ||
      (
        audioUrl !== undefined &&
        (typeof audioUrl !== "string" || audioUrl.length > 1000)
      )
    ) {
      return res.status(400).json({
        erro: "Confira os dados do programa."
      });
    }

    // Aceita caminhos locais ou URLs HTTPS.
    if (
      audioUrl &&
      !audioUrl.startsWith("/") &&
      !/^https:\/\/\S+$/i.test(audioUrl)
    ) {
      return res.status(400).json({
        erro: "O áudio precisa ser um caminho local ou uma URL HTTPS."
      });
    }

    try {
      const programas = lerJSON(PROGRAMAS_FILE);
      const novoId = id.trim();

      if (programas.some((programa) => programa.id === novoId)) {
        return res.status(409).json({
          erro: "Já existe um programa com esse identificador."
        });
      }

      const novoPrograma = {
        id: novoId,
        titulo: titulo.trim(),
        idioma: idioma.trim(),
        descricao: descricao.trim(),
        audioUrl: audioUrl ? audioUrl.trim() : "",
        criadoEm: new Date().toISOString()
      };

      programas.push(novoPrograma);
      salvarJSON(PROGRAMAS_FILE, programas);

      res.status(201).json({
        sucesso: true,
        programa: novoPrograma
      });
    } catch (erro) {
      console.error("Erro ao cadastrar programa:", erro);

      res.status(500).json({
        erro: "Não foi possível cadastrar o programa."
      });
    }
  }
);

// Tratamento de erros inesperados.
app.use((erro, req, res, next) => {
  console.error(erro);

  if (res.headersSent) {
    return next(erro);
  }

  res.status(500).json({
    erro: "Ocorreu um erro interno no servidor."
  });
});

// Inicia o servidor na porta fornecida pelo ambiente.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Amazon Voices Radio disponível na porta ${PORT}`);
});