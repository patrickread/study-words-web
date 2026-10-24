import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outPath = path.join(root, "src/data/sentences.json");
const model = "gpt-4o-mini";
const force = process.argv.includes("--force");

const lists = [
  { id: "sight", file: "data/words.txt" },
  { id: "addie-d1", file: "data/words-addie-d1.txt" },
];

function readWords(file) {
  const words = fs
    .readFileSync(path.join(root, file), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set();
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate word in ${file}: ${word}`);
    seen.add(key);
  }
  return words;
}

function wordPattern(word) {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
}

function countWord(sentence, word) {
  return (sentence.match(wordPattern(word)) ?? []).length;
}

function validSentence(sentence, word) {
  if (typeof sentence !== "string") return false;
  const words = sentence.trim().split(/\s+/);
  const count = countWord(sentence, word);
  return words.length >= 3 && words.length <= 20 && count >= 1 && count <= 3;
}

function cleanSentence(value) {
  const sentence = String(value)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“”']+|["“”']+$/g, "");
  if (!sentence) return "";
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function loadBank() {
  if (!fs.existsSync(outPath)) {
    return { generatedAt: null, model, lists: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
  return {
    generatedAt: parsed.generatedAt ?? null,
    model: parsed.model ?? model,
    lists: parsed.lists ?? {},
  };
}

function saveBank(bank) {
  const listsOut = {};
  for (const id of Object.keys(bank.lists).sort()) {
    listsOut[id] = {};
    for (const word of Object.keys(bank.lists[id]).sort()) {
      listsOut[id][word] = bank.lists[id][word];
    }
  }
  const next = {
    generatedAt: new Date().toISOString(),
    model: bank.model,
    lists: listsOut,
  };
  fs.writeFileSync(outPath, `${JSON.stringify(next, null, 2)}\n`);
}

function missingWords(bank) {
  const missing = [];
  for (const list of lists) {
    const existing = bank.lists[list.id] ?? {};
    for (const word of readWords(list.file)) {
      const key = word.toLowerCase();
      const sentences = existing[key];
      const complete =
        Array.isArray(sentences) &&
        sentences.length === 3 &&
        new Set(sentences).size === 3 &&
        sentences.every((sentence) => validSentence(sentence, key));
      if (force || !complete) missing.push({ listId: list.id, word, key });
    }
  }
  return missing;
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const key = process.env.OPENAI_API_KEY;
  return key ? message.replaceAll(key, "[redacted]") : message;
}

function parseSentences(content, word) {
  const data = JSON.parse(content);
  if (!Array.isArray(data.sentences)) throw new Error("response did not include sentences");
  const sentences = data.sentences.map(cleanSentence).filter(Boolean);
  if (sentences.length !== 3) throw new Error(`expected 3 sentences, got ${sentences.length}`);
  if (new Set(sentences).size !== 3) throw new Error("sentences were not distinct");
  for (const sentence of sentences) {
    if (!validSentence(sentence, word)) {
      throw new Error(`sentence did not use "${word}" as a whole word: ${sentence}`);
    }
  }
  return sentences;
}

async function generateWord(client, word) {
  let lastError = new Error("no attempt");
  let hint = "";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0.8,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You write short sentences for a children's spelling game. The child is about 6 to 8 years old. You only output JSON.",
          },
          {
            role: "user",
            content: [
              `Write 3 short sentences that each use the word "${word}".`,
              'Return JSON: {"sentences":["...","...","..."]}',
              `Each sentence must contain the exact letters "${word}" as a whole word.`,
              `Do not write "${word}s", "${word}d", "${word}ed", or "${word}ing".`,
              "Once is best. A second exact use is fine for a short word such as the, to, or and.",
              "Capitalize it only when it is the first word of the sentence.",
              "Use simple, friendly, everyday situations.",
              "Each sentence should be 4 to 12 words.",
              "No scares, violence, brands, sarcasm, or definitions.",
              "Do not spell the word or put it in quotes.",
              "Make the three sentences different from each other.",
              hint,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      });
      const content = response.choices[0]?.message?.content ?? "";
      return parseSentences(content, word);
    } catch (error) {
      lastError = error;
      hint = `The last try was rejected: ${safeError(error)}. Keep the exact word "${word}".`;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError;
}

async function mapPool(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

const bank = loadBank();
const needed = missingWords(bank);
if (needed.length === 0) {
  console.log(`Sentences already cover every study word (${outPath}).`);
  process.exit(0);
}

if (!process.env.OPENAI_API_KEY) {
  console.error(
    `OPENAI_API_KEY is required to write sample sentences for ${needed.length} word${needed.length === 1 ? "" : "s"}.`,
  );
  console.error("The published game does not need a key once src/data/sentences.json is complete.");
  process.exit(1);
}

const { default: OpenAI } = await import("openai");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
let written = 0;
const failures = [];

console.log(`Generating 3 sentences for ${needed.length} word${needed.length === 1 ? "" : "s"} with ${model}.`);

await mapPool(needed, 5, async (item) => {
  try {
    const sentences = await generateWord(client, item.key);
    bank.lists[item.listId] ??= {};
    bank.lists[item.listId][item.key] = sentences;
    bank.model = model;
    written += 1;
    saveBank(bank);
    console.log(`  ${written}/${needed.length} ${item.listId}:${item.word}`);
  } catch (error) {
    failures.push(`${item.listId}:${item.word}: ${safeError(error)}`);
    console.error(`  failed ${item.listId}:${item.word}: ${safeError(error)}`);
  }
});

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const stillMissing = missingWords(loadBank());
if (stillMissing.length > 0) {
  console.error(`Still missing sentences for ${stillMissing.map((item) => item.word).join(", ")}.`);
  process.exit(1);
}

console.log(`Saved 3 sentences for every study word to ${path.relative(root, outPath)}.`);
