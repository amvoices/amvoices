
const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, "public");

if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD) {
  console.error(
    "Configure SESSION_SECRET e ADMIN_PASSWORD nas variáveis de ambiente."
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("Configure DATABASE_URL com a conexão do Neon.");
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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => {
  console.error("Erro inesperado no Neon:", err.message);
});

function exigirAdmin(req, res, next) {
  if (req.session?.admin === true) return next();

  return res.status(401).json({
    erro: "Acesso administrativo necessário."
  });
}

function texto(valor, limite = 200) {
  return (
    typeof valor === "string" &&
    valor.trim().length > 0 &&
    valor.trim().length <= limite
  );
}

function horarioValido(valor) {
  return (
    typeof valor === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(valor)
  );
}

function urlAudioValida(valor) {
  if (!valor) return true;

  if (typeof valor !== "string" || valor.length > 1000) {
    return false;
  }

  if (valor.startsWith("/") && !valor.startsWith("//")) {
    return true;
  }

  try {
    return new URL(valor).protocol === "https:";
  } catch {
    return false;
  }
}

// Prepara o banco de dados.
async function prepararBanco() {
  await pool.query(`
    ALTER TABLE programas
      ADD COLUMN IF NOT EXISTS codigo_externo TEXT,
      ADD COLUMN IF NOT EXISTS idioma VARCHAR(50);

    ALTER TABLE programacao
      ADD COLUMN IF NOT EXISTS codigo_externo TEXT;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_programas_codigo_externo
      ON programas (codigo_externo)
      WHERE codigo_externo IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_programacao_codigo_externo
      ON programacao (codigo_externo)
      WHERE codigo_externo IS NOT NULL;

    CREATE INDEX IF NOT EXISTS
      idx_programacao_horarios
      ON programacao (dia_semana, horario_inicio);

    CREATE INDEX IF NOT EXISTS
      idx_programacao_programa
      ON programacao (programa_id);
  `);

  console.log("Estrutura do Neon conferida.");
}

// Páginas do site.
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    dotfiles: "deny"
  })
);

// Estado do servidor.
app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    radio: "Amazon Voices Radio",
    slogan: "Many Voices, One Connection",
    horarioServidor: new Date().toISOString()
  });
});

// Teste da conexão com o Neon.
app.get("/api/teste-neon", async (req, res, next) => {
  try {
    const resultado = await pool.query(`
      SELECT NOW() AS horario, current_database() AS banco
    `);

    res.json({
      conectado: true,
      mensagem: "Conexão com o Neon funcionando!",
      banco: resultado.rows[0].banco,
      horario: resultado.rows[0].horario
    });
  } catch (err) {
    next(err);
  }
});

// Lista de programas.
app.get("/api/programas", async (req, res, next) => {
  try {
    const resultado = await pool.query(`
      SELECT
        id,
        COALESCE(codigo_externo, id::text) AS codigo,
        nome,
        idioma,
        descricao,
        url_audio,
        ativo,
        criado_em
      FROM programas
      ORDER BY nome
    `);

    res.json(
      resultado.rows.map((p) => ({
        id: p.codigo,
        titulo: p.nome,
        nome: p.nome,
        idioma: p.idioma || "",
        descricao: p.descricao || "",
        audioUrl: p.url_audio || "",
        url_audio: p.url_audio || "",
        url: p.url_audio || "",
        ativo: p.ativo,
        criadoEm: p.criado_em
      }))
    );
  } catch (err) {
    next(err);
  }
});

// Lista dos horários da programação.
app.get("/api/programacao", async (req, res, next) => {
  try {
    const resultado = await pool.query(`
      SELECT
        pg.id,
        COALESCE(pg.codigo_externo, pg.id::text) AS codigo,
        COALESCE(p.codigo_externo, p.id::text) AS programa_codigo,
        pg.dia_semana,
        pg.horario_inicio,
        pg.horario_fim,
        pg.descricao,
        pg.ativo
      FROM programacao pg
      JOIN programas p ON p.id = pg.programa_id
      ORDER BY pg.dia_semana NULLS FIRST, pg.horario_inicio
    `);

    res.json(
      resultado.rows.map((h) => {
        const inicio = String(h.horario_inicio).slice(0, 5);
        const fim = String(h.horario_fim).slice(0, 5);

        return {
          id: h.codigo,
          programaId: h.programa_codigo,
          diaSemana: h.dia_semana,
          horario: inicio,
          inicio,
          fim,
          descricao: h.descricao || "",
          ativo: h.ativo
        };
      })
    );
  } catch (err) {
    next(err);
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

  req.session.regenerate((err) => {
    if (err) return next(err);

    req.session.admin = true;

    req.session.save((saveErr) => {
      if (saveErr) return next(saveErr);

      res.json({
        sucesso: true,
        mensagem: "Acesso autorizado."
      });
    });
  });
});

// Verifica a sessão.
app.get("/api/admin/sessao", (req, res) => {
  res.json({
    autenticado: req.session?.admin === true
  });
});

// Logout.
app.post("/api/admin/logout", exigirAdmin, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);

    res.clearCookie("amvoices.sid");
    res.json({ sucesso: true });
  });
});

// Cadastro de programas.
app.post("/api/admin/programas", exigirAdmin, async (req, res, next) => {
  try {
    const dados = req.body || {};

    const nome = dados.titulo ?? dados.nome;
    const idioma = dados.idioma || "Português";
    const descricao = dados.descricao || "";
    const audio =
      dados.audioUrl ?? dados.url_audio ?? dados.url ?? dados.audio ?? "";

    const codigo = texto(dados.id, 100)
      ? dados.id.trim()
      : crypto.randomUUID();

    if (
      !texto(nome, 150) ||
      !texto(idioma, 50) ||
      typeof descricao !== "string" ||
      descricao.length > 500 ||
      !urlAudioValida(audio)
    ) {
      return res.status(400).json({
        erro: "Confira o nome, idioma, descrição e endereço do áudio."
      });
    }

    const resultado = await pool.query(
      `
      INSERT INTO programas
        (codigo_externo, nome, idioma, descricao, url_audio, ativo)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING
        id, codigo_externo, nome, idioma, descricao, url_audio, ativo
      `,
      [
        codigo,
        nome.trim(),
        idioma.trim(),
        descricao.trim(),
        audio.trim()
      ]
    );

    const p = resultado.rows[0];

    res.status(201).json({
      sucesso: true,
      programa: {
        id: p.codigo_externo || String(p.id),
        titulo: p.nome,
        nome: p.nome,
        idioma: p.idioma,
        descricao: p.descricao,
        audioUrl: p.url_audio,
        url_audio: p.url_audio,
        url: p.url_audio,
        ativo: p.ativo
      }
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        erro: "Já existe um programa com esse identificador."
      });
    }

    next(err);
  }
});

// Salva a programação completa.
// NOVO: elimina duplicidades de dia e horário de início,
// mantendo o último item enviado pelo painel.
app.put(
  "/api/admin/programacao",
  exigirAdmin,
  async (req, res, next) => {
    let lista = req.body;

    if (!Array.isArray(lista) || lista.length > 500) {
      return res.status(400).json({
        erro: "Envie uma lista válida de até 500 horários."
      });
    }

    // Confere a estrutura básica antes de comparar os horários.
    for (const item of lista) {
      const inicio = item?.inicio ?? item?.horario;

      if (
        !item ||
        !texto(item.programaId, 100) ||
        !horarioValido(inicio) ||
        (item.diaSemana !== undefined &&
          item.diaSemana !== null &&
          (!Number.isInteger(item.diaSemana) ||
            item.diaSemana < 0 ||
            item.diaSemana > 6))
      ) {
        return res.status(400).json({
          erro: "Há um horário inválido na programação."
        });
      }
    }

    // A chave considera o dia da semana e o horário de início.
    // Quando a chave se repete, o último item prevalece.
    const horariosUnicos = new Map();

    for (const item of lista) {
      const inicio = item.inicio ?? item.horario;
      const dia = item.diaSemana ?? "todos";
      const chave = `${dia}|${inicio}`;

      horariosUnicos.set(chave, item);
    }

    lista = [...horariosUnicos.values()];

    if (lista.length > 500) {
      return res.status(400).json({
        erro: "A programação ultrapassa o limite permitido."
      });
    }

    // Valida identificadores repetidos nos horários restantes.
    const ids = new Set();

    for (const item of lista) {
      if (
        (item.id !== undefined && !texto(item.id, 100)) ||
        (item.ativo !== undefined && typeof item.ativo !== "boolean") ||
        (item.fim !== undefined && !horarioValido(item.fim)) ||
        (item.id && ids.has(item.id))
      ) {
        return res.status(400).json({
          erro: "Há um horário inválido ou identificador duplicado."
        });
      }

      if (item.id) ids.add(item.id);
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const horariosResolvidos = [];

      // Confere se todos os programas existem.
      for (const item of lista) {
        const codigoPrograma = String(item.programaId);

        const programa = await client.query(
          `
          SELECT id
          FROM programas
          WHERE codigo_externo = $1 OR id::text = $1
          LIMIT 1
          `,
          [codigoPrograma]
        );

        if (programa.rowCount === 0) {
          throw Object.assign(
            new Error("Programa não encontrado: " + codigoPrograma),
            { status: 400 }
          );
        }

        const inicio = item.inicio ?? item.horario;

        let fim = item.fim;

        // Se não houver fim, usa uma duração de uma hora.
        if (!fim) {
          const [h, m] = inicio.split(":").map(Number);
          const minutos = (h * 60 + m + 60) % (24 * 60);

          fim =
            String(Math.floor(minutos / 60)).padStart(2, "0") +
            ":" +
            String(minutos % 60).padStart(2, "0");
        }

        if (inicio === fim) {
          throw Object.assign(
            new Error("O início e o fim não podem ser iguais."),
            { status: 400 }
          );
        }

        horariosResolvidos.push({
          codigo: texto(item.id, 100)
            ? item.id.trim()
            : crypto.randomUUID(),
          programaId: programa.rows[0].id,
          diaSemana: item.diaSemana ?? null,
          inicio,
          fim,
          descricao:
            typeof item.descricao === "string"
              ? item.descricao.slice(0, 500)
              : "",
          ativo: item.ativo !== false
        });
      }

      // Substitui a programação, preservando os horários
      // que vieram na lista completa do painel.
      await client.query("DELETE FROM programacao");

      for (const h of horariosResolvidos) {
        await client.query(
          `
          INSERT INTO programacao
            (
              codigo_externo,
              programa_id,
              dia_semana,
              horario_inicio,
              horario_fim,
              descricao,
              ativo
            )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            h.codigo,
            h.programaId,
            h.diaSemana,
            h.inicio,
            h.fim,
            h.descricao,
            h.ativo
          ]
        );
      }

      await client.query("COMMIT");

      res.json({
        sucesso: true,
        total: horariosResolvidos.length,
        mensagem: "Programação salva com sucesso."
      });
    } catch (err) {
      await client.query("ROLLBACK");

      if (err.status === 400) {
        return res.status(400).json({
          erro: err.message
        });
      }

      next(err);
    } finally {
      client.release();
    }
  }
);

// Tratamento geral de erros.
app.use((err, req, res, next) => {
  console.error("Erro na aplicação:", err.message);

  if (res.headersSent) return next(err);

  res.status(err.status || 500).json({
    erro:
      err.status === 400
        ? err.message
        : "Ocorreu um erro interno no servidor."
  });
});

// Inicialização.
async function iniciar() {
  try {
    await prepararBanco();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Amazon Voices Radio disponível na porta ${PORT}`
      );
    });
  } catch (err) {
    console.error(
      "Não foi possível preparar o banco:",
      err.message
    );
    process.exit(1);
  }
}

iniciar();

async function encerrar() {
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", encerrar);
process.on("SIGINT", encerrar);
