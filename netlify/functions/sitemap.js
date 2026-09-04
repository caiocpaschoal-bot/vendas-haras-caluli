const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQS-eXSNR9uq4uqX4MNXxbG6_DrD1rm1UeV_QLLZzvots3vboTuwTBxT_E63PTEdj-yH3T-TjwBqgpo/pub?output=csv";
const SITE_URL = "https://harascaluli.com.br";

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

function escapaXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

exports.handler = async function () {
  const hoje = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE_URL}/`, prioridade: "1.0" }
  ];

  try {
    const resposta = await fetch(CSV_URL);
    const texto = await resposta.text();
    const linhas = parseCSV(texto);
    const cabecalho = linhas[0].map(normalizaCabecalho);
    const idxNome = cabecalho.findIndex((h) => h.startsWith("nome"));
    const idxTipo = cabecalho.findIndex((h) => h.startsWith("tipo"));

    const slugsVistos = new Set();
    for (let i = 1; i < linhas.length; i++) {
      const linha = linhas[i];
      if (!linha[idxNome] || !linha[idxTipo]) continue;
      const slug = normalizaSlug(linha[idxNome]);
      if (!slug || slugsVistos.has(slug)) continue;
      slugsVistos.add(slug);
      urls.push({ loc: `${SITE_URL}/lote/${slug}`, prioridade: "0.8" });
    }
  } catch (erro) {
    // Se a planilha falhar, devolve pelo menos a home no sitemap (nunca quebra)
  }

  const corpo = urls.map((u) => `  <url>
    <loc>${escapaXml(u.loc)}</loc>
    <lastmod>${hoje}</lastmod>
    <priority>${u.prioridade}</priority>
  </url>`).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${corpo}
</urlset>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
    body: xml
  };
};
