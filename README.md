# Spelling quiz

The computer says a word and a short example sentence. You spell the word by typing it.

Sample sentences are written once, at build time, and saved into the game. The published site does not call OpenAI and does not need an API key.

## Play

```bash
npm install
npm run dev
```

Open the local URL Vite prints. `npm run build` writes a static site to `dist/`.

## Publish to GitHub Pages

`npm run publish:pages` builds the quiz and copies it into the local `patrickread.github.io` repo at `spelling-quiz/`. It also adds a Spelling Quiz link on that site's home page if the link is missing. Commit and push that repo to publish. The Pages repo path defaults to `../patrickread.github.io`; set `PAGES_REPO` to use a different checkout.

Hearing the word uses the browser's speech synthesis, in place of macOS `say`. The answer is typed, so the spelling is what gets checked.

## Sentences

Each study word has three sentences in `src/data/sentences.json`. A round picks one at random, and a second try on the same word picks a different one.

`npm run dev` and `npm run build` fill in any missing sentences before the app starts. That step needs `OPENAI_API_KEY`. Once every word already has three sentences, later builds skip the API.

To rewrite them all:

```bash
OPENAI_API_KEY=... npm run generate -- --force
```

Word lists live in `data/words.txt` and `data/words-addie-d1.txt`. Add a word there and the next build writes sentences for it.

## Round rules

A round is 10 words. Two misses in a row switch to a different word, and the missed word stays in the pile. Gibberish, including spaces and punctuation, does not count as a miss. `?` repeats the word. After a correct spelling, the quiz waits until Enter or Next word.
