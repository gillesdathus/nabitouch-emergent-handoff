import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  DEFAULT_ENGAGE_EVENT_ID,
  ENGAGE_DEMO,
  ENGAGE_SCREENING,
  ENGAGE_STEPS,
  ENGAGE_TABLET_IDLE_MS,
  emptyEngageAnswers,
  getEngageEvent,
} from "@/fixtures/engage";
import {
  clearEngageProgress,
  continueHint,
  emailLooksValid,
  phoneDigits,
  readEngageProgress,
  resolveEngageMode,
  screeningFlags,
  stepValid,
  writeEngageProgress,
} from "@/lib/engage";
import { loadEngageEvent, submitEngageCheckIn } from "@/lib/engageApi";
import { EngageShell } from "./EngageShell";
import {
  IdleStart,
  PrivacyReset,
  StepConfirm,
  StepConsent,
  StepContact,
  StepFocus,
  StepMotion,
  StepPrivateFollowUp,
  StepScreening,
  StepSlot,
  StepWelcome,
} from "./EngageSteps";

function NavRow({ onBack, onContinue, continueLabel = "Continue", continueDisabled, continueTestId = "engage-continue" }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button type="button" className="engage-secondary" data-testid="engage-back" onClick={onBack} disabled={continueDisabled}>
        Back
      </button>
      <button
        type="button"
        className="engage-primary"
        data-testid={continueTestId}
        disabled={continueDisabled}
        onClick={onContinue}
      >
        {continueLabel}
      </button>
    </div>
  );
}

export default function EngageApp() {
  const { eventId: routeEventId } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = routeEventId || searchParams.get("event") || DEFAULT_ENGAGE_EVENT_ID;

  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches && window.matchMedia?.("(min-width: 768px)").matches;
  const mode = resolveEngageMode(searchParams, { coarsePointer: coarse });

  const [event, setEvent] = useState(() => getEngageEvent(eventId));
  const [eventSource, setEventSource] = useState("fixture");
  const [phase, setPhase] = useState(mode === "tablet" ? "idle" : "flow");
  const [stepId, setStepId] = useState("welcome");
  const [screeningIndex, setScreeningIndex] = useState(0);
  const [answers, setAnswers] = useState(() => emptyEngageAnswers());
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [checkInResult, setCheckInResult] = useState(null);

  const idleTimer = useRef(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const idemRef = useRef(`eg-${Date.now().toString(36)}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadEngageEvent(eventId);
      if (cancelled) return;
      setEvent(loaded.event);
      setEventSource(loaded.source);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const wipeSensitive = useCallback(() => {
    setAnswers(emptyEngageAnswers());
    setScreeningIndex(0);
    setShowErrors(false);
    setSubmitError("");
    setCheckInResult(null);
    setStepId("welcome");
    idemRef.current = `eg-${Date.now().toString(36)}`;
    clearEngageProgress(event.id);
  }, [event.id]);

  const goPrivacyReset = useCallback(() => {
    wipeSensitive();
    setPhase("reset");
  }, [wipeSensitive]);

  const bumpIdle = useCallback(() => {
    if (mode !== "tablet") return;
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    if (phase === "idle" || phase === "reset") return;
    idleTimer.current = window.setTimeout(() => {
      goPrivacyReset();
    }, ENGAGE_TABLET_IDLE_MS);
  }, [mode, phase, goPrivacyReset]);

  useEffect(() => {
    if (mode !== "tablet") return undefined;
    const events = ["pointerdown", "keydown", "touchstart"];
    const onActivity = () => bumpIdle();
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    bumpIdle();
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [mode, bumpIdle]);

  useEffect(() => {
    if (mode !== "phone") return;
    const saved = readEngageProgress(event.id);
    if (!saved) return;
    setAnswers((prev) => ({
      ...prev,
      firstName: saved.firstName || prev.firstName,
      lastName: saved.lastName || prev.lastName,
      email: saved.email || prev.email,
      phone: saved.phone || prev.phone,
      slotId: saved.slotId || prev.slotId,
    }));
    if (saved.stepId && ENGAGE_STEPS.some((s) => s.id === saved.stepId) && saved.stepId !== "confirm") {
      const safe = ["welcome", "contact", "slot"].includes(saved.stepId) ? saved.stepId : "welcome";
      setStepId(safe);
    }
    setPhase("flow");
  }, [mode, event.id]);

  useEffect(() => {
    if (mode !== "phone" || phase !== "flow") return;
    if (["welcome", "contact", "slot"].includes(stepId)) {
      writeEngageProgress(event.id, { stepId, ...answersRef.current });
    }
  }, [mode, phase, stepId, answers.firstName, answers.lastName, answers.email, answers.phone, answers.slotId, event.id]);

  const contactErrors = useMemo(() => {
    if (!showErrors || stepId !== "contact") return {};
    const err = {};
    if (!answers.firstName.trim()) err.firstName = "Enter your first name.";
    if (!answers.lastName.trim()) err.lastName = "Enter your last name.";
    if (!emailLooksValid(answers.email)) err.email = "Enter a valid email address.";
    if (phoneDigits(answers.phone).length < 10) err.phone = "Enter a 10-digit mobile number.";
    return err;
  }, [showErrors, stepId, answers]);

  const hint = submitError || (showErrors ? continueHint(stepId, answers, event) : "");

  const startSession = () => {
    wipeSensitive();
    setPhase("flow");
    setStepId("welcome");
    bumpIdle();
  };

  const finishAndClear = () => {
    wipeSensitive();
    if (mode === "tablet") setPhase("reset");
    else {
      setPhase("idle");
      setStepId("welcome");
    }
  };

  const goBack = () => {
    setShowErrors(false);
    setSubmitError("");
    if (stepId === "screening" && screeningIndex > 0) {
      setScreeningIndex((i) => i - 1);
      return;
    }
    const order = ENGAGE_STEPS.map((s) => s.id);
    const i = order.indexOf(stepId);
    if (i <= 0) {
      if (mode === "tablet") {
        wipeSensitive();
        setPhase("idle");
      }
      return;
    }
    const prev = order[i - 1];
    if (prev === "screening") setScreeningIndex(ENGAGE_SCREENING.length - 1);
    setStepId(prev);
  };

  const finalizeCheckIn = async (nextAnswers, { privatePath = false } = {}) => {
    setSubmitting(true);
    setSubmitError("");
    const payloadAnswers = {
      ...nextAnswers,
      consentAccepted: privatePath ? true : nextAnswers.consentAccepted,
      focusAreas: privatePath ? [] : nextAnswers.focusAreas,
    };
    const { ok: submitted, result, error } = await submitEngageCheckIn(event.id, payloadAnswers, {
      mode,
      idempotencyKey: idemRef.current,
    });
    setSubmitting(false);
    if (!submitted) {
      // Fixture / offline fallback — still complete the local UX so review continues.
      if (eventSource === "fixture") {
        setCheckInResult({
          checkIn: {
            checkInCode: null,
            writeMode: "offline-fixture",
            privateFollowUp: privatePath,
          },
          message: "Local prototype only — API unavailable. No booking created.",
          writesEnabled: false,
          privateFollowUp: privatePath,
        });
        setStepId(privatePath ? "private" : "confirm");
        return true;
      }
      setSubmitError(error || "Could not complete check-in. Try again.");
      return false;
    }
    setCheckInResult(result);
    setStepId(result.privateFollowUp || privatePath ? "private" : "confirm");
    return true;
  };

  const goContinue = async () => {
    if (stepId === "consent" && answers.consentPage < 2) {
      setShowErrors(false);
      setAnswers((a) => ({ ...a, consentPage: a.consentPage + 1, consentAccepted: false }));
      return;
    }
    if (!stepValid(stepId, answers, event) && stepId !== "screening") {
      setShowErrors(true);
      return;
    }
    if (stepId === "screening") {
      const q = ENGAGE_SCREENING[screeningIndex];
      if (!(answers.screening[q.id] === "yes" || answers.screening[q.id] === "no")) {
        setShowErrors(true);
        return;
      }
      if (screeningIndex < ENGAGE_SCREENING.length - 1) {
        setShowErrors(false);
        setScreeningIndex((i) => i + 1);
        return;
      }
      const flags = screeningFlags(answers);
      setShowErrors(false);
      if (flags.blocked) {
        const next = { ...answers, privateFollowUpRequested: true };
        setAnswers(next);
        await finalizeCheckIn(next, { privatePath: true });
        return;
      }
      setStepId("focus");
      return;
    }
    if (stepId === "consent") {
      await finalizeCheckIn(answers, { privatePath: false });
      return;
    }
    setShowErrors(false);
    const order = ENGAGE_STEPS.map((s) => s.id);
    const i = order.indexOf(stepId);
    const next = order[i + 1];
    if (next === "screening") setScreeningIndex(0);
    if (next) setStepId(next);
  };

  const shellStep = phase === "idle" ? "idle" : phase === "reset" ? "reset" : stepId === "private" ? "confirm" : stepId;
  const showProgress = phase === "flow" && stepId !== "private";
  const bannerText =
    eventSource === "api"
      ? event.writesEnabled
        ? "Engage live · appointments will be created"
        : "Engage API connected · prototype check-in (writes off)"
      : ENGAGE_DEMO
        ? "Synthetic demo · engage.nabitouch.com prototype · fixture event"
        : null;

  let body = null;
  let actions = null;

  if (phase === "idle") {
    body = <IdleStart event={event} mode={mode} onStart={startSession} />;
  } else if (phase === "reset") {
    body = <PrivacyReset onReady={() => setPhase("idle")} />;
  } else if (stepId === "private") {
    body = <StepPrivateFollowUp event={event} result={checkInResult} onDone={finishAndClear} />;
  } else {
    body = (
      <StepMotion stepKey={`${stepId}-${screeningIndex}`}>
        {stepId === "welcome" && (
          <StepWelcome event={event} mode={mode} onContinue={() => setStepId("contact")} />
        )}
        {stepId === "contact" && (
          <StepContact answers={answers} setAnswers={setAnswers} errors={contactErrors} />
        )}
        {stepId === "slot" && <StepSlot event={event} answers={answers} setAnswers={setAnswers} />}
        {stepId === "screening" && (
          <StepScreening answers={answers} setAnswers={setAnswers} questionIndex={screeningIndex} />
        )}
        {stepId === "focus" && <StepFocus answers={answers} setAnswers={setAnswers} />}
        {stepId === "consent" && <StepConsent answers={answers} setAnswers={setAnswers} />}
        {stepId === "confirm" && (
          <StepConfirm event={event} answers={answers} result={checkInResult} onDone={finishAndClear} />
        )}
      </StepMotion>
    );

    if (stepId !== "welcome" && stepId !== "confirm") {
      const screeningLast = stepId === "screening" && screeningIndex >= ENGAGE_SCREENING.length - 1;
      const label = submitting
        ? "Saving…"
        : stepId === "screening" && !screeningLast
          ? "Next question"
          : stepId === "consent" && !answers.consentAccepted
            ? "Confirm consent"
            : "Continue";
      actions = (
        <NavRow
          onBack={goBack}
          onContinue={goContinue}
          continueLabel={label}
          continueDisabled={submitting}
        />
      );
    }
  }

  return (
    <EngageShell
      stepId={shellStep}
      showProgress={showProgress}
      mode={mode}
      eventLabel={event.name}
      hint={hint}
      banner={
        bannerText ? (
          <p
            className="rounded-full bg-amber-50 px-3 py-1 text-center text-[11px] font-semibold text-amber-800 ring-1 ring-amber-100"
            data-testid="engage-demo-banner"
          >
            {bannerText}
          </p>
        ) : null
      }
      actions={actions}
    >
      {body}
      <span className="sr-only" role="status" aria-live="polite">
        {phase === "flow" ? `Step: ${stepId}` : phase}
      </span>
    </EngageShell>
  );
}
