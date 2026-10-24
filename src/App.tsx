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
  type Feedback,
  type Game,
} from "./game";
import { speak, speechAvailable, stopSpeaking } from "./speech";

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
  const [speaking, setSpeaking] = useState(false);

  const phaseRef = useRef<Phase>("welcome");
  const gameRef = useRef<Game | null>(null);
  const turnRef = useRef(0);
  const busyRef = useRef(false);
  const sayId = useRef(0);
  const wordInput = useRef<HTMLInputElement>(null);

  const canSpeak = speechAvailable();

  function showPhase(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function updateGame(next: Game) {
    gameRef.current = next;
    setGame(next);
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

  async function onSubmit(raw: string) {
    const current = gameRef.current;
    if (!current?.round || phaseRef.current !== "answer" || busyRef.current) return;

    const kind = classifyAttempt(raw);
    if (kind === "empty") return;
    if (kind === "replay") {
      setDraft("");
      void say(promptLine(current.name, current.round.word, current.round.sentence));
      return;
    }

    const attempt = raw.trim();
    const mine = ++turnRef.current;
    busyRef.current = true;

    const affirmation = randomAffirmation();
    const result = submit(current, attempt, affirmation, "wrote");
    const message = resultLine(current.name, result.feedback, "wrote");
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

  useEffect(() => {
    if (phase === "answer") wordInput.current?.focus();
  }, [phase, game?.round?.word, game?.correct.length, game?.failures]);

  useEffect(() => {
    return () => {
      stopSpeaking();
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
    void say(promptLine(current.name, current.round.word, current.round.sentence));
  }

  function onNext() {
    if (phaseRef.current !== "feedback") return;
    stopSpeaking();
  }

  function onNotMe() {
    stopSpeaking();
    showPhase("welcome");
  }

  function onPlayAgain() {
    stopSpeaking();
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
          speaking={speaking}
          wordInput={wordInput}
          onDraft={setDraft}
          onSubmit={() => void onSubmit(draft)}
          onHear={onHear}
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
  speaking,
  wordInput,
  onDraft,
  onSubmit,
  onHear,
  onNext,
}: {
  game: Game;
  phase: "answer" | "feedback";
  draft: string;
  feedback: Feedback | null;
  feedbackMessage: string;
  speaking: boolean;
  wordInput: RefObject<HTMLInputElement | null>;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  onHear: () => void;
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
              <button className="primary" type="submit" disabled={draft.trim() === ""}>
                Check
              </button>
            </div>
          </form>
          <p className="hint">Type the spelling you hear. Press ? to hear it again.</p>
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

