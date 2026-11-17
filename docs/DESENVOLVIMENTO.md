# Desenvolvimento

## Requisitos

- macOS 12 ou mais recente.
- Command Line Tools da Apple (`clang`, `codesign`):

```bash
xcode-select --install
```

Não há dependências externas, gerenciador de pacotes nem etapa de build para a interface.

## Compilar

```bash
./build.sh
```

O script:

1. compila `src/main.m` com `clang` para `arm64` e `x86_64` (binário universal), ligando Cocoa, WebKit, IOKit, UniformTypeIdentifiers, GameController e UserNotifications;
2. copia `web/` para `Contents/Resources/web` e o ícone `assets/AppIcon.icns`;
3. gera o `Info.plist` (bundle id `local.dualsense-edge-studio`, macOS mínimo 12.0);
4. assina o app de forma local (`codesign --sign -`);
5. pede ao LaunchServices para reler o ícone.

Resultado: `build/DualSense Edge Studio.app`. A pasta `build/` não vai para o Git.

Como a interface é copiada para dentro do app, **é preciso rodar `./build.sh` de novo depois de mudar qualquer arquivo em `web/`**.

## Rodar a interface no navegador

A interface funciona num navegador comum com um simulador (dados de exemplo, input report sintético e arquivos em `localStorage`), o que é útil para mexer no layout sem o controle:

```bash
python3 -m http.server 8766 --bind 127.0.0.1 --directory web
```

Abra `http://127.0.0.1:8766`. O indicador de conexão mostra "USB (simulado)".

No Claude Code, a mesma configuração está em `.claude/launch.json` (`ui-preview`).

O simulador não substitui o teste com o controle real: leitura/gravação de slots, permissões do macOS, barra de menus e gatilhos adaptativos só podem ser verificados no app nativo.

## Mockups

`mockups/index.html` reúne estudos de layout da interface (abra direto no navegador). Não fazem parte do app.

## Depuração

- **Interface no app**: no macOS 13.3 ou mais recente o `WKWebView` é inspecionável. Ative *Safari › Ajustes › Avançado › Mostrar recursos para desenvolvedores web* e abra *Safari › Desenvolvedor › (seu Mac) › DualSense Edge Studio*.
- **Logs nativos**: a interface manda mensagens com `Native.call("log", {text})`, que aparecem como `[EdgeStudio]` no Console.app.
- **Report bruto**: a aba Monitor mostra o input report `0x01` em hexadecimal.

## Regras de segurança do código

Ao mexer na parte nativa, mantenha estas garantias:

- `writeFeatures` só aceita os feature reports `0x60`–`0x63` (perfis) e `0x68` (limpar slot).
- `output` só aceita o output report `0x02`, com no máximo 64 bytes.
- A interface nunca grava nem limpa o slot △ (`0x63`).
- `Proto.encode` parte dos bytes originais do slot para não perder campos que o app não conhece.
- Toda gravação, limpeza ou restauração registra antes uma cópia no histórico (`Backup.record`).

## Testar uma mudança de protocolo

1. Faça um backup dos slots (botão **Backup**).
2. Leia um slot gravado pelo PS5 e confira que `Proto.encode(Proto.parseAll(...)[i], seletor)` gera os mesmos bytes lidos (com exceção da data/hora e dos CRCs que dependem dela).
3. Grave num slot de teste (□, ✕ ou ○), releia e compare.
4. Se algo der errado, restaure pelo histórico ou pelo arquivo de backup.

## Estilo

- Objective-C com ARC, compilado com `-Wall`.
- JavaScript sem framework, em `"use strict"`, um módulo por arquivo exposto como objeto global.
- Textos da interface em português do Brasil.

## Publicar uma versão

1. Atualize `CFBundleShortVersionString`/`CFBundleVersion` em `build.sh` e o [CHANGELOG](../CHANGELOG.md).
2. Rode `./build.sh` e compacte o app:

   ```bash
   ditto -c -k --keepParent "build/DualSense Edge Studio.app" "DualSense-Edge-Studio.zip"
   ```

3. Crie uma tag e uma release no GitHub com o `.zip`. Como o app não é notarizado, quem baixar precisa abrir com botão direito › **Abrir** na primeira vez.
