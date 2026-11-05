# Instruções de trabalho — RebecaPed

## Branches e integração

- Repositório remoto: `rebecamartinsaguiar/RebecaPed`.
- Trabalhe na branch `desenvolvimento`. `main` é produção e não deve receber alterações diretas sem necessidade específica e autorização expressa.
- Conclua implementação e verificações na branch de desenvolvimento e prepare um Pull Request para revisão antes de integrar em `main`.

## GitHub Pages

- URL oficial: `https://rebecamartinsaguiar.github.io/RebecaPed/`.
- A hospedagem usa GitHub Pages por meio do workflow personalizado `.github/workflows/deploy-pages.yml`, executado em push para `main` ou manualmente. Não altere/remova o workflow sem necessidade técnica e explicação prévia.
- O workflow prepara `_site` com `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `service-worker.js`, `supabase-config.js` e `assets/` quando existir; publica com `actions/upload-pages-artifact@v4` e `actions/deploy-pages@v4`.
- Preserve o prefixo `/RebecaPed/` nos caminhos. Verifique que links, scripts, estilos, manifest, ícones e Service Worker funcionem sob esse subcaminho.
- Arquivos estáticos novos devem ser verificados contra o conteúdo de `_site`; ajuste o workflow apenas se o novo arquivo não estiver contemplado e a inclusão for necessária.

## PWA, cache e Supabase

- Para alterações estruturais ou recursos novos, revise o versionamento do cache em `service-worker.js`, a estratégia de ativação/atualização e os recursos precacheados. Considere que o deploy pode concluir enquanto o navegador ainda exibe arquivos antigos.
- Preserve `manifest.webmanifest` e o comportamento PWA existente.
- Nunca exponha chaves secretas, especialmente `service_role`, no frontend ou em arquivos públicos/versionados. Apenas chave pública apropriada pode ser usada no navegador.

## Fechamento de implementação

- Não considere uma alteração concluída só porque o código foi escrito: confira referências, caminhos, dependências, compatibilidade com Pages no subcaminho e inclusão no pacote de publicação.
- Ao relatar o resultado, liste arquivos modificados, verificações realizadas e se houve alteração necessária no workflow. Não afirmar que houve deploy sem confirmação da execução bem-sucedida do GitHub Actions e da versão servida.
