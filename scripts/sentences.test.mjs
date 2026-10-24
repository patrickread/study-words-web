import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const lists = [
  { id: "sight", file: "data/words.txt" },
  { id: "addie-d1", file: "data/words-addie-d1.txt" },
];

function readWords(file) {
  return fs
    .readFileSync(path.join(root, file), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function countWord(sentence, word) {
  const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  return (sentence.match(pattern) ?? []).length;
}

const bank = JSON.parse(fs.readFileSync(path.join(root, "src/data/sentences.json"), "utf8"));

describe("baked sentences", () => {
  for (const list of lists) {
    it(`has 3 distinct sentences for every word in ${list.file}`, () => {
      const words = readWords(list.file);
      assert.ok(words.length > 0);
      for (const word of words) {
        const key = word.toLowerCase();
        const sentences = bank.lists?.[list.id]?.[key];
        assert.ok(Array.isArray(sentences), `${list.id}:${word} is missing`);
        assert.equal(sentences.length, 3, `${list.id}:${word} should have 3 sentences`);
        assert.equal(new Set(sentences).size, 3, `${list.id}:${word} repeats a sentence`);
        for (const sentence of sentences) {
          assert.ok(countWord(sentence, key) >= 1, `${list.id}:${word} sentence: ${sentence}`);
          assert.ok(sentence.length <= 140, sentence);
        }
      }
    });
  }
});
