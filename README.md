# Sentinela

Aplicativo web instalável (PWA) que acompanha andamentos processuais no DJEN (ComunicaAPI) e no DataJud (CNJ).
Aviso: caráter meramente informativo; não substitui a intimação oficial nem a contagem de prazos.

## Como funciona
1. **Robô diário** (`.github/workflows/atualizar.yml`): em dias úteis, por volta das 6h (Brasília), consulta os processos de `data/processos.json` e grava o resultado em `data/andamentos.json`.
2. **Aplicativo** (`index.html`): ao abrir, lê `data/andamentos.json`, mostra os andamentos e marca os processos com novidade; em seguida consulta as APIs ao vivo.

## Configuração
- **Instalar no celular/computador:** abra https://andreoliveiracalazans-alt.github.io/djen/ e use "Adicionar à tela inicial" / "Instalar aplicativo".
- **Lista de processos do robô:** edite `data/processos.json` no GitHub (um item `{"numero": "0000000-00.0000.0.00.0000", "apelido": "..."}` por processo). O robô roda de novo sozinho ao salvar o arquivo.
- **Rodar na hora:** GitHub → aba Actions → "Atualizar andamentos" → Run workflow.
- **Chave do DataJud:** o CNJ pode trocar a chave pública. Se o DataJud parar de responder, cadastre a chave vigente (https://datajud-wiki.cnj.jus.br/api-publica/acesso) em Settings → Secrets and variables → Actions → `DATAJUD_API_KEY`.
- O workflow agendado só roda a partir da branch padrão (`main`).
