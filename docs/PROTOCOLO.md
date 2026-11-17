# Protocolo USB do DualSense Edge

Referência do que o app usa para ler e gravar perfis. A implementação está em [`web/proto.js`](../web/proto.js) e, para o output report, em [`web/hw.js`](../web/hw.js).

- Vendor ID `0x054C` (Sony), Product ID `0x0DF2` (DualSense Edge).
- Todos os reports têm 64 bytes; o byte 0 é o ID do report.
- Os perfis só podem ser lidos e gravados por USB.

> **Validação**: com um controle real, ler um perfil gravado pelo PS5 e codificá-lo de novo gera exatamente os mesmos bytes, com o mesmo CRC. Regravar um perfil e relê-lo também devolve os mesmos bytes.

## Slots

| Slot | Atalho | Ler (3 reports) | Gravar | Limpar (`0x68`, byte 1) |
|---|---|---|---|---|
| △ Padrão | FN + △ | `0x70` `0x71` `0x72` | `0x63` (o app não grava) | – |
| □ | FN + □ | `0x73` `0x74` `0x75` | `0x60` | `2` |
| ✕ | FN + ✕ | `0x76` `0x77` `0x78` | `0x61` | `3` |
| ○ | FN + ○ | `0x79` `0x7A` `0x7B` | `0x62` | `4` |

Para gravar, os 3 reports usam o mesmo ID (o seletor do slot), diferenciados pelo byte 1 (`0`, `1`, `2`).

## Layout de um perfil

Offsets relativos ao início de cada report de 64 bytes (byte 0 = ID).

### Parte 0

| Bytes | Conteúdo |
|---|---|
| 0 | ID do report |
| 1 | Índice da parte (`0`). Na leitura, `16` indica slot vazio. |
| 2 | `1` |
| 6–59 | Nome do perfil, UTF-16LE, até 27 unidades |
| 60–63 | CRC32 do report |

### Parte 1

| Bytes | Conteúdo |
|---|---|
| 1 | Índice da parte (`1`) |
| 2–27 | Continuação do nome, UTF-16LE, até 13 unidades (total de 40) |
| 28–43 | ID do perfil (16 bytes) |
| 44 | Modificador da curva do analógico esquerdo |
| 47–52 | Curva do analógico esquerdo (6 bytes) |
| 53 | Modificador da curva do analógico direito |
| 56–59 | Curva do analógico direito, bytes 0–3 |
| 60–63 | CRC32 do report |

### Parte 2

| Bytes | Conteúdo |
|---|---|
| 1 | Índice da parte (`2`) |
| 2–3 | Curva do analógico direito, bytes 4–5 |
| 4, 5 | L2: início e fim do curso |
| 6, 7 | R2: início e fim do curso |
| 10–25 | Mapeamento dos 16 botões |
| 30 | Tipo de curva do analógico esquerdo (0–5) |
| 32 | Tipo de curva do analógico direito (0–5) |
| 34–39 | Data/hora da gravação, milissegundos em 48 bits little-endian |
| 56–59 | CRC32 do perfil inteiro (little-endian) |
| 60–63 | CRC32 do report |

Os bytes não listados são preservados: ao gravar, o app parte dos bytes lidos do controle (`profile.raw`).

### Mapeamento de botões

Cada posição da tabela é um botão físico; o valor é a função que ele passa a ter (o mesmo índice = função original).

| Índice | Botão | Índice | Botão |
|---|---|---|---|
| 0 | Direcional ↑ | 8 | R1 |
| 1 | Direcional → | 9 | R2 |
| 2 | Direcional ↓ | 10 | R3 |
| 3 | Direcional ← | 11 | L1 |
| 4 | ○ | 12 | L2 |
| 5 | ✕ | 13 | L3 |
| 6 | □ | 14 | Paddle esquerdo |
| 7 | △ | 15 | Paddle direito |

### Curvas dos analógicos

Cada curva tem 6 bytes (3 pontos x/y). Os 6 tipos do PS5 são gerados a partir de um valor inicial mais um modificador acumulado pelo índice de intensidade (0–10):

| ID | Nome | Modificador |
|---|---|---|
| 0 | Padrão | 3 |
| 1 | Rápida | 3 |
| 2 | Precisa | 4 |
| 3 | Estável | 4 |
| 4 | Digital | 3 |
| 5 | Dinâmica | 3 |

- **Zona morta**: quando o byte 1 da curva é `0` e o byte 0 é maior que zero, o byte 0 representa a zona morta (`byte0 / 255`).
- Uma curva toda em zero significa "padrão do sistema" e é mostrada como Padrão na intensidade 5.
- A tabela completa de valores está em `STICK_PRESETS` em `proto.js`.

## CRCs

Os dois usam CRC32 IEEE (polinômio refletido `0xEDB88320`), gravados em little-endian.

- **CRC do perfil** (parte 2, bytes 56–59): calculado sobre 170 bytes, a concatenação de parte 0 bytes 2–59, parte 1 bytes 2–59 e parte 2 bytes 2–55.
- **CRC por report** (bytes 60–63 de cada parte): calculado sobre o byte de semente `0xA3` seguido dos 64 bytes do report, com os bytes 60–63 zerados.

## Limpar slot

Feature report `0x68` com o byte 1 indicando o slot (`2` □, `3` ✕, `4` ○) e o resto em zero. Depois disso, a leitura do slot devolve `16` no byte 1 da parte 0.

## Input report `0x01` (USB)

| Bytes | Conteúdo |
|---|---|
| 1, 2 | Analógico esquerdo X, Y |
| 3, 4 | Analógico direito X, Y |
| 5, 6 | L2, R2 (0–255) |
| 8 | Bits 0–3: direcional (0 = ↑, sentido horário, 8 = solto); bit 4 □, 5 ✕, 6 ○, 7 △ |
| 9 | Bit 0 L1, 1 R1, 2 L2, 3 R2, 4 Create, 5 Options, 6 L3, 7 R3 |
| 10 | Bit 0 PS, 1 touchpad, 2 mute, 4 FN esquerdo, 5 FN direito, 6 paddle esquerdo, 7 paddle direito |
| 16–21 | Giroscópio (pitch, yaw, roll), int16 LE |
| 22–27 | Acelerômetro (x, y, z), int16 LE, ~8192 = 1 g |
| 33–36, 37–40 | Toques 1 e 2 no touchpad: bit 7 do primeiro byte = sem toque, bits 0–6 = ID; X e Y em 12 bits (grade 1920 × 1080) |
| 53 | Bits 0–3: nível da bateria (`n × 10 + 5`%); bits 4–7: `0` descarregando, `1` carregando, `2` cheia |

## Output report `0x02` (USB)

Usado pela aba Hardware e pela vibração de confirmação. Não fica gravado no controle.

| Bytes | Conteúdo |
|---|---|
| 1 | Flags: `0x01` vibração, `0x02` seleção de haptics, `0x04` gatilho direito, `0x08` gatilho esquerdo |
| 2 | Flags: `0x01` LED do mute, `0x02` controle de economia de energia, `0x04` barra de luz, `0x08` liberar LEDs, `0x10` LEDs de jogador, `0x40` potência dos motores |
| 3 | Motor direito (fraco/rápido) |
| 4 | Motor esquerdo (forte/lento) |
| 9 | LED do mute: `0` apagado, `1` aceso, `2` piscando |
| 10 | Bits de economia de energia (`0` = tudo ativo) |
| 11–21 | Efeito do gatilho direito |
| 22–32 | Efeito do gatilho esquerdo |
| 37 | Redução de potência (nibble alto: vibração, baixo: gatilhos; `0` = total) |
| 39 | Flags: `0x02` configuração da barra de luz |
| 42 | Configuração da barra de luz (`2` = apagar o azul padrão) |
| 43 | Brilho dos LEDs de jogador: `0` alto, `1` médio, `2` baixo |
| 44 | LEDs de jogador (bits 0–4) |
| 45–47 | Cor da barra de luz (R, G, B) |

## Outros feature reports lidos

| Report | Conteúdo |
|---|---|
| `0x20` | Data/hora do firmware (ASCII), versão do hardware (byte 24), versão do firmware (byte 28), versão de atualização (byte 44) |
| `0x09` | Endereço Bluetooth do controle (bytes 1–6, little-endian) |

## Formato JSON dos perfis

O app usa o mesmo formato do [edge-config.com](https://edge-config.com), então bibliotecas exportadas por um funcionam no outro:

```json
{
  "id": "7,18,151,214,171,148,1,74,136,186,170,50,240,237,147,218",
  "label": "Shooter",
  "leftJoystick":  { "profileId": 1, "modifier": 3, "curveValues": [38, 38, 122, 139, 255, 255] },
  "rightJoystick": { "profileId": 2, "modifier": 4, "curveValues": [76, 50, 140, 102, 200, 162] },
  "leftTrigger":  { "min": 0, "max": 255 },
  "rightTrigger": { "min": 0, "max": 255 },
  "buttonMapping": { "buttons": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 12, 4] },
  "profileButtonSelector": 96,
  "vibrationIntensity": 3,
  "triggerEffectIntensity": 3
}
```

`profileButtonSelector` é o seletor do slot em decimal (`96` = `0x60` □, `97` ✕, `98` ○, `99` △, `0` = nenhum).
