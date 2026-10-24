import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GAME_LENGTH,
  classifyAttempt,
  createGame,
  doneLine,
  isGibberish,
  normalizeDictation,
  pickSentence,
  promptLine,
  resultLine,
  shuffle,
  splitSentence,
  startRound,
  submit,
} from "./game.ts";

const sentences = () => ["One.", "Two.", "Three."];

function zero() {
  return 0;
}

describe("answers", () => {
  it("treats a blank attempt and a question mark as not-yet answers", () => {
    assert.equal(classifyAttempt("   "), "empty");
    assert.equal(classifyAttempt("?"), "replay");
    assert.equal(classifyAttempt("see"), "answer");
  });

  it("flags the same gibberish the desktop game rejected", () => {
    assert.equal(isGibberish("hello there"), true);
    assert.equal(isGibberish("see."), true);
    assert.equal(isGibberish("a".repeat(21)), true);
    assert.equal(isGibberish("it's"), false);
    assert.equal(isGibberish("See"), false);
  });

  it("strips punctuation the microphone adds around a single word", () => {
    assert.equal(normalizeDictation("  See. "), "See");
    assert.equal(normalizeDictation("the!"), "the");
    assert.equal(normalizeDictation("I see."), "I see");
  });
});

describe("round", () => {
  it("does not mutate the word list when shuffling", () => {
    const words = ["one", "two", "three"];
    const snapshot = [...words];
    shuffle(words, zero);
    assert.deepEqual(words, snapshot);
  });

  it("avoids repeating the sentence from the previous try", () => {
    const picked = pickSentence(["Same.", "Other."], "Same.", zero);
    assert.equal(picked, "Other.");
  });

  it("hides the study word inside its sentence", () => {
    const parts = splitSentence("I see a red bird.", "See");
    assert.deepEqual(parts, [
      { text: "I " },
      { blank: true },
      { text: " a red bird." },
    ]);
    assert.equal(splitSentence("Nothing to hide.", "see"), null);
  });

  it("accepts any capitalization of the list spelling", () => {
    let game = startRound(
      createGame("Ada", "sight", "Sight words", ["See"], zero),
      sentences,
      zero,
    );
    const result = submit(game, "SEE", "Nice", "wrote", zero);
    assert.equal(result.feedback.type, "correct");
    if (result.feedback.type === "correct") assert.equal(result.feedback.word, "See");
    assert.equal(result.game.finished, true);
    assert.deepEqual(result.game.correct, ["See"]);
  });

  it("switches words after two misses and keeps the missed word in the queue", () => {
    let game = startRound(
      createGame("Ada", "sight", "Sight words", ["one", "two", "three"], zero),
      sentences,
      zero,
    );
    const first = game.round?.word;
    assert.ok(first);

    let result = submit(game, "nope", "Nice", "wrote", zero);
    assert.equal(result.feedback.type, "incorrect");
    if (result.feedback.type === "incorrect") assert.equal(result.feedback.switched, false);
    assert.equal(result.game.failures, 1);

    game = startRound(result.game, sentences, zero);
    result = submit(game, "wrong", "Nice", "wrote", zero);
    assert.equal(result.feedback.type, "incorrect");
    if (result.feedback.type === "incorrect") assert.equal(result.feedback.switched, true);
    assert.equal(result.game.failures, 0);
    assert.deepEqual([...result.game.queue].sort(), ["one", "three", "two"]);
    assert.equal(result.game.queue.includes(first), true);
  });

  it("stays on the last remaining word instead of switching", () => {
    let game = startRound(
      createGame("Ada", "sight", "Sight words", ["only"], zero),
      sentences,
      zero,
    );
    let result = submit(game, "nope", "Nice", "wrote", zero);
    game = startRound(result.game, sentences, zero);
    result = submit(game, "nope", "Nice", "wrote", zero);
    assert.equal(result.feedback.type, "incorrect");
    if (result.feedback.type === "incorrect") assert.equal(result.feedback.switched, false);
    assert.equal(result.game.failures, 2);
    assert.deepEqual(result.game.queue, ["only"]);
  });

  it("does not count gibberish as a miss", () => {
    const game = startRound(
      createGame("Ada", "sight", "Sight words", ["one", "two"], zero),
      sentences,
      zero,
    );
    const result = submit(game, "not a word", "Nice", "said", zero);
    assert.equal(result.feedback.type, "gibberish");
    assert.equal(result.game.failures, 0);
    assert.equal(result.game.round?.word, game.round?.word);
    assert.equal(result.game.correct.length, 0);
  });

  it("finishes the round after ten correct words", () => {
    let game = createGame(
      "Ada",
      "sight",
      "Sight words",
      Array.from({ length: 12 }, (_, index) => `word${index}`),
      zero,
    );

    for (let i = 0; i < GAME_LENGTH; i += 1) {
      game = startRound(game, sentences, zero);
      const word = game.round?.word;
      assert.ok(word);
      const result = submit(game, word, "Nice", "wrote", zero);
      game = result.game;
    }

    assert.equal(game.finished, true);
    assert.equal(game.correct.length, GAME_LENGTH);
    assert.equal(game.queue.length, 2);
  });

  it("finishes early when the list runs out", () => {
    let game = startRound(
      createGame("Ada", "addie-d1", "Addie's spelling list", ["one", "two"], zero),
      sentences,
      zero,
    );
    const first = submit(game, game.round?.word ?? "", "Nice", "wrote", zero);
    game = startRound(first.game, sentences, zero);
    const second = submit(game, game.round?.word ?? "", "Nice", "wrote", zero);
    assert.equal(second.game.finished, true);
    assert.equal(second.game.correct.length, 2);
  });
});

describe("spoken lines", () => {
  it("includes the sample sentence only when one exists", () => {
    assert.equal(promptLine("Ada", "See", "I see a bird."), "Ada, your word is See. As in, I see a bird.");
    assert.equal(promptLine("Ada", "See", null), "Ada, your word is See.");
  });

  it("praises a correct spelling without the player's name", () => {
    assert.equal(
      resultLine("Ada", { type: "correct", attempt: "cat", word: "cat", affirmation: "Hooray!" }, "wrote"),
      "You wrote cat. That is correct! Hooray!",
    );
    assert.equal(
      resultLine("Ada", { type: "incorrect", attempt: "dog", switched: false }, "said"),
      "Ada, you said dog. That is not correct.",
    );
    assert.equal(
      resultLine("Ada", { type: "incorrect", attempt: "dog", switched: true }, "wrote"),
      "Ada, you wrote dog. That is not correct. Let's try a different word.",
    );
    assert.equal(
      resultLine("Ada", { type: "gibberish", attempt: "???", via: "wrote" }, "wrote"),
      "Ada, it seems like you just typed gibberish. Let's try again.",
    );
    assert.equal(
      resultLine("Ada", { type: "gibberish", attempt: "I see", via: "said" }, "said"),
      "Ada, say just the word by itself. Let's try again.",
    );
    assert.equal(doneLine("Ada"), "Ada, you did it! You finished this round. I'm so proud of you.");
  });
});
