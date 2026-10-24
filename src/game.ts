export const GAME_LENGTH = 10;
export const FAILURE_TOLERANCE = 2;

export type Round = {
  word: string;
  sentence: string | null;
};

export type Game = {
  name: string;
  listId: string;
  listLabel: string;
  queue: string[];
  correct: string[];
  failures: number;
  round: Round | null;
  lastPrompt: Round | null;
  finished: boolean;
};

export type AnswerVia = "wrote" | "said";

export type Feedback =
  | { type: "correct"; attempt: string; word: string; affirmation: string }
  | { type: "incorrect"; attempt: string; switched: boolean }
  | { type: "gibberish"; attempt: string; via: AnswerVia };

export type AttemptKind = "empty" | "replay" | "answer";

export function classifyAttempt(raw: string): AttemptKind {
  const attempt = raw.trim();
  if (attempt === "") return "empty";
  if (attempt === "?") return "replay";
  return "answer";
}

export function isGibberish(input: string): boolean {
  if (input.length > 20) return true;
  return /[^A-Za-z0-9']/.test(input);
}

export function normalizeDictation(text: string): string {
  return text
    .trim()
    .replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "")
    .trim();
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const current = next[i];
    const swap = next[j];
    if (current === undefined || swap === undefined) continue;
    next[i] = swap;
    next[j] = current;
  }
  return next;
}

export function createGame(
  name: string,
  listId: string,
  listLabel: string,
  words: readonly string[],
  random: () => number = Math.random,
): Game {
  return {
    name: name.trim().replace(/\s+/g, " "),
    listId,
    listLabel,
    queue: shuffle(words, random),
    correct: [],
    failures: 0,
    round: null,
    lastPrompt: null,
    finished: false,
  };
}

export function pickSentence(
  sentences: readonly string[],
  previous: string | null,
  random: () => number = Math.random,
): string | null {
  if (sentences.length === 0) return null;
  const unused = previous ? sentences.filter((sentence) => sentence !== previous) : [...sentences];
  const choices = unused.length > 0 ? unused : [...sentences];
  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));
  return choices[index] ?? null;
}

export function startRound(
  game: Game,
  sentencesForWord: (word: string) => readonly string[],
  random: () => number = Math.random,
): Game {
  if (game.finished || game.correct.length >= GAME_LENGTH || game.queue.length === 0) {
    return { ...game, round: null, finished: true };
  }

  const word = game.queue[0];
  if (!word) return { ...game, round: null, finished: true };

  const previous = game.lastPrompt?.word === word ? game.lastPrompt.sentence : null;
  const sentence = pickSentence(sentencesForWord(word), previous, random);
  const round = { word, sentence };
  return { ...game, round, lastPrompt: round, finished: false };
}

export function submit(
  game: Game,
  rawAttempt: string,
  affirmation: string,
  via: AnswerVia,
  random: () => number = Math.random,
): { game: Game; feedback: Feedback } {
  const attempt = rawAttempt.trim();
  const word = game.round?.word;
  if (!word) {
    throw new Error("There is no word to answer.");
  }

  if (isGibberish(attempt)) {
    return {
      game,
      feedback: { type: "gibberish", attempt, via },
    };
  }

  if (attempt.toLowerCase() === word.toLowerCase()) {
    const queue = game.queue.slice(1);
    const correct = [...game.correct, word];
    const finished = correct.length >= GAME_LENGTH || queue.length === 0;
    return {
      game: {
        ...game,
        queue,
        correct,
        failures: 0,
        round: null,
        finished,
      },
      feedback: { type: "correct", attempt, word, affirmation },
    };
  }

  let failures = game.failures + 1;
  let queue = game.queue;
  let switched = false;
  if (failures > FAILURE_TOLERANCE - 1 && queue.length > 1) {
    queue = shuffle(queue, random);
    failures = 0;
    switched = true;
  }

  return {
    game: {
      ...game,
      queue,
      failures,
      round: null,
      finished: false,
    },
    feedback: { type: "incorrect", attempt, switched },
  };
}

function finishSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function promptLine(name: string, word: string, sentence: string | null): string {
  const lead = `${name}, your word is ${word}.`;
  if (!sentence) return lead;
  return `${lead} As in, ${sentence}`;
}

export function resultLine(name: string, feedback: Feedback, via: AnswerVia): string {
  if (feedback.type === "gibberish") {
    if (feedback.via === "said") {
      return `${name}, say just the word by itself. Let's try again.`;
    }
    return `${name}, it seems like you just typed gibberish. Let's try again.`;
  }

  const verb = via === "said" ? "said" : "wrote";
  if (feedback.type === "correct") {
    return `You ${verb} ${feedback.attempt}. That is correct! ${finishSentence(feedback.affirmation)}`;
  }

  const result = `${name}, you ${verb} ${feedback.attempt}. That is not correct.`;
  return feedback.switched ? `${result} Let's try a different word.` : result;
}

export function doneLine(name: string): string {
  return `${name}, you did it! You finished this round. I'm so proud of you.`;
}

export function listPrompt(name: string): string {
  return `Hi, ${name}! Let's play! Which list do you want to practice? Sight words, or Addie's spelling list.`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function splitSentence(
  sentence: string,
  word: string,
): Array<{ text: string } | { blank: true }> | null {
  const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
  const parts: Array<{ text: string } | { blank: true }> = [];
  let last = 0;
  let found = false;

  for (const match of sentence.matchAll(pattern)) {
    found = true;
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: sentence.slice(last, index) });
    parts.push({ blank: true });
    last = index + match[0].length;
  }

  if (!found) return null;
  if (last < sentence.length) parts.push({ text: sentence.slice(last) });
  return parts;
}
