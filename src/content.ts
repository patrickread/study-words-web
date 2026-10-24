import affirmationsRaw from "../data/affirmations.txt?raw";
import addieRaw from "../data/words-addie-d1.txt?raw";
import sightRaw from "../data/words.txt?raw";
import sentenceBank from "./data/sentences.json";

export type WordList = {
  id: string;
  label: string;
  description: string;
  words: string[];
};

type SentenceBank = {
  lists: Record<string, Record<string, string[]>>;
};

function parseLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export const WORD_LISTS: WordList[] = [
  {
    id: "sight",
    label: "Sight words",
    description: "Everyday words to read and spell",
    words: parseLines(sightRaw),
  },
  {
    id: "addie-d1",
    label: "Addie's spelling list",
    description: "List D-1",
    words: parseLines(addieRaw),
  },
];

export const AFFIRMATIONS = parseLines(affirmationsRaw);

export function randomAffirmation(random: () => number = Math.random): string {
  const index = Math.floor(random() * AFFIRMATIONS.length);
  return AFFIRMATIONS[index] ?? "Excellent!";
}

export function sentencesFor(listId: string, word: string): string[] {
  const lists = (sentenceBank as SentenceBank).lists;
  return lists[listId]?.[word.toLowerCase()] ?? [];
}
