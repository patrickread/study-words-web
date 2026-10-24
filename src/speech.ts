export type DictationHandlers = {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  onEnd: () => void;
};

type SpeechResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechResultEvent = {
  results: ArrayLike<SpeechResult>;
};

type SpeechErrorEvent = {
  error: string;
};

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecConstructor = new () => SpeechRec;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecConstructor;
    webkitSpeechRecognition?: SpeechRecConstructor;
  }
}

let token = 0;
let active: { token: number; resolve: () => void } | null = null;

function recognitionConstructor(): SpeechRecConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function speechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

export function dictationAvailable(): boolean {
  return recognitionConstructor() !== null;
}

function preferredVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const ranked: Array<(voice: SpeechSynthesisVoice) => boolean> = [
    (voice) => voice.name === "Samantha",
    (voice) => voice.name === "Google US English",
    (voice) => voice.lang === "en-US" && voice.localService,
    (voice) => voice.lang === "en-US",
    (voice) => voice.lang.toLowerCase().startsWith("en"),
  ];
  for (const matches of ranked) {
    const voice = voices.find(matches);
    if (voice) return voice;
  }
  return undefined;
}

export function stopSpeaking(): void {
  token += 1;
  window.speechSynthesis?.cancel();
  const current = active;
  active = null;
  current?.resolve();
}

export function speak(text: string): Promise<void> {
  const mine = ++token;
  const previous = active;
  active = null;
  previous?.resolve();
  window.speechSynthesis?.cancel();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (active?.token === mine) active = null;
      resolve();
    };

    if (!speechAvailable() || text.trim() === "") {
      finish();
      return;
    }

    active = { token: mine, resolve: finish };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.02;
    utterance.lang = "en-US";
    const voice = preferredVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = finish;
    utterance.onerror = finish;

    window.setTimeout(() => {
      if (mine !== token) return;
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    }, 40);

    window.setTimeout(finish, Math.min(20000, 1200 + text.length * 80));
  });
}

export function prepareVoices(): void {
  if (!speechAvailable()) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    window.speechSynthesis.getVoices();
  });
}

export function startDictation(handlers: DictationHandlers): { stop: () => void } | null {
  const Constructor = recognitionConstructor();
  if (!Constructor) return null;

  const recognition = new Constructor();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    let finalText = "";
    let interim = "";
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result) continue;
      const transcript = result[0]?.transcript ?? "";
      if (result.isFinal) finalText += transcript;
      else interim += transcript;
    }
    handlers.onTranscript(finalText || interim, finalText !== "");
  };
  recognition.onerror = (event) => {
    if (event.error === "aborted") return;
    handlers.onError(event.error);
  };
  recognition.onend = () => handlers.onEnd();
  try {
    recognition.start();
  } catch {
    handlers.onError("audio-capture");
    return null;
  }

  return {
    stop: () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.abort();
    },
  };
}

export function dictationErrorMessage(error: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "The microphone is blocked. You can type the word instead.";
  }
  if (error === "audio-capture") {
    return "No microphone was found. You can type the word instead.";
  }
  if (error === "no-speech") {
    return "I didn't hear anything. Try the microphone again, or type the word.";
  }
  return "Dictation didn't work. You can type the word instead.";
}
