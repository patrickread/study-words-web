let token = 0;
let active: { token: number; resolve: () => void } | null = null;

export function speechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
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
