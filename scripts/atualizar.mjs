// Consulta DJEN (ComunicaAPI) e DataJud (CNJ) para os processos de data/processos.json
// e grava o resultado em data/andamentos.json, que o aplicativo lê ao abrir.
// Uso: node scripts/atualizar.mjs   (Node 18+)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQ_LISTA = path.join(RAIZ, 'data', 'processos.json');
const ARQ_SAIDA = path.join(RAIZ, 'data', 'andamentos.json');

const DJEN_API_URL = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
// Chave pública do DataJud, divulgada pelo CNJ. Pode ser sobrescrita pela variável de ambiente.
const DATAJUD_API_KEY = process.env.DATAJUD_API_KEY?.trim() || 'cDZHYzlZa0JadVREZDJCendQbXo6TGllS0xNavigationKeyPublicaCNJ';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAPA_TJ = {
  '01': 'tjac', '02': 'tjal', '03': 'tjap', '04': 'tjam', '05': 'tjba', '06': 'tjce', '07': 'tjdft',
  '08': 'tjes', '09': 'tjgo', '10': 'tjma', '11': 'tjmt', '12': 'tjms', '13': 'tjmg', '14': 'tjpa',
  '15': 'tjpb', '16': 'tjpr', '17': 'tjpe', '18': 'tjpi', '19': 'tjrj', '20': 'tjrn', '21': 'tjrs',
  '22': 'tjro', '23': 'tjrr', '24': 'tjsc', '25': 'tjse', '26': 'tjsp', '27': 'tjto'
};

export function extrairTribunalDatajud(numeroCnj) {
  const limpo = String(numeroCnj).replace(/\D/g, '');
  if (limpo.length !== 20) return null;
  const j = limpo.substring(13, 14);
  const tr = limpo.substring(14, 16);
  if (j === '8') return MAPA_TJ[tr] || null;
  if (j === '4') return /^0[1-6]$/.test(tr) ? `trf${Number(tr)}` : null;
  if (j === '5') return Number(tr) >= 1 && Number(tr) <= 24 ? `trt${Number(tr)}` : null;
  return null;
}

async function comRetentativas(fn, tentativas = 3) {
  let ultimoErro;
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimoErro = e;
      if (i < tentativas) await sleep(2000 * i);
    }
  }
  throw ultimoErro;
}

async function buscarDjen(numeroLimpo) {
  const url = new URL(DJEN_API_URL);
  url.searchParams.set('itensPorPagina', '100');
  url.searchParams.set('pagina', '1');
  url.searchParams.set('numeroProcesso', numeroLimpo);
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`DJEN HTTP ${res.status}`);
  const data = await res.json();
  const itens = data.items || data.comunicacoes || [];
  return itens.map((it) => ({
    id: String(it.id ?? ''),
    data: it.dataDisponibilizacao || it.data_disponibilizacao || 'Data N/A',
    texto: it.texto || it.conteudo || 'Sem texto disponível.',
    orgao: it.nomeOrgao || it.siglaTribunal || ''
  }));
}

async function buscarDataJud(numero) {
  const tribunal = extrairTribunalDatajud(numero);
  if (!tribunal) return null;
  const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${tribunal}/_search`;
  const payload = { query: { match: { numeroProcesso: String(numero).replace(/\D/g, '') } } };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'APIKey ' + DATAJUD_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`DataJud (${tribunal}) HTTP ${res.status}`);
  const data = await res.json();
  const hit = data?.hits?.hits?.[0]?._source;
  if (!hit) return { tribunal: tribunal.toUpperCase(), orgao: '', movimentos: [] };
  const movimentos = (hit.movimentos || []).map((m) => ({
    data: m.dataHora ? m.dataHora.split('T')[0] : 'Data N/A',
    nome: m.nome || 'Movimentação sem descrição',
    complemento: m.complementosTabelados ? m.complementosTabelados.map((c) => c.nome).join(' - ') : ''
  }));
  // Mais recentes primeiro, como o aplicativo exibe.
  movimentos.sort((a, b) => String(b.data).localeCompare(String(a.data)));
  return { tribunal: tribunal.toUpperCase(), orgao: hit.orgaoJulgador?.nome || '', movimentos };
}

const dataMaisRecente = (lista) =>
  lista.map((m) => m.data).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort().pop() || '';

async function main() {
  const lista = JSON.parse(await readFile(ARQ_LISTA, 'utf8')).processos || [];
  let anterior = { processos: {} };
  try {
    anterior = JSON.parse(await readFile(ARQ_SAIDA, 'utf8'));
  } catch { /* primeira execução */ }

  const resultado = {};
  let falhas = 0;

  for (const item of lista) {
    const numero = typeof item === 'string' ? item : item.numero;
    const chave = String(numero || '').replace(/\D/g, '');
    if (chave.length !== 20) {
      console.warn(`Ignorado (número CNJ inválido): ${numero}`);
      continue;
    }
    const antes = anterior.processos?.[chave];
    const reg = {
      numero: antes?.numero || numero,
      customName: (typeof item === 'object' && (item.apelido || item.customName)) || '',
      tag: (typeof item === 'object' && item.tag) || 'Geral',
      tribunal: antes?.tribunal || 'Tribunal não informado',
      lastUpdate: antes?.lastUpdate || '',
      movimentacoesDjen: antes?.movimentacoesDjen || [],
      movimentacoesDatajud: antes?.movimentacoesDatajud || [],
      consultadoEm: antes?.consultadoEm || null,
      erro: null
    };
    const erros = [];

    try {
      const djen = await comRetentativas(() => buscarDjen(chave));
      reg.movimentacoesDjen = djen;
      if (djen.length) reg.tribunal = djen[0].orgao || reg.tribunal;
    } catch (e) {
      erros.push(e.message);
    }

    try {
      const dj = await comRetentativas(() => buscarDataJud(numero));
      if (dj) {
        reg.movimentacoesDatajud = dj.movimentos;
        if (reg.tribunal === 'Tribunal não informado') reg.tribunal = [dj.tribunal, dj.orgao].filter(Boolean).join(' - ');
      }
    } catch (e) {
      erros.push(e.message);
    }

    reg.lastUpdate =
      dataMaisRecente(reg.movimentacoesDjen) || dataMaisRecente(reg.movimentacoesDatajud) || reg.lastUpdate;
    if (erros.length) {
      reg.erro = erros.join('; ');
      falhas++;
    } else {
      reg.consultadoEm = new Date().toISOString();
    }
    resultado[chave] = reg;
    console.log(`${numero}: DJEN ${reg.movimentacoesDjen.length}, DataJud ${reg.movimentacoesDatajud.length}${reg.erro ? ' [ERRO: ' + reg.erro + ']' : ''}`);
    await sleep(800);
  }

  await writeFile(ARQ_SAIDA, JSON.stringify({ geradoEm: new Date().toISOString(), processos: resultado }, null, 1) + '\n');
  console.log(`Concluído: ${Object.keys(resultado).length} processo(s), ${falhas} com erro.`);
  // Só falha o job se TODOS falharam (ex.: API fora do ar); falhas parciais mantêm os dados anteriores.
  if (lista.length > 0 && falhas === Object.keys(resultado).length && falhas > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
