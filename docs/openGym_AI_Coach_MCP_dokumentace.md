# openGym + AI Coach přes MCP

**Technická dokumentace a návrh implementace**
**Stav ověřen k:** 24. 8. 2026
**Cílový projekt:** `filipvlcekk/openGym`
**Upstream:** `DuarteSantos/openGym` na Gitea; původní GitHub `DuarteSantos8/openGym` je aktuálně offline.

---

## 1. Účel dokumentu

Cílem je rozšířit openGym o AI agenta, který bude fungovat jako osobní tréninkový kouč.

Uživatel bude nadále používat samotnou aplikaci openGym při tréninku — pro spuštění workoutu, zapisování sérií, opakování, vah, času a RPE/RIR. Vedle toho bude používat AI agenta pro:

- plánování tréninků,
- analýzu historie,
- doporučení pro progresi,
- úpravy týdenního plánu,
- vyhodnocení stagnace,
- návrh deloadu,
- práci s muscle balance,
- práci s tělesnou hmotností,
- přesouvání workoutů,
- dlouhodobé koučování.

AI agent nebude nahrazovat openGym. Bude tvořit inteligentní vrstvu nad stejnými daty.

Výsledný koncept:

```text
┌───────────────────────┐
│        Uživatel       │
└──────────┬────────────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
┌─────────┐  ┌─────────────┐
│ openGym │  │  AI Coach   │
│   UI    │  │ LLM / agent │
└────┬────┘  └──────┬──────┘
     │               │
     │          MCP / API
     │               │
     └───────┬───────┘
             ▼
      ┌──────────────┐
      │ openGym data │
      └──────────────┘
```

---

# 2. Současný stav openGym

## 2.1 openGym

openGym je self-hosted gym a body-weight tracker.

Aktuální architektura self-hosted varianty je přibližně:

```text
Telefon / notebook
       │
       │ HTTPS
       ▼
┌─────────────────────┐
│ nginx / web         │
│ React aplikace      │
│ proxy /api → API    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Node API            │
│ WebAuthn / passkeys │
└──────────┬──────────┘
           │
           ▼
       ./data/
```

openGym nepoužívá klasický databázový server. Stav aplikace je ukládán jako JSON.

Důležité soubory:

```text
data/
├── db.json
├── state-<uid>.json
├── secret
└── vapid.json
```

Z pohledu AI integrace je nejdůležitější:

```text
state-<uid>.json
```

Obsahuje uživatelský stav, například:

- routines,
- weekly plan,
- workout history,
- body-weight log,
- settings,
- další data související s tréninkem.

> Přesný JSON kontrakt je nutné při implementaci odvozovat z aktuálního kódu openGym, nikoliv ručně duplikovat. Formát se může mezi verzemi měnit.

---

# 3. Stav MCP v upstream openGym

Upstream repository `DuarteSantos/openGym` na Gitea již obsahuje MCP server:

```text
mcp/
```

MCP server je v současné verzi:

- read-only,
- lokální,
- používá stdio transport,
- není součástí Docker Compose,
- neotevírá síťový port,
- čte přímo `./data`,
- používá stejnou training logiku jako frontend.

AI aplikace MCP server spustí jako child process.

Aktuální tok:

```text
AI klient
   │
   │ MCP / stdio
   ▼
openGym MCP server
   │
   │ read
   ▼
state-<uid>.json
```

## 3.1 Aktuálně dostupné MCP tools

Upstream MCP server poskytuje osm read-only nástrojů:

| Tool | Účel |
|---|---|
| `list_routines` | seznam uložených rutin |
| `get_routine` | detail konkrétní rutiny |
| `get_week_plan` | plán aktuálního týdne včetně override |
| `list_workouts` | poslední workouty |
| `get_workout` | detail workoutu včetně jednotlivých sérií |
| `get_bodyweight` | historie tělesné hmotnosti |
| `estimate_1rm` | odhad 1RM a trend |
| `muscle_balance` | rozložení tréninkové zátěže mezi svaly |

Tento fork k tomu ve Phase 1.5 přidává:

| Tool | Účel |
|---|---|
| `progression_next` | další předepsaný target podle openGym progression engine |
| `exercise_history` | poslední dokončené sessions pro jeden cvik bez tahání celých workoutů |
| `training_summary` | kompaktní periodické shrnutí workoutů, váhy, effortu a muscle coverage |
| `detect_stalls` | konzervativní kandidáti stagnace s důkazy, ne finální verdikt |

Upstream MCP používá stejné pure helper funkce jako frontend, mimo jiné logiku pro:

- workout history,
- 1RM,
- muscle balance,
- effective routine,
- training load.

To je velmi důležitý architektonický princip:

> AI vrstva nemá implementovat vlastní kopii fitness výpočtů, pokud lze použít stejnou logiku jako openGym.

Tím se zabrání situaci, kdy Stats obrazovka říká jinou hodnotu než AI agent.

---

# 4. Stav forku `filipvlcekk/openGym`

V aktuálně dostupném stromu forku není složka:

```text
mcp/
```

Upstream ji již obsahuje.

První doporučený krok je proto synchronizovat fork s upstreamem nebo MCP změny přenést selektivně.

Příklad:

```bash
git remote add upstream https://gitea.com/DuarteSantos/openGym.git
git fetch upstream
git checkout main
git merge upstream/main
```

Pokud fork obsahuje vlastní změny, může být vhodnější:

```bash
git fetch upstream
git rebase upstream/main
```

nebo cherry-pick konkrétních commitů.

Před merge je vhodné vytvořit pracovní branch:

```bash
git checkout -b feature/ai-coach-mcp
```

---

# 5. Cílová architektura

Doporučená cílová architektura:

```text
                         ┌─────────────────────┐
                         │      Uživatel       │
                         └─────────┬───────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
           ┌────────────────┐           ┌────────────────┐
           │ openGym UI     │           │ AI Coach       │
           │ React / PWA    │           │ LLM Agent      │
           └───────┬────────┘           └───────┬────────┘
                   │                            │
                   │ HTTP                       │ MCP
                   ▼                            ▼
           ┌────────────────┐           ┌────────────────┐
           │ openGym API    │◀──────────│ MCP Server     │
           └───────┬────────┘           └───────┬────────┘
                   │                            │
                   └────────────┬───────────────┘
                                ▼
                         ┌───────────────┐
                         │ openGym data  │
                         └───────────────┘
```

Doporučené rozdělení:

### Read operace

MCP může používat existující read vrstvu.

```text
MCP → state JSON + frontend/lib
```

### Write operace

Write nástroje by neměly nekontrolovaně editovat JSON soubor přímo.

Preferovaný tok:

```text
AI
 ↓
MCP tool
 ↓
ověření oprávnění
 ↓
openGym write service / API
 ↓
atomic update
 ↓
state-<uid>.json
```

Tento model centralizuje:

- validaci,
- autorizaci,
- concurrency,
- versioning,
- audit,
- business logiku.

---

# 6. Role jednotlivých komponent

## 6.1 openGym UI

openGym zůstává hlavním rozhraním pro samotný workout.

Uživatel zde:

- vidí dnešní trénink,
- spouští workout,
- zapisuje série,
- zadává váhy,
- zadává opakování,
- zadává RPE/RIR,
- používá timer,
- dokončuje session,
- případně ručně upravuje program.

AI coach nemá nutit uživatele během každé série komunikovat chatem.

Při workoutu je specializované UI rychlejší a vhodnější.

---

## 6.2 AI Coach

Agent slouží jako rozhodovací vrstva.

Typické dotazy:

```text
Co mám dnes cvičit?
```

```text
Zhodnoť moje poslední čtyři Push tréninky.
```

```text
Proč mi stagnuje bench?
```

```text
Mám příště přidat váhu?
```

```text
Příští týden můžu cvičit jen pondělí, středu a sobotu.
Uprav plán.
```

```text
Jdu cvičit.
```

```text
Hotovo. Vyhodnoť dnešní trénink.
```

Agent získá potřebná data přes MCP.

---

## 6.3 MCP server

MCP je integrační vrstva mezi LLM a openGym.

Jeho úloha není být samotným koučem.

MCP má poskytovat:

- spolehlivé strukturované nástroje,
- omezená oprávnění,
- validované vstupy,
- deterministické operace,
- jasné chyby,
- minimální data potřebná pro rozhodnutí.

Agent se rozhoduje.

MCP vykonává.

---

# 7. Princip sdíleného stavu

openGym UI a AI agent musí vždy pracovat se stejným aktuálním stavem.

Příklad:

1. Uživatel v openGym odcvičí Bench Press.
2. openGym uloží workout.
3. Agent později zavolá `get_workout`.
4. MCP načte nový stav.
5. Agent nový workout vidí.

A opačně:

1. Uživatel požádá agenta o změnu středečního tréninku.
2. Agent navrhne změnu.
3. Uživatel potvrdí.
4. MCP provede `override_day`.
5. Uživatel otevře openGym.
6. openGym zobrazí nový středeční plán.

Nesmí vzniknout oddělená „AI databáze plánu“, která by se časem rozešla s openGym.

openGym musí zůstat source of truth.

---

# 8. Read-only MVP

První verze AI coach systému může fungovat zcela bez zápisu.

## Funkce MVP

Agent může:

- číst aktuální plán,
- číst rutiny,
- číst historii,
- analyzovat poslední tréninky,
- vypočítat / načíst 1RM,
- analyzovat muscle balance,
- analyzovat body-weight trend,
- doporučit další workout,
- doporučit změnu váhy,
- doporučit deload,
- doporučit změnu objemu.

Nemůže však doporučení uložit do openGym.

Příklad:

```text
Uživatel:
Co mám příště dát na bench?

Agent:
Poslední tři relevantní workouty:

80 kg × 8 / 8 / 7
80 kg × 8 / 8 / 8
82,5 kg × 7 / 7 / 6

Doporučuji zatím ponechat 82,5 kg a cílit na dokončení
cílového rep range před dalším zvýšením.
```

Takové MVP už poskytuje značnou hodnotu.

---

# 9. Doporučená Phase 1.5 – coaching read tools

Tento fork nyní přidává nástroje:

```text
progression_next
exercise_history
training_summary
detect_stalls
```

`progression_next` odpovídá na otázku:

> Co podle nastavené progression policy předepisuje openGym jako další krok?

To je důležitější než nechat AI samostatně odhadovat pravidlo z historie.

`exercise_history` odpovídá na otázku:

> Jak vypadaly poslední dokončené sessions pro konkrétní cvik?

To snižuje množství surových dat v kontextu, protože agent nemusí tahat celé workouty a filtrovat je sám.

`training_summary` odpovídá na otázku:

> Jak vypadá poslední týden, měsíc, 6 týdnů, 12 týdnů nebo celá historie v kompaktním souhrnu?

To dává agentovi bezpečný základ pro review bez toho, aby si sám skládal statistiky z kompletní historie.

`detect_stalls` odpovídá na otázku:

> Které reps-mode cviky vypadají podle posledních sessions jako možní kandidáti stagnace?

Vrací důkazy, ne diagnózu ani automatické doporučení změny.

Skutečný výstup `progression_next` v tomto forku:

```json
{
  "unit": "kg",
  "routine": { "id": "upper-a", "name": "Upper A" },
  "exercise": { "id": "bench_press", "name": "Bench Press", "mode": "reps" },
  "current_target": { "sets": 4, "reps": 8, "weight": 80 },
  "policy": "linear",
  "policy_name": "Linear progression",
  "kind": "up",
  "next": { "weight": 82.5, "reps": null, "sec": null, "sets": null },
  "reason": "Every rep last time — 2.5 kg more.",
  "confidence": "deterministic"
}
```

Skutečný výstup `exercise_history` v tomto forku:

```json
{
  "unit": "kg",
  "exercise": { "id": "bench_press", "name": "Bench Press", "mode": "reps" },
  "total_count": 12,
  "returned_count": 10,
  "sessions": [
    {
      "date": "2026-07-24",
      "workout_id": "workout-id",
      "routine_name": "Upper A",
      "target": { "sets": 4, "reps": 8, "weight": 80 },
      "sets": [{ "done": true, "label": "80×8", "w": 80, "r": 8 }],
      "sets_done": 4,
      "volume": 2560
    }
  ]
}
```

Agent potom může rozdíl mezi:

- tím, co předepisuje openGym algoritmus,
- a tím, co navrhuje koučovací heuristika,

uživateli explicitně vysvětlit.

---

# 10. Write-enabled AI Coach

Pro plnohodnotného kouče je potřeba write vrstva.

Upstream roadmapa uvádí plánované operace:

```text
log_workout
add_bodyweight
edit_routine
assign_weekday
override_day
```

Pro AI coach použití jsou nejdůležitější:

```text
edit_routine
assign_weekday
override_day
log_workout
```

---

# 11. Doporučený write tool design

## 11.1 `override_day`

Slouží pro jednorázovou změnu konkrétního dne.

Příklad:

```json
{
  "date": "2026-08-26",
  "routine_id": "upper-a",
  "reason": "user unavailable Thursday"
}
```

Použití:

```text
Přesuň mi středeční Lower na čtvrtek.
```

Agent by neměl měnit permanentní weekly template, pokud jde pouze o jeden týden.

---

## 11.2 `assign_weekday`

Slouží pro změnu standardního týdenního plánu.

Příklad:

```json
{
  "weekday": "monday",
  "routine_id": "push"
}
```

Použití:

```text
Odteď chci Push trénovat každé pondělí.
```

---

## 11.3 `edit_routine`

Slouží pro strukturální úpravu programu.

Operace by měla být co nejvíce explicitní.

Aktuální implementace v tomto forku je patch-based: `edit_routine` umí `set_policy`, `set_exercise_target`, `add_exercise`, `remove_exercise`, `reorder_exercise`, `link_superset` a `unlink_superset`. Nový custom cvik se vytváří samostatným `create_custom_exercise`; `edit_routine` ho potom umí přidat do rutiny podle id.

Nevhodné:

```json
{
  "routine": "Push",
  "data": "..."
}
```

Lepší:

```json
{
  "routine_id": "push",
  "ops": [
    { "op": "set_exercise_target", "exercise_id": "bench_press", "sets": 4, "repsMin": 6, "repsMax": 8 },
    { "op": "add_exercise", "exercise_id": "0739", "position": 2, "target": { "sets": 4, "mode": "reps", "reps": 8, "weight": 120 } },
    { "op": "remove_exercise", "exercise_id": "plank" },
    { "op": "reorder_exercise", "exercise_id": "1323", "position": 1 },
    { "op": "link_superset", "exercise_id": "0739" },
    { "op": "unlink_superset", "exercise_id": "1323" }
  ],
  "expected_revision": 184,
  "dry_run": true
}
```

Tyto operace zůstávají jemnozrnné, jen jsou sdružené pod jeden rutinní patch tool:

```text
set_policy
set_exercise_target
add_exercise
remove_exercise
reorder_exercise
link_superset
unlink_superset
```

Výhodou je menší prostor pro chybný nebo destruktivní zápis oproti nahrazení celé rutiny jedním velkým JSONem.

Současný MCP kontrakt používá název `policy`, ale openGym frontend ukládá rutinní progression do pole `prog`. MCP vrstva proto tuto hranici normalizuje: navenek ukazuje `policy`, do state zapisuje kompatibilní `prog`.

`add_exercise` používá existující cviky z katalogu nebo `customEx`. LLM tedy může z věty uživatele najít vhodné `exercise_id`; pokud chce uživatel úplně nový custom cvik, nejdřív ho vytvoří přes `create_custom_exercise`.

`link_superset` propojí vybraný cvik s předchozím cvikem v rutině. MCP generuje `sg` id na serverové straně a nepřijímá libovolné id od klienta. `unlink_superset`, `remove_exercise` a `reorder_exercise` po změně volají stejný `cleanupSg` helper jako frontend, aby v rutině nezůstaly osiřelé superset id.

---

## 11.4 `create_custom_exercise`

Slouží pro vytvoření jednoho vlastního cviku v profilu. Tool nemění rutiny; přidání nového cviku
do rutiny zůstává samostatný krok přes `edit_routine.add_exercise`.

Příklad:

```json
{
  "name": "Ring support hold",
  "body_part": "waist",
  "description": "Hold top position on rings.",
  "expected_revision": 184,
  "dry_run": true
}
```

První verze umí:

- použít scope `exercise:write`,
- oříznout název a popis,
- odmítnout prázdný název,
- odmítnout neznámou body part,
- odmítnout duplicitní název proti katalogu i `customEx`,
- vygenerovat id serverově,
- uložit tvar kompatibilní s frontendem: `{ id, n, bp, desc, tg: '', eq: 'custom', custom: true }`,
- použít `dry_run`, `expected_revision`, per-user lock a audit commit.

Neumí zatím editovat nebo mazat existující custom cviky.

---

## 11.5 `log_workout`

V tomto forku je `log_workout` implementovaný jako strukturovaný zápis hotového workoutu podle existující rutiny.

LLM funguje jako parser z přirozeného jazyka do JSON. MCP samotné přirozený jazyk neparsuje, nehledá freestyle cviky a nevytváří nové cviky. Dostane už validovaný návrh nad existující rutinou a zapíše ho přes state-service.

Použití:

```text
Zapiš deadlift 140 × 5, 140 × 5, 140 × 4.
```

Příklad MCP payloadu:

```json
{
  "routine_id": "push",
  "date": "2026-08-30",
  "duration_min": 62,
  "bodyweight": 78.4,
  "entries": [
    {
      "exercise_id": "0426",
      "sets": [
        { "w": 25, "r": 10 },
        { "w": 25, "r": 8 }
      ]
    }
  ],
  "expected_revision": 184,
  "dry_run": true
}
```

První verze umí:

- zapsat hotový workout pro existující `routine_id`,
- povolit jen cviky, které jsou v dané rutině,
- validovat reps/time/cardio tvar setů,
- uložit sety jako `done: true`,
- zkopírovat target z rutiny do workout historie,
- spočítat `vol`, `prs` a aktualizovat `exWeights`,
- použít `workout:write`, `dry_run`, `expected_revision` a audit commit.

Neumí zatím freestyle workout, fuzzy matching názvů cviků, přidání nového cviku ani editaci už existujícího workoutu.

---

## 11.6 `add_bodyweight`

Jednoduchý write tool. V tomto forku je implementovaný jako `add_bodyweight` se scope `bodyweight:write`, dry-run režimem, `expected_revision` kontrolou a audit commitem:

```json
{
  "date": "2026-08-24",
  "weight": 82.4,
  "expected_revision": 184,
  "dry_run": true
}
```

Musí být definováno:

- duplicitní datum se nenásobí, ale nahrazuje,
- hodnota se ukládá ve stávající jednotce profilu,
- váha musí být kladná a ukládá se na jedno desetinné místo,
- `bodyweight` zůstává seřazený podle data.

---

# 12. Potvrzování write operací

AI by neměla měnit tréninkový plán bez vědomí uživatele.

Doporučený policy model:

## Read operace

Automaticky povoleny.

```text
list_routines
get_routine
get_week_plan
list_workouts
get_workout
exercise_history
get_bodyweight
estimate_1rm
muscle_balance
progression_next
training_summary
detect_stalls
```

## Write operace s potvrzením

```text
edit_routine
assign_weekday
override_day
log_workout
add_bodyweight
```

Příklad:

```text
AI:
Navrhuji změnit středu z Push na Rest a přesunout Push na čtvrtek.

Důvod:
- úterní Lower byl velmi náročný,
- čtvrtek dává větší odstup,
- celková týdenní frekvence se nezmění.

Mám změnu uložit?
```

Až po:

```text
Ano.
```

se provede tool call.

---

# 13. Dry-run režim

Každý významnější write tool by měl ideálně podporovat:

```json
{
  "dry_run": true
}
```

Výstup:

```json
{
  "would_change": true,
  "changes": [
    {
      "path": "weekOverrides.2026-08-26",
      "before": "rest",
      "after": "push"
    }
  ]
}
```

Potom se změna zopakuje s:

```json
{
  "dry_run": false
}
```

To výrazně snižuje riziko chyb.

---

# 14. Optimistic concurrency

Největší technické riziko write MCP je souběžný zápis.

Scénář:

```text
T0 openGym načte state
T1 MCP načte stejný state
T2 openGym uloží workout
T3 MCP uloží starší state + změnu
```

Pokud MCP zapisuje celý JSON, může omylem odstranit workout z T2.

Proto nestačí:

```javascript
const state = JSON.parse(readFileSync(file))
state.foo = bar
writeFileSync(file, JSON.stringify(state))
```

## Doporučené řešení

Použít:

- write lock,
- version number,
- revision hash,
- atomic write.

Například stav může mít:

```json
{
  "_revision": 184,
  "...": "..."
}
```

Write request:

```json
{
  "expected_revision": 184,
  "changes": {}
}
```

Pokud aktuální revision je 185:

```json
{
  "error": "state_conflict",
  "current_revision": 185
}
```

Agent musí načíst nový stav a rozhodnutí přepočítat.

---

# 15. Atomic write

JSON soubor by se neměl přepisovat přímo.

Bezpečnější model:

```text
1. vytvoř nový JSON v temp souboru
2. fsync
3. rename temp → state-uid.json
```

Rename na stejném filesystemu je typicky atomická operace.

Příklad konceptu:

```text
state-user.json.tmp
        │
        ▼
validation
        │
        ▼
atomic rename
        │
        ▼
state-user.json
```

---

# 16. Write API vs přímá editace JSON

Pro Phase 1 read-only je přímé čtení JSON velmi rozumné.

Pro write operace doporučuji samostatnou aplikační vrstvu.

Například:

```text
api/
├── server.js
└── state-service.js

mcp/
├── src/
│   ├── index.js
│   ├── tools/
│   └── client/
```

Společná funkce:

```text
updateUserState(uid, mutation)
```

by měla být používána:

- openGym API,
- MCP write vrstvou.

Tím vznikne jedno místo pro:

- locking,
- validaci,
- atomic writes,
- revision,
- audit.

---

# 17. Autentizace

Read-only MCP tools používají filesystem jako security boundary.

To je přijatelné, protože proces jen čte data dostupná uživateli, který jej spustil.

Write tools používají dlouhodobé tokeny se scope.

Doporučený model:

```text
openGym Admin / Settings
        │
        ▼
Create MCP token
        │
        ▼
token uložen bezpečně
        │
        ▼
AI MCP client
```

Token by měl mít scope.

Například:

```json
{
  "name": "personal-ai-coach",
  "user_id": "abc123",
  "scopes": [
    "workouts:read",
    "routines:read",
    "plans:read",
    "plans:write"
  ]
}
```

Nedávat automaticky:

```text
admin:*
users:*
auth:*
```

---

# 18. Token scopes

Doporučené scopes:

```text
profile:read
routines:read
routines:write
plans:read
plans:write
workouts:read
workouts:write
bodyweight:read
bodyweight:write
stats:read
```

Pro běžný AI coach:

```text
profile:read
routines:read
routines:write
plans:read
plans:write
workouts:read
bodyweight:read
stats:read
```

`workouts:write` lze v první verzi vynechat.

---

# 19. Audit log

Každá AI write operace by měla být dohledatelná.

Například:

```json
{
  "timestamp": "2026-08-24T18:15:03Z",
  "actor": "mcp-token:personal-ai-coach",
  "user_id": "abc123",
  "tool": "override_day",
  "reason": "user requested schedule change",
  "changes": {
    "date": "2026-08-26",
    "before": "lower",
    "after": "rest"
  }
}
```

Audit log může být:

```text
data/audit.jsonl
```

JSON Lines je pro append-only log vhodnější než jedno velké JSON pole.

---

# 20. Undo

Velmi užitečná vlastnost:

```text
undo_last_ai_change
```

Nemusí být přímo MCP tool v první verzi.

Stačí uchovávat předchozí hodnotu v audit logu.

Příklad UX:

```text
AI:
Hotovo. Středeční workout jsem přesunul na čtvrtek.

Uživatel:
Vrať to.

AI:
→ undo
```

---

# 21. Agent workflow před tréninkem

Uživatel:

```text
Jdu cvičit.
```

Agent provede:

```text
1. get_week_plan
2. zjisti dnešní routine
3. get_routine
4. exercise_history pro hlavní cviky
5. podle potřeby get_workout pro detail konkrétní session
6. progression_next pro hlavní cviky
7. případně bodyweight / muscle balance
8. sestav briefing
```

Výstup může být:

```text
Dnes máš Upper A.

Bench Press
- plán: 4 × 6–8
- minule: 82,5 kg × 8 / 8 / 7 / 6
- doporučení: ponechat 82,5 kg

Chest-supported row
- minule dokončen celý target
- progression rule doporučuje +2,5 kg

OHP
- dvě poslední session mají vysoké RPE
- dnes bych nezvyšoval váhu
```

---

# 22. Agent workflow po tréninku

Uživatel:

```text
Hotovo.
```

Agent:

```text
1. list_workouts
2. najde právě dokončený workout
3. get_workout
4. exercise_history pro cviky, kde je potřeba trend
5. porovná target vs completed
6. progression_next
7. zhodnotí trend
8. navrhne změny
```

Výstup:

```text
Bench:
splnil jsi celý target při nižším RPE než minule.
OpenGym progression policy doporučuje příště +2,5 kg.

OHP:
výkon se tři tréninky téměř neposunul a effort roste.
Zatím bych váhu nezvyšoval.

Celkově:
objem Upper workoutu zůstal stabilní a nebyl zaznamenán žádný failed set.
```

---

# 23. Dlouhodobý coaching workflow

Jednou týdně může agent analyzovat:

- počet dokončených workoutů,
- missed workouts,
- změny 1RM,
- objem,
- muscle balance,
- tělesnou hmotnost,
- stalled exercises,
- počet deloadů,
- frekvenci svalových skupin.

Příklad:

```text
Za posledních 6 týdnů:

Bench 1RM trend: +4,8 %
Squat 1RM trend: +6,1 %
OHP trend: +0,5 %

OHP stagnuje 4 týdny.
Doporučuji místo dalšího navyšování váhy změnit
rep range nebo snížit fatigue v předchozím cviku.
```

---

# 24. Data, která agent nesmí vymýšlet

Agent musí striktně oddělovat:

### Data z openGym

Například:

```text
82,5 kg × 8
RPE 9
2026-08-21
```

### Odvozená data

Například:

```text
odhad 1RM
trend
weekly volume
muscle balance
```

### Doporučení AI

Například:

```text
doporučuji nezvyšovat váhu
```

Agent nesmí prezentovat odhad jako uložený fakt.

---

# 25. Doporučený system prompt pro AI Coach

Následující text je výchozí návrh.

```text
You are an AI strength and fitness coach connected to openGym.

openGym is the source of truth for the user's workout plan,
training history, body weight, progression settings and logged sets.

Before making a training recommendation, use the available openGym
tools to obtain relevant current data.

Never invent:
- completed sets,
- weights,
- repetitions,
- RPE/RIR,
- body weight,
- workout dates,
- progression settings,
- planned workouts.

Clearly distinguish:
1. facts read from openGym,
2. values calculated by openGym,
3. your coaching recommendation.

When evaluating exercise progression:
- inspect recent relevant workouts,
- respect the configured openGym progression policy,
- consider failed reps and effort data when available,
- do not override the configured policy silently.

For routine or schedule modifications:
- explain the proposed change first,
- explain why,
- request user confirmation,
- only after confirmation use write tools.

Do not perform destructive or broad changes when a narrower change
is sufficient.

Prefer a one-day override for one-off schedule changes.
Use permanent weekday/routine edits only when the user explicitly
wants a persistent change.

After every write operation:
- verify the resulting plan/state,
- tell the user exactly what changed.

When data is insufficient, say so rather than guessing.
```

---

# 26. Fitness safety policy agenta

Agent by neměl být koncipován jako zdravotnický systém.

Vhodné hranice:

- neprovádět diagnózu zranění,
- neinterpretovat bolest jako bezpečnou,
- nenahrazovat lékaře,
- nepřikazovat pokračovat přes ostrou nebo neobvyklou bolest,
- nedoporučovat extrémní skoky v load,
- respektovat limity progression engine.

Agent může říct:

```text
V datech vidím propad výkonu, ale z workout logu nelze určit,
zda jde o únavu, techniku nebo zdravotní problém.
```

To je lepší než:

```text
Určitě máš přetížené rameno.
```

---

# 27. Context strategy

Není vhodné posílat LLM kompletní historii všech workoutů při každém dotazu.

MCP tools mají vracet relevantní výřezy.

Například:

```text
list_workouts(limit=10)
```

pro výběr konkrétní session, a potom:

```text
get_workout(workout_id)
```

Pro trend jednoho cviku má agent použít jemnější řez:

```text
exercise_history(exercise_id, limit=10)
```

Agent si vyžádá detail jen tam, kde ho potřebuje.

Výhody:

- menší token usage,
- rychlejší odpovědi,
- méně šumu,
- menší riziko špatné interpretace.

---

# 28. Navržené AI-specific read tools

Vedle upstream tools mohou být časem užitečné vyšší analytické nástroje.

## `exercise_history`

```json
{
  "exercise_id": "bench_press",
  "limit": 10
}
```

Hotovo v tomto forku. Vrací pouze relevantní dokončené sessions pro jeden cvik, newest-first, včetně targetu, labels setů, počtu dokončených setů a per-entry volume.

---

## `progression_next`

Hotovo v tomto forku. Vrátí další prescribed target podle openGym engine.

---

## `training_summary`

Například:

```json
{
  "period": "6w"
}
```

Výstup:

- workouts completed,
- volume,
- PR count,
- bodyweight change,
- effort summary,
- muscle coverage.

Hotovo v tomto forku.

---

## `detect_stalls`

Deterministická heuristika:

```json
{
  "window": 4
}
```

Vrátí kandidáty na stagnaci.

AI pak interpretuje.

Hotovo v tomto forku.

---

# 29. Proč část analýzy dělat mimo LLM

LLM by nemělo počítat vše ze surových sérií.

Lepší:

```text
raw data
   │
   ▼
deterministická JS funkce
   │
   ▼
structured result
   │
   ▼
LLM interpretace
```

Například:

```text
1RM calculation → JavaScript
trend calculation → JavaScript
weekly volume → JavaScript
date filtering → JavaScript
progression policy → JavaScript
```

LLM:

```text
vysvětlení
prioritizace
koučovací kontext
konverzace
```

---

# 30. Nasazení – lokální openGym

Pokud openGym a AI klient běží na stejném stroji:

```bash
cd openGym/mcp
npm install
```

Spuštění:

```bash
OPENGYM_DATA=/absolute/path/openGym/data \
OPENGYM_UID=<uid> \
node src/index.js
```

V single-user instalaci lze UID podle upstream dokumentace autodetekovat.

Příklad MCP konfigurace:

```json
{
  "mcpServers": {
    "opengym": {
      "command": "node",
      "args": [
        "/absolute/path/openGym/mcp/src/index.js"
      ],
      "env": {
        "OPENGYM_DATA": "/absolute/path/openGym/data",
        "OPENGYM_UID": "<uid>"
      }
    }
  }
}
```

---

# 31. Nasazení – openGym na VPS

Read-only MCP tools pracují s filesystem path.

Pokud openGym běží na VPS a AI client na notebooku, lokální MCP nemá automaticky přístup k:

```text
VPS:/opt/opengym/data
```

Jsou tři hlavní varianty.

---

## Varianta A – MCP běží přes SSH

```text
AI client
   │
   │ stdio
   ▼
ssh
   │
   ▼
VPS
   │
   ▼
node mcp/src/index.js
   │
   ▼
/opt/opengym/data
```

Příklad:

```json
{
  "mcpServers": {
    "opengym": {
      "command": "ssh",
      "args": [
        "-T",
        "user@gym.example.com",
        "OPENGYM_DATA=/opt/opengym/data node /opt/opengym/mcp/src/index.js"
      ]
    }
  }
}
```

Pozor:

- SSH login nesmí zapisovat banner na stdout,
- stdout používá MCP protocol,
- Node musí být dostupný na VPS,
- SSH user musí mít read oprávnění k datům.

---

## Varianta B – synchronizovaná lokální kopie

Například:

```bash
rsync -a --delete \
  user@gym.example.com:/opt/opengym/data/ \
  ~/opengym-data/
```

MCP:

```text
OPENGYM_DATA=~/opengym-data
```

Výhoda:

- jednoduché,
- minimální riziko pro read-only.

Nevýhoda:

- data nemusí být aktuální.

Pro write AI není tato varianta vhodná.

---

## Varianta C – budoucí HTTP MCP

Upstream roadmapa počítá s:

```text
Streamable HTTP transport
```

To je dlouhodobě nejlepší varianta pro vzdáleného agenta.

```text
AI agent
    │
    │ HTTPS + token
    ▼
MCP HTTP endpoint
    │
    ▼
openGym services
```

Musí však obsahovat:

- TLS,
- token auth,
- scopes,
- rate limit,
- audit,
- write locking.

---

# 32. Doporučený deployment pro osobní použití

Pro jednoho uživatele:

```text
VPS / home server
│
├── openGym web
├── openGym API
├── openGym data
└── MCP
```

AI agent může MCP používat:

- přes SSH,
- později přes HTTPS MCP.

Není důvod zpřístupňovat filesystem veřejně.

---

# 33. Navrhovaná struktura MCP projektu

Příklad:

```text
mcp/
├── package.json
├── README.md
├── src/
│   ├── index.js
│   ├── config.js
│   ├── state-reader.js
│   ├── state-writer.js
│   ├── auth.js
│   ├── audit.js
│   ├── labels.js
│   │
│   ├── tools/
│   │   ├── routines.js
│   │   ├── workouts.js
│   │   ├── stats.js
│   │   ├── bodyweight.js
│   │   ├── progression.js
│   │   └── write/
│   │       ├── edit-routine.js
│   │       ├── assign-weekday.js
│   │       └── override-day.js
│   │
│   └── schemas/
│       ├── routine.js
│       ├── workout.js
│       └── mutations.js
│
└── tests/
```

---

# 34. Validace

Každý write tool musí validovat vstup.

Například `override_day`:

```text
date
- valid ISO date
- rozumný interval

routine_id
- musí existovat
- nebo explicitní rest/null hodnota

expected_revision
- pokud implementujeme optimistic concurrency
```

Chyba má být strukturovaná:

```json
{
  "ok": false,
  "error": {
    "code": "ROUTINE_NOT_FOUND",
    "message": "Routine 'upper-z' does not exist."
  }
}
```

Ne pouze:

```text
Something went wrong.
```

---

# 35. Idempotence

Write tools by měly být pokud možno idempotentní.

Pokud agent dvakrát zavolá:

```text
assign_weekday(monday, push)
```

výsledek má být stejný jako po jednom zavolání.

Response:

```json
{
  "changed": false,
  "reason": "already_assigned"
}
```

Tím se snižuje riziko dvojitého tool callu.

---

# 36. Zákaz broad replace

AI tool by pokud možno neměl přijímat celý `state` objekt.

Nevytvářet:

```text
replace_state(json)
```

Takový nástroj je příliš nebezpečný.

Místo toho:

```text
override_day
assign_weekday
update_exercise_target
add_bodyweight
```

Princip:

> nejmenší oprávnění + nejmenší možná změna.

---

# 37. Version compatibility

MCP by měl poznat nekompatibilní data.

Například:

```json
{
  "schema_version": 3
}
```

Pokud není možné přímo přidat schema version do openGym state, může MCP validovat očekávané klíče.

Při nekompatibilitě:

```text
Unsupported openGym state format.
Expected version X, detected Y.
```

Je lepší odmítnout write než poškodit data.

---

# 38. Backup před write feature

Než bude write MCP označeno jako stabilní:

- automatický backup state před změnou,
- nebo alespoň jednoduchý rotating backup.

Například:

```text
data/backups/
├── state-abc.20260824-181500.json
├── state-abc.20260824-183100.json
└── ...
```

Retence například:

```text
20 posledních MCP změn
```

---

# 39. Testování

## Unit tests

Testovat:

- parsování state,
- hledání routine,
- weekly overrides,
- progression,
- 1RM,
- muscle balance,
- mutation functions,
- validation,
- concurrency.

---

## MCP contract tests

Pro každý tool:

```text
valid request
invalid request
missing entity
empty history
multi-workout day
rest day
override day
```

---

## Write tests

Důležité scénáře:

```text
write při stejné revision → success
write při staré revision → conflict
write stejné hodnoty → no-op
invalid routine → reject
invalid date → reject
crash během zápisu → původní JSON zůstane validní
```

---

## Agent integration tests

Příklad testu:

```text
Given:
Monday = Push
Wednesday = Lower

User:
"Ve středu nemůžu, dej Lower na čtvrtek."

Expected agent behavior:
1. načte week plan
2. navrhne override
3. čeká na potvrzení
4. po potvrzení zavolá override_day
5. ověří week plan
6. oznámí změnu
```

---

# 40. Acceptance criteria pro MVP

Read-only MVP je hotové, pokud:

- MCP se připojí k AI klientovi,
- agent vidí správného uživatele,
- `get_week_plan` odpovídá UI,
- workout history odpovídá UI,
- e1RM odpovídá Stats,
- muscle balance odpovídá Stats,
- agent nevymýšlí neexistující data,
- agent dokáže udělat post-workout summary.

---

# 41. Acceptance criteria pro write AI Coach

Write verze je hotová, pokud:

- agent dokáže navrhnout změnu,
- bez potvrzení ji neprovede,
- změna se okamžitě projeví v openGym,
- ruční změna v openGym je viditelná agentovi,
- souběžný write neztratí data,
- každá změna je auditovatelná,
- neplatný vstup nemůže poškodit state,
- state lze obnovit,
- token lze revokovat.

---

# 42. Doporučená roadmapa projektu

## Phase 0 – Sync

- synchronizovat fork s upstream,
- přenést `mcp/`,
- spustit upstream MCP testy,
- ověřit kompatibilitu s vlastním forkem.

---

## Phase 1 – Read-only AI Coach

- připojit MCP k vybranému agentovi,
- vytvořit AI Coach system prompt,
- testovat analýzu workout historie,
- testovat plánování bez write.

Výsledek:

```text
AI radí, openGym ukládá.
```

---

## Phase 1.5 – Better coaching reads

Přidat:

```text
progression_next   hotovo
exercise_history   hotovo
training_summary   hotovo
detect_stalls      hotovo
```

Výsledek:

```text
méně surových dat do LLM
více deterministické logiky
```

---

## Phase 2 – Safe writes

Implementovat:

```text
override_day
assign_weekday
edit_routine
add_bodyweight
log_workout
```

Detailní architektonický návrh Phase 2 je v samostatném dokumentu:

```text
docs/MCP_WRITE_ARCHITECTURE.md
```

Základní rozhodnutí: nejdřív vytvořit sdílenou `updateUserState(uid, mutation, options)` vrstvu s per-user lockem, revision konflikty, atomickým zápisem a audit logem. Až nad ní stavět jednotlivé write tooly.

Stav k 2026-09-04:

- hotovo: `api/state-service.js`,
- hotovo: `_revision` + per-user lock v `updateUserState`,
- hotovo: `PUT /api/data` používá state service,
- hotovo: `api/token-service.js` pro hashované tokeny, scopes a revokaci,
- hotovo: token management HTTP routes pro vytvoření, výpis a revokaci tokenů,
- hotovo: MCP token auth wiring přes `OPENGYM_MCP_TOKEN`,
- hotovo: scrubovaný JSONL audit log pro úspěšné state writy,
- hotovo: první MCP write tool `override_day` s dry-run, `schedule:write`, revision checkem a audit commitem,
- hotovo: MCP write tool `assign_weekday` pro týdenní plán s dry-run, `schedule:write`, revision checkem a audit commitem,
- hotovo: `edit_routine` pro `set_policy`, `set_exercise_target`, `add_exercise`, `remove_exercise`, `reorder_exercise`, `link_superset` a `unlink_superset` s `routine:write`, dry-run, revision checkem a audit commitem,
- hotovo: `add_bodyweight` pro přidání nebo nahrazení jednoho váhového záznamu s `bodyweight:write`, dry-run, revision checkem a audit commitem,
- hotovo: `log_workout` pro zapsání hotového workoutu podle existující rutiny se `workout:write`, dry-run, revision checkem a audit commitem,
- hotovo: `create_custom_exercise` pro vytvoření jednoho vlastního cviku se `exercise:write`, dry-run, revision checkem a audit commitem,
- hotovo: sdílená strukturální validace state ve `state-service` před zápisem a auditem,
- zbývá: freestyle workout logging a hlubší sdílená validace workout setů.

Současně:

- token auth,
- scopes,
- lock,
- atomic write,
- audit,
- backup.

Výsledek:

```text
AI umí plán nejen navrhnout, ale i uložit.
```

---

## Phase 2.5 – Fine-grained routine editor

Hotovo v rámci `edit_routine`:

```text
link_superset
unlink_superset
```

---

## Phase 3 – Remote MCP

Implementovat:

```text
Streamable HTTP MCP
```

s:

- HTTPS,
- scoped token,
- revocation,
- rate limiting.

---

## Phase 4 – Proactive coach

Později lze postavit vrstvu, která umožní například:

```text
weekly review
stagnation alerts
deload suggestion
missed workout follow-up
weight trend review
```

Proaktivní funkce by neměly automaticky přepisovat plán bez schválení.

---

# 43. Doporučený první implementační milestone

Nejrozumnější první milestone:

```text
1. dostat upstream MCP do forku
2. rozchodit všech 8 upstream read tools
3. přidat progression_next
4. přidat exercise_history
5. přidat training_summary
6. přidat detect_stalls
7. vytvořit system prompt AI Coache
8. několik týdnů používat read-only verzi
9. zjistit, které write akce reálně chybí
```

Až potom implementovat write.

Tím se zabrání vytváření velkého API na základě hypotetických potřeb.

---

# 44. Praktický UX scénář

## Před tréninkem

```text
Uživatel:
Jdu cvičit.

AI:
Dnes máš Pull.

Minulý Pull:
- Pull-up: 10 / 9 / 8
- Row: 70 kg × 10 / 10 / 9
- Curl: dokončen celý target

Dnes:
- Pull-up: stejné nastavení, cíl přidat 1 opakování celkem
- Row: openGym progression doporučuje ponechat 70 kg
- Curl: může jít o další progression step
```

Uživatel potom otevře openGym a workout odjede v UI.

---

## Po tréninku

```text
Uživatel:
Hotovo.

AI:
Našel jsem dnešní workout.

Row:
70 kg × 10 / 10 / 10
→ celý target dokončen

Pull-up:
10 / 10 / 9
→ +2 reps proti minule

Celkově je to pozitivní session.
Příště bych Row posunul podle progression policy.
```

---

## Změna plánu

```text
Uživatel:
Ve středu nemůžu cvičit.

AI:
Ve středu máš Lower a ve čtvrtek rest.
Navrhuji jednorázově přesunout Lower na čtvrtek.
Týdenní template zůstane beze změny.

Mám to uložit?

Uživatel:
Ano.

AI:
→ override_day

Hotovo. Lower je tento týden ve čtvrtek.
```

---

# 45. Co bych nedoporučoval

## Samostatnou AI databázi

Nevytvářet:

```text
openGym plan
+
AI plan database
```

Dříve nebo později se rozjedou.

---

## Přímý unrestricted filesystem access

Nedávat agentovi shell s právem:

```bash
sed
rm
cat > state-user.json
```

MCP tool musí mít omezený kontrakt.

---

## Přepsání celého state při malé změně

Kvůli concurrency a riziku ztráty dat.

---

## Automatické změny bez potvrzení

Zejména:

- smazání cviku,
- změna celé routine,
- změna weekly schedule,
- log workout,
- mazání historie.

---

## Kopírování training algoritmů do promptu

Progression engine má zůstat v kódu.

Prompt není spolehlivá implementace business logiky.

---

# 46. Klíčové architektonické rozhodnutí

Doporučená hranice je:

```text
openGym
= source of truth
+ workout UI
+ deterministic training engine

MCP
= bezpečné nástroje nad openGym

AI
= interpretace
+ plánování
+ coaching
+ konverzace
```

To umožňuje AI vyměnit bez změny datového modelu.

Dnes může být agent Claude, jiný MCP klient nebo vlastní LLM orchestrace.

openGym zůstává stejné.

---

# 47. Shrnutí

Ano, openGym lze velmi přirozeně propojit s AI agentem přes MCP.

Upstream už poskytuje důležitou část infrastruktury: read-only MCP server s osmi nástroji a přímým použitím stejné training logiky jako frontend. Tento fork na tom staví, má dvanáct read-only toolů včetně `progression_next`, `exercise_history`, `training_summary` a `detect_stalls`, a šest scoped write toolů: `override_day`, `assign_weekday`, strukturovaný `edit_routine`, `create_custom_exercise`, `add_bodyweight` a `log_workout`.

Nejlepší cesta není vytvořit nový AI fitness tracker.

Nejlepší cesta je:

```text
openGym
    +
MCP
    +
AI Coach
```

Uživatel bude interagovat s oběma rozhraními:

```text
openGym
→ rychlé a přesné zapisování workoutu

AI Coach
→ plánování, analýza, rozhodování a změny programu
```

Obě rozhraní musí pracovat nad jedním společným stavem.

Pro read-only fázi je současný upstream MCP velmi dobrý základ.

Pro write fázi jsou hlavní technické požadavky:

- omezené write tools,
- explicitní potvrzení uživatele,
- autentizace,
- scopes,
- optimistic concurrency / locking,
- atomic writes,
- audit,
- backup,
- validace.

Doporučený první cíl projektu:

> **AI coach, který umí spolehlivě načíst openGym data, analyzovat poslední tréninky a doporučit další postup; následně bezpečně přidat možnost jednorázově či trvale upravit plán po potvrzení uživatelem.**

---

# 48. Referenční zdroje

## Upstream openGym

- Repository: https://gitea.com/DuarteSantos/openGym
- MCP README: https://gitea.com/DuarteSantos/openGym/src/branch/main/mcp/README.md
- Security policy: https://gitea.com/DuarteSantos/openGym/src/branch/main/SECURITY.md
- Contributing / architecture: https://gitea.com/DuarteSantos/openGym/src/branch/main/CONTRIBUTING.md
- Původní GitHub odkaz, pokud bude obnoven: https://github.com/DuarteSantos8/openGym

## Cílový fork

- https://github.com/filipvlcekk/openGym

---

# 49. Poznámka k implementaci

Tento dokument kombinuje dvě kategorie informací:

### Aktuálně existující upstream funkce

Patří sem zejména:

- read-only stdio MCP,
- dvanáct read tools v tomto forku,
- přímé čtení `./data`,
- reuse frontend training helpers,
- hotový `progression_next`,
- hotový `exercise_history`,
- hotový `training_summary`,
- hotový `detect_stalls`,
- roadmapa write tools,
- plán token auth,
- plán write-locku,
- plán Streamable HTTP transportu.

### Návrh této integrace

Patří sem zejména:

- AI Coach workflow,
- potvrzování změn,
- scopes,
- audit log,
- undo,
- dry-run,
- optimistic revision,
- granular write tools,
- system prompt,
- acceptance criteria.

Před implementací konkrétní mutation funkce je potřeba ověřit aktuální datový model a existující API/write logiku dané verze openGym.
