# Arquitetura

O app tem duas camadas:

```
┌──────────────────────────── DualSense Edge Studio.app ────────────────────────────┐
│                                                                                    │
│  src/main.m (Objective-C, AppKit)            web/ (HTML + CSS + JS, sem build)     │
│  ┌──────────────────────────────┐            ┌──────────────────────────────────┐  │
│  │ EdgeHID (IOKit HID)          │   eventos  │ native.js  (ponte)               │  │
│  │  • casa VID 054C / PID 0DF2  │ ─────────▶ │ app.js     (estado, abas)        │  │
│  │  • input report 0x01         │            │ proto.js   (perfis ↔ bytes)      │  │
│  │  • feature/output reports    │ ◀───────── │ hw.js, diag.js, backup.js, …     │  │
│  ├──────────────────────────────┤  comandos  └──────────────────────────────────┘  │
│  │ AppDelegate                  │                       ▲                          │
│  │  • janela + WKWebView        │                       │ WKWebView                │
│  │  • barra de menus/bateria    │───────────────────────┘                          │
│  │  • arquivos (Application     │                                                  │
│  │    Support), abrir/salvar    │                                                  │
│  │  • GameController (gatilhos) │                                                  │
│  └──────────────────────────────┘                                                  │
└────────────────────────────────────────────────────────────────────────────────────┘
                         │ USB (IOKit HID)
                         ▼
                  DualSense Edge
```

- **Parte nativa (`src/main.m`)**: abre o controle com IOKit HID, repassa os input reports para a interface, executa leituras e gravações de feature reports, cuida da janela, da barra de menus, das notificações de bateria e dos arquivos.
- **Interface (`web/`)**: toda a lógica de perfis, protocolo e telas. É carregada num `WKWebView` a partir de `Contents/Resources/web`. Não há bundler nem dependências externas.

## Ponte JS ↔ nativo

### Comandos (JS → nativo)

A interface chama `Native.call(cmd, args)`, que vira `window.webkit.messageHandlers.hid.postMessage({cmd, ...args})`. O lado nativo usa `WKScriptMessageHandlerWithReply`, então cada chamada devolve uma `Promise` com o resultado ou com uma mensagem de erro.

| Comando | Argumentos | Resultado |
|---|---|---|
| `status` | – | `{type:"status", connected, transport, bluetoothOnly, serial}` |
| `menuInfo` | `profile` | Atualiza o perfil ativo mostrado na barra de menus. |
| `resetYaw` | – | Zera o giro lateral integrado. |
| `log` | `text` | Escreve no log do sistema (depuração). |
| `loadFile` | `name` (`library`, `state`, `history`) | Conteúdo do arquivo JSON ou `""`. |
| `saveFile` | `name`, `text` | Grava o arquivo em Application Support. |
| `exportJSON` | `text`, `filename` | Abre o painel "Salvar" e grava o arquivo escolhido. |
| `importJSON` | – | Abre o painel "Abrir" e devolve o texto do arquivo, ou `null`. |
| `readProfiles` | – | 12 arrays de 64 bytes (feature reports `0x70`–`0x7B`). |
| `readFeature` | `id` | Um feature report de leitura (a aba Diagnóstico usa `0x20` para firmware/hardware e `0x09` para o endereço Bluetooth). |
| `writeFeatures` | `reports` | Grava uma lista de feature reports. **Só aceita `0x60`–`0x63` e `0x68`.** |
| `rumble` | `strength` (0–255), `ms` | Vibração curta nos dois motores (output `0x02`), usada como confirmação. |
| `output` | `bytes` | Envia um output report. **Só aceita `0x02`**, com no máximo 64 bytes. |
| `gc` | `light`, `player`, `trigger` | Luz, LED de jogador e efeitos dos gatilhos adaptativos via framework GameController (resistência, arma, vibração). |

Qualquer outro comando devolve o erro "Comando desconhecido".

### Eventos (nativo → JS)

O nativo chama `window.EdgeNative.onEvent(evt)`. Tipos de evento:

| `type` | Quando | Conteúdo |
|---|---|---|
| `status` | Conexão/desconexão, troca de transporte | `connected`, `transport` (`USB`/`Bluetooth`), `bluetoothOnly`, … |
| `input` | Input report `0x01` (limitado para não sobrecarregar a interface) | `data` (bytes), `yaw` (graus integrados), `rate` (estatísticas da taxa de USB) |
| `error` | Falha ao abrir o dispositivo | `code`, `message` (ex.: falta de permissão de Monitoramento de Entrada) |
| `gc` | O framework GameController encontrou ou perdeu o controle | `available` |

### Simulador

Quando `web/index.html` é aberto num navegador comum (sem `window.webkit.messageHandlers`), `native.js` troca a ponte por um simulador: devolve slots de exemplo, gera input reports sintéticos e guarda os arquivos em `localStorage`. Isso permite desenvolver e testar a interface sem o controle. Veja [DESENVOLVIMENTO.md](DESENVOLVIMENTO.md#rodar-a-interface-no-navegador).

## Fluxo de leitura e gravação

1. `readProfiles` lê `0x70`–`0x7B` e `Proto.parseAll` transforma os 12 reports em 4 perfis (△ □ ✕ ○). Os bytes originais ficam em `profile.raw`.
2. A interface edita uma cópia (rascunho) no formato JSON do edge-config.com.
3. Ao gravar, `Backup.record` guarda o conteúdo atual do slot no histórico.
4. `Proto.encode(profile, selector)` monta 3 reports partindo de `raw` (preserva campos desconhecidos), aplica as mudanças, grava data/hora e calcula os CRCs.
5. `writeFeatures` envia os 3 reports. A interface relê os slots para confirmar.

Limpar um slot segue o mesmo caminho com `Proto.clearReport(selector)` (feature `0x68`).

## Arquivos salvos

Pasta: `~/Library/Application Support/DualSense Edge Studio/`

| Arquivo | Conteúdo |
|---|---|
| `library.json` | Perfis da biblioteca (formato edge-config.com). |
| `state.json` | Último slot ativo, inversão de eixos do monitor e ajustes da aba Hardware. |
| `history.json` | Cópias dos slots antes de cada gravação, limpeza ou restauração (até 60). |

As preferências da barra de menus (continuar ao fechar a janela, aviso de bateria) ficam em `NSUserDefaults` do domínio `local.dualsense-edge-studio` (chaves `quitOnClose` e `noBatteryWarning`).

## Módulos da interface

| Arquivo | Responsabilidade |
|---|---|
| `app.js` | Estado global, barra lateral, abas Botões/Analógicos/Gatilhos/Presets/Monitor, biblioteca, gravação. Define os utilitários usados pelos outros módulos (`$`, `$$`, `call`, `toast`, `confirmDialog`, …). |
| `proto.js` | Protocolo (sem dependências): slots, botões, curvas, CRC32, `parseAll`, `encode`, `clearReport`, `parseInput`. |
| `native.js` | Ponte com o app ou simulador. |
| `controller.js` | SVG do controle e glifos dos botões. |
| `model3d.js` | Controle 3D do monitor de giroscópio. |
| `presets.js` | Lista de presets por categoria. |
| `hw.js` | Aba Hardware e montagem do output report `0x02`. |
| `diag.js` | Aba Diagnóstico (drift, circularidade, gatilhos, taxa de USB, informações do controle). |
| `compare.js` | Comparação lado a lado e cópia B → A. |
| `backup.js` | Backup completo e histórico. |

Os scripts são carregados em ordem por `index.html` como scripts clássicos; cada módulo expõe um objeto global (`Proto`, `Native`, `HW`, `Backup`, …).
