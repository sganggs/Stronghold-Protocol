# The i18n layer

This folder gives the page a second language. The source text of the game is Chinese. This layer shows the interface
in the locale that the player chooses. It does not change a file of the original project.

Status: one catalog, English. It has a translation for each of the 833 text fragments of the interface. The page is
in English on the first visit.

## 1. The parts

| File | Contents |
|---|---|
| `locales/en.json` | the English catalog |
| `translator.js` | the function that gets the translation of one string |
| `runtime.js` | the module that changes the text on the page |
| `extract.mjs` | the tool that finds the interface text and shows the coverage |
| `i18n.test.js` | the tests |

`aldus/build.mjs` copies the layer into `dist/i18n/` and adds one module to the entry page. That module starts before
the module of the game.

## 2. The catalog

The source string is the message id. A catalog has two lists:

- `messages`: one translation for each source string.
- `patterns`: one regular expression and one replacement for a string that has a value in it. For example, a round
  number.

The translator does these steps for one string:

1. It looks for the full string in `messages`.
2. It tries each pattern.
3. It cuts the string into known messages. If one part is not known, the translator changes nothing.

A string that has no translation stays in Chinese on the page.

## 3. The locale

The runtime chooses the locale in this order:

1. the parameter `lang` in the address (`?lang=zh` or `?lang=en`)
2. the choice that the browser kept
3. English

The title screen has a button that changes the locale.

## 4. What the layer does not translate

- **The game data.** The simulation reads the Chinese text of the data for its rules. Thus the files in `/data/` stay
  as they are, and the layer changes only the text on the page.
- **The descriptions.** The descriptions of the operators, the skills, the items, and the enemies stay in Chinese.
  The official English text for this season is not in the public data tables at this time.
- **The names of the enemies and the items.**
- **The pictures of the guide.**

The names of the operators are in English. They come from the game data (`appellation`), and the build adds them to
each catalog.

## 5. How to add text or a locale

Add a translation:

1. Run `node aldus/i18n/extract.mjs --missing`. It shows each source string that has no translation.
2. Add each string to `locales/en.json`.
3. Run `node --test aldus/i18n/i18n.test.js`.

Add a locale:

1. Copy `locales/en.json` to `locales/<locale>.json`.
2. Change `locale`, `name`, and each translation.
3. Build. The language switch then shows the new locale.

To find text that has no translation on a page that you see, type `spI18n.missing()` in the console of the browser.

## 6. The terms

The English terms of the mode come from the Arknights wiki: Solo Simulation, Team Simulation, Rest Phase, Unite Phase,
Dispatch Center, Funds, Alliances, Stacks, Elite, Arts, Hidden Core, LP. The translations of the interface text are
the work of this fork.
