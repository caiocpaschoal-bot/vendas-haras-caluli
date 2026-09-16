const fs = require("fs");
const path = require("path");

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQS-eXSNR9uq4uqX4MNXxbG6_DrD1rm1UeV_QLLZzvots3vboTuwTBxT_E63PTEdj-yH3T-TjwBqgpo/pub?output=csv";

function normalizaSlug(nome) {
  return String(nome || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function normalizaCabecalho(h) {
  return String(h || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
}

// Parser simples de CSV, respeitando campos entre aspas (com vírgulas dentro)
function parseCSV(texto) {
  const linhas = [];
  let linhaAtual = [];
  let campoAtual = "";
  let dentroAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    const prox = texto[i + 1];
    if (dentroAspas) {
      if (c === '"' && prox === '"') { campoAtual += '"'; i++; }
      else if (c === '"') { dentroAspas = false; }
      else { campoAtual += c; }
    } else {
      if (c === '"') { dentroAspas = true; }
      else if (c === ',') { linhaAtual.push(campoAtual); campoAtual = ""; }
      else if (c === '\r') { /* ignora */ }
      else if (c === '\n') { linhaAtual.push(campoAtual); linhas.push(linhaAtual); linhaAtual = []; campoAtual = ""; }
      else { campoAtual += c; }
    }
  }
  if (campoAtual.length > 0 || linhaAtual.length > 0) {
    linhaAtual.push(campoAtual);
    linhas.push(linhaAtual);
  }
  return linhas;
}

function extrairIdDrive(url) {
  const m = String(url || "").match(/drive\.google\.com\/file\/d\/([^/]+)/);
  return m ? m[1] : null;
}

function escapaHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function lerIndexHtml() {
  // O arquivo index.html é incluído no pacote da function via "included_files" no netlify.toml
  const candidatos = [
    path.join(__dirname, "index.html"),
    path.join(process.cwd(), "index.html")
  ];
  for (const p of candidatos) {
    try { return fs.readFileSync(p, "utf8"); } catch (e) { /* tenta o próximo */ }
  }
  throw new Error("index.html não encontrado no pacote da function");
}

// Extrai um preco numerico do campo Valor, so quando ele for um valor unico
// e limpo ("R$ 30.000,00"). Parcelamentos ("30 parcelas de R$ 1.500,00") nao
// cabem no formato que o Google entende, entao ficam de fora do schema.
function extrairPreco(valor) {
  const texto = String(valor || "");
  if (/parcel|\bx\b|entrada|consult|combinar/i.test(texto)) return null;
  const achados = texto.match(/\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?/g);
  if (!achados || achados.length !== 1) return null;
  const numero = Number(achados[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) && numero > 0 ? numero.toFixed(2) : null;
}

exports.handler = async function (event) {
  // Pega o slug do caminho da URL (mais confiável que query string em redirects do Netlify).
  // Aceita tanto /.netlify/functions/lote/algo quanto ?slug=algo (retrocompatibilidade).
  const caminho = event.path || "";
  const doPath = caminho.match(/\/lote\/([^/?#]+)/);
  const slug = doPath
    ? decodeURIComponent(doPath[1])
    : (event.queryStringParameters && event.queryStringParameters.slug);
  let html = lerIndexHtml();

  try {
    if (slug) {
      const resposta = await fetch(CSV_URL);
      const texto = await resposta.text();
      const linhas = parseCSV(texto);
      const cabecalho = linhas[0].map(normalizaCabecalho);

      const achaColuna = (padroes) =>
        cabecalho.findIndex((h) => padroes.some((p) => h.startsWith(p)));

      const idxNome = achaColuna(["nome"]);
      const idxTipo = achaColuna(["tipo"]);
      const idxObs = achaColuna(["observ"]);
      const idxFotos = achaColuna(["foto"]);
      const idxValor = achaColuna(["valor"]);
      const idxPai = achaColuna(["pai"]);
      const idxMae = achaColuna(["mae"]);

      let encontrado = null;
      for (let i = 1; i < linhas.length; i++) {
        const linha = linhas[i];
        if (!linha[idxNome]) continue;
        if (normalizaSlug(linha[idxNome]) === slug) { encontrado = linha; break; }
      }

      if (encontrado) {
        const nome = encontrado[idxNome] || "";
        const tipo = encontrado[idxTipo] || "";
        const obsCompleta = encontrado[idxObs] || "";
        const obs = obsCompleta.length > 180 ? obsCompleta.slice(0, 177) + "..." : obsCompleta;

        const pai = (encontrado[idxPai] || "").trim();
        const mae = (encontrado[idxMae] || "").trim();
        const valor = (encontrado[idxValor] || "").trim();
        const filiacao = pai && mae ? ` Filho(a) de ${pai} em ${mae}.` : "";

        const titulo = `${nome} — Haras Calúli`;
        const descricao = obs ||
          `${tipo || "Lote"} disponível no Haras Calúli, criação de Mangalarga Marchador de Marcha Picada em Gravatá-PE.${filiacao}`;
        const urlLote = `https://www.harascaluli.com.br/lote/${encodeURIComponent(slug)}`;

        let imagem = "https://www.harascaluli.com.br/og-image.jpg";
        const fotosCampo = encontrado[idxFotos] || "";
        const primeiraFoto = fotosCampo.split(/[,;\s]+/).map((f) => f.trim()).filter(Boolean)[0];
        if (primeiraFoto) {
          const driveId = extrairIdDrive(primeiraFoto);
          if (driveId) imagem = `https://lh3.googleusercontent.com/d/${driveId}=w1200`;
        }

        const urlLoteEsc = escapaHtml(urlLote);
        const tituloEsc = escapaHtml(titulo);
        const descricaoEsc = escapaHtml(descricao);
        const imagemEsc = escapaHtml(imagem);

        // Dados estruturados (schema.org) — ajuda o Google a entender que é
        // um anúncio de animal, com nome, foto e descrição.
        const dados = {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": nome,
          "description": obsCompleta || descricao,
          "image": imagem,
          "url": urlLote,
          "brand": { "@type": "Organization", "name": "Haras Calúli" },
          "category": tipo
        };
        const preco = extrairPreco(valor);
        if (preco) {
          dados.offers = {
            "@type": "Offer",
            "price": preco,
            "priceCurrency": "BRL",
            "availability": "https://schema.org/InStock",
            "url": urlLote,
            "seller": { "@type": "Organization", "name": "Haras Calúli" }
          };
        }
        const jsonLd = JSON.stringify(dados);

        html = html
          .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${descricaoEsc}">`)
          // sem isto, cada pagina de lote se declara copia da home e o Google nao a indexa
          .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${urlLoteEsc}">`)
          .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${urlLoteEsc}">`)
          .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${tituloEsc}">`)
          .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${descricaoEsc}">`)
          .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${imagemEsc}">`)
          .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${tituloEsc}">`)
          .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${descricaoEsc}">`)
          .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${imagemEsc}">`)
          .replace(/<title>[^<]*<\/title>/, `<title>${tituloEsc}</title>`)
          .replace("</head>", `<script type="application/ld+json">${jsonLd}</script>\n</head>`);
      }
    }
  } catch (erro) {
    // Se algo falhar, devolve o site normal (sem prévia customizada) em vez de quebrar
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: html
  };
};
