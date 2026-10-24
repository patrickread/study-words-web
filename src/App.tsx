import { useEffect, useRef, useState, type RefObject } from "react";
import { WORD_LISTS, randomAffirmation, sentencesFor, type WordList } from "./content";
import {
  GAME_LENGTH,
  classifyAttempt,
  createGame,
  doneLine,
  listPrompt,
  promptLine,
  resultLine,
  splitSentence,
  startRound,
  submit,
  normalizeDictation,
  type Feedback,
  type Game,
} from "./game";
import {
  dictationAvailable,
  dictationErrorMessage,
  speak,
  speechAvailable,
  startDictation,
  stopSpeaking,
} from "./speech";

type Phase = "welcome" | "lists" | "answer" | "feedback" | "done";

export function App() {
  const [phase, setPhase] = useState<Phase>("welcome");
  const [nameDraft, setNameDraft] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const phaseRef = useRef<Phase>("welcome");
  const gameRef = useRef<Game | null>(null);
  const turnRef = useRef(0);
  const busyRef = useRef(false);
  const sayId = useRef(0);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const submitRef = useRef<(raw: string, via: "wrote" | "said") => Promise<void>>(async () => {});
  const wordInput = useRef<HTMLInputElement>(null);

  const canSpeak = speechAvailable();
  const canDictate = dictationAvailable();

  function showPhase(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function updateGame(next: Game) {
    gameRef.current = next;
    setGame(next);
  }

  function stopMic() {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }

  async function say(text: string) {
    const id = ++sayId.current;
    setSpeaking(true);
    await speak(text);
    if (sayId.current === id) setSpeaking(false);
  }

  async function playRound(base: Game) {
    const mine = ++turnRef.current;
    const roundGame = startRound(base, (word) => sentencesFor(base.listId, word));
    updateGame(roundGame);
    setFeedback(null);
    setFeedbackMessage("");
    setDraft("");
    setMicError(null);
    stopMic();
    busyRef.current = false;

    if (roundGame.finished || !roundGame.round) {
      showPhase("done");
      await say(doneLine(roundGame.name));
      return;
    }

    showPhase("answer");
    await say(promptLine(roundGame.name, roundGame.round.word, roundGame.round.sentence));
    if (turnRef.current !== mine) return;
  }

  async function onSubmit(raw: string, via: "wrote" | "said") {
    const current = gameRef.current;
    if (!current?.round || phaseRef.current !== "answer" || busyRef.current) return;

    const kind = classifyAttempt(via === "said" ? normalizeDictation(raw) : raw);
    if (kind === "empty") return;
    if (kind === "replay") {
      setDraft("");
      void say(promptLine(current.name, current.round.word, current.round.sentence));
      return;
    }

    const attempt = via === "said" ? normalizeDictation(raw) : raw.trim();
    const mine = ++turnRef.current;
    busyRef.current = true;
    stopMic();

    const affirmation = randomAffirmation();
    const result = submit(current, attempt, affirmation, via);
    const message = resultLine(current.name, result.feedback, via);
    updateGame(result.game);
    setFeedback(result.feedback);
    setFeedbackMessage(message);
    setDraft("");
    showPhase("feedback");

    await say(message);
    if (turnRef.current !== mine) {
      busyRef.current = false;
      return;
    }

    if (result.feedback.type === "gibberish" && current.round) {
      showPhase("answer");
      setFeedback(null);
      setFeedbackMessage("");
      busyRef.current = false;
      await say(promptLine(current.name, current.round.word, current.round.sentence));
      return;
    }

    if (result.game.finished) {
      showPhase("done");
      busyRef.current = false;
      await say(doneLine(current.name));
      return;
    }

    busyRef.current = false;
    await playRound(result.game);
  }

  submitRef.current = onSubmit;

  useEffect(() => {
    if (phase === "answer") wordInput.current?.focus();
  }, [phase, game?.round?.word, game?.correct.length, game?.failures]);

  useEffect(() => {
    return () => {
      stopSpeaking();
      recRef.current?.stop();
    };
  }, []);

  async function onStart() {
    if (phaseRef.current !== "welcome") return;
    const clean = nameDraft.trim().replace(/\s+/g, " ");
    if (!clean) {
      setNameError("Tell me your name first.");
      return;
    }
    if (!canSpeak) return;
    setPlayerName(clean);
    setNameError(null);
    showPhase("lists");
    await say(listPrompt(clean));
  }

  async function onChooseList(list: WordList) {
    if (phaseRef.current !== "lists" || !playerName) return;
    const next = createGame(playerName, list.id, list.label, list.words);
    await playRound(next);
  }

  function onHear() {
    const current = gameRef.current;
    if (!current?.round || phaseRef.current !== "answer") return;
    stopMic();
    void say(promptLine(current.name, current.round.word, current.round.sentence));
  }

  function onMic() {
    if (phaseRef.current !== "answer" || busyRef.current) return;
    if (recRef.current) {
      stopMic();
      return;
    }

    stopSpeaking();
    setMicError(null);
    const holder: { current: { stop: () => void } | null } = { current: null };
    const session = startDictation({
      onTranscript: (text, isFinal) => {
        const normalized = normalizeDictation(text);
        setDraft(normalized);
        if (isFinal && normalized) void submitRef.current(normalized, "said");
      },
      onError: (error) => {
        setMicError(dictationErrorMessage(error));
        setListening(false);
      },
      onEnd: () => {
        if (recRef.current !== holder.current) return;
        recRef.current = null;
        setListening(false);
      },
    });
    holder.current = session;

    if (!session) {
      setMicError("This browser can't take dictation. Type the word instead.");
      return;
    }

    recRef.current = session;
    setListening(true);
  }

  function onNext() {
    if (phaseRef.current !== "feedback") return;
    stopSpeaking();
  }

  function onNotMe() {
    stopSpeaking();
    stopMic();
    showPhase("welcome");
  }

  function onPlayAgain() {
    stopSpeaking();
    stopMic();
    busyRef.current = false;
    turnRef.current += 1;
    setFeedback(null);
    setGame(null);
    gameRef.current = null;
    showPhase("lists");
    void say(listPrompt(playerName));
  }

  return (
    <main className="shell">
      {phase === "welcome" ? (
        <Welcome
          nameDraft={nameDraft}
          nameError={nameError}
          canSpeak={canSpeak}
          onName={setNameDraft}
          onStart={() => void onStart()}
        />
      ) : null}

      {phase === "lists" ? (
        <ChooseList name={playerName} onChoose={(list) => void onChooseList(list)} onBack={onNotMe} />
      ) : null}

      {game && (phase === "answer" || phase === "feedback") ? (
        <Play
          game={game}
          phase={phase}
          draft={draft}
          feedback={feedback}
          feedbackMessage={feedbackMessage}
          listening={listening}
          speaking={speaking}
          canDictate={canDictate}
          micError={micError}
          wordInput={wordInput}
          onDraft={setDraft}
          onSubmit={() => void onSubmit(draft, "wrote")}
          onHear={onHear}
          onMic={onMic}
          onNext={onNext}
        />
      ) : null}

      {phase === "done" && game ? <Done game={game} onPlayAgain={onPlayAgain} /> : null}
    </main>
  );
}

function Welcome({
  nameDraft,
  nameError,
  canSpeak,
  onName,
  onStart,
}: {
  nameDraft: string;
  nameError: string | null;
  canSpeak: boolean;
  onName: (value: string) => void;
  onStart: () => void;
}) {
  return (
    <section className="panel welcome">
      <div className="card-stack" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="eyebrow">A listening and spelling game</p>
      <h1>Spelling quiz</h1>
      <p className="lede">Listen for the word, then spell it.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onStart();
        }}
      >
        <label htmlFor="player-name">What's your name?</label>
        <input
          id="player-name"
          name="player-name"
          autoComplete="nickname"
          autoFocus
          maxLength={24}
          value={nameDraft}
          onChange={(event) => onName(event.target.value)}
        />
        {nameError ? (
          <p className="form-error" role="alert">
            {nameError}
          </p>
        ) : null}
        <button className="primary" type="submit" disabled={!canSpeak}>
          Let's play
        </button>
      </form>
      {canSpeak ? null : (
        <p className="form-error" role="alert">
          This browser can't speak words aloud. Try Chrome, Safari, or Edge.
        </p>
      )}
    </section>
  );
}

function ChooseList({
  name,
  onChoose,
  onBack,
}: {
  name: string;
  onChoose: (list: WordList) => void;
  onBack: () => void;
}) {
  return (
    <section className="panel">
      <p className="eyebrow">Hi, {name}</p>
      <h1>Which list?</h1>
      <div className="list-choices">
        {WORD_LISTS.map((list, index) => (
          <button
            key={list.id}
            type="button"
            className="choice"
            data-testid={`list-${list.id}`}
            onClick={() => onChoose(list)}
          >
            <span className="choice-index">{index + 1}</span>
            <span>
              <strong>{list.label}</strong>
              <small>
                {list.description} · {list.words.length} words
              </small>
            </span>
          </button>
        ))}
      </div>
      <button type="button" className="text-button" onClick={onBack}>
        That's not me
      </button>
    </section>
  );
}

function Play({
  game,
  phase,
  draft,
  feedback,
  feedbackMessage,
  listening,
  speaking,
  canDictate,
  micError,
  wordInput,
  onDraft,
  onSubmit,
  onHear,
  onMic,
  onNext,
}: {
  game: Game;
  phase: "answer" | "feedback";
  draft: string;
  feedback: Feedback | null;
  feedbackMessage: string;
  listening: boolean;
  speaking: boolean;
  canDictate: boolean;
  micError: string | null;
  wordInput: RefObject<HTMLInputElement | null>;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  onHear: () => void;
  onMic: () => void;
  onNext: () => void;
}) {
  const round = game.round;
  const parts = round?.sentence && round.word ? splitSentence(round.sentence, round.word) : null;
  const correct = phase === "feedback" && feedback?.type === "correct";

  useEffect(() => {
    if (!correct) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.repeat) return;
      event.preventDefault();
      onNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [correct, onNext]);

  return (
    <section className="panel play" data-phase={phase}>
      <div className="play-head">
        <p className="eyebrow">Hi, {game.name} · Spelling quiz</p>
        <div className="dots" role="img" aria-label={`${game.correct.length} of ${GAME_LENGTH} words spelled`}>
          {Array.from({ length: GAME_LENGTH }, (_, index) => (
            <span key={index} className={index < game.correct.length ? "dot filled" : "dot"} />
          ))}
        </div>
      </div>

      <h1>Spell the word</h1>
      {import.meta.env.DEV && round ? (
        <span hidden data-testid="current-word">
          {round.word}
        </span>
      ) : null}

      {phase === "answer" && round ? (
        <>
          <button type="button" className={speaking ? "hear speaking" : "hear"} onClick={onHear}>
            <SpeakerIcon />
            <span>{speaking ? "Speaking…" : "Hear it again"}</span>
          </button>
          {parts ? (
            <p className="sentence">
              {parts.map((part, index) =>
                "blank" in part ? (
                  <span key={index} className="blank" aria-hidden="true" />
                ) : (
                  <span key={index}>{part.text}</span>
                ),
              )}
              <span className="sr-only">The study word is left blank in the sentence.</span>
            </p>
          ) : (
            <p className="sentence quiet">Listen, then spell the word.</p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <label className="sr-only" htmlFor="word-input">
              Spell the word
            </label>
            <input
              id="word-input"
              ref={wordInput}
              data-testid="word-input"
              value={draft}
              maxLength={32}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Spell it here"
              onChange={(event) => onDraft(event.target.value)}
            />
            <div className="actions">
              {canDictate ? (
                <button
                  type="button"
                  className={listening ? "secondary listening" : "secondary"}
                  aria-pressed={listening}
                  onClick={onMic}
                >
                  <MicIcon />
                  {listening ? "Listening…" : "Say the word"}
                </button>
              ) : null}
              <button className="primary" type="submit" disabled={draft.trim() === ""}>
                Check
              </button>
            </div>
          </form>
          {micError ? (
            <p className="form-error" role="status">
              {micError}
            </p>
          ) : (
            <p className="hint">
              {canDictate ? "Type the spelling, or say the word." : "Type the spelling you hear."} Press ? to hear it again.
            </p>
          )}
        </>
      ) : null}

      {phase === "feedback" && feedback ? (
        <div className={`feedback ${feedback.type}`} role="status" data-feedback={feedback.type}>
          {feedback.type === "correct" ? <p className="reveal">{feedback.word}</p> : null}
          <p>{feedbackMessage}</p>
          <button type="button" className="primary" onClick={onNext}>
            {feedback.type === "correct" || (feedback.type === "incorrect" && feedback.switched)
              ? "Next word"
              : "Try again"}
          </button>
          {feedback.type === "correct" ? <p className="hint">Press Enter for the next word.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function Done({ game, onPlayAgain }: { game: Game; onPlayAgain: () => void }) {
  return (
    <section className="panel done">
      <p className="eyebrow">Round complete</p>
      <h1>You did it, {game.name}.</h1>
      <p className="lede">You spelled {game.correct.length} words. I'm so proud of you.</p>
      <ul className="word-pills">
        {game.correct.map((word) => (
          <li key={word}>{word}</li>
        ))}
      </ul>
      <button type="button" className="primary" onClick={onPlayAgain}>
        Play again
      </button>
    </section>
  );
}

function SpeakerIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M16.5 8.5a4.5 4.5 0 0 1 0 7M18.8 6.2a8 8 0 0 1 0 11.6"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M7 11a5 5 0 0 0 10 0M12 16v3M9 19h6"
      />
    </svg>
  );
}
